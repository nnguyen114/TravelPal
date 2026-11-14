# Two Fargate services in private subnets. core-api sits behind the ALB; ai-service has no public entry at all
# and is reached only by core-api through ECS Service Connect (http://ai-service:8090).

resource "aws_ecr_repository" "app" {
  for_each             = toset(["core-api", "ai-service"])
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecs_cluster" "app" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
  service_connect_defaults { namespace = aws_service_discovery_http_namespace.app.arn }
}

resource "aws_service_discovery_http_namespace" "app" {
  name = local.name
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["core-api", "ai-service"])
  name              = "/${local.name}/${each.key}"
  retention_in_days = 30
}

resource "aws_security_group" "core_api" {
  name   = "${local.name}-core-api"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 8081
    to_port         = 8081
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress { # ai-service fetches core-api's internal public keys (JWKS)
    from_port       = 8081
    to_port         = 8081
    protocol        = "tcp"
    security_groups = [aws_security_group.ai_service.id]
  }
  egress { # Postgres, Redis, ai-service inside the VPC
    from_port   = 5432
    to_port     = 8090
    protocol    = "tcp"
    cidr_blocks = [module.vpc.vpc_cidr_block]
  }
  # trivy:ignore:AVD-AWS-0104 AWS APIs (SQS, Secrets Manager, ECR, logs) and map search are public HTTPS endpoints
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ai_service" {
  name   = "${local.name}-ai-service"
  vpc_id = module.vpc.vpc_id
  egress { # core-api's internal public keys
    from_port   = 8081
    to_port     = 8081
    protocol    = "tcp"
    cidr_blocks = [module.vpc.vpc_cidr_block]
  }
  # Claude, Voyage, map search and pasted links (any site, http or https). Link fetches are SSRF-guarded in code:
  # only public addresses, pinned to the checked IP.
  # trivy:ignore:AVD-AWS-0104
  egress {
    from_port   = 80
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "ai_from_core" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ai_service.id
  from_port                = 8090
  to_port                  = 8090
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.core_api.id
}

# --- IAM: one execution role (pull images, write logs, read secrets), one task role per service (its queues only)

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = concat([for s in aws_secretsmanager_secret.app : s.arn], [aws_db_instance.db.master_user_secret[0].secret_arn])
    }]
  })
}

resource "aws_iam_role" "task" {
  for_each           = toset(["core-api", "ai-service"])
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

locals {
  # Who sends to and who reads from each queue.
  queue_access = {
    core-api   = { send = "optimize-jobs", receive = "optimize-results" }
    ai-service = { send = "optimize-results", receive = "optimize-jobs" }
  }
}

resource "aws_iam_role_policy" "queues" {
  for_each = local.queue_access
  role     = aws_iam_role.task[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["sqs:GetQueueUrl", "sqs:CreateQueue"], Resource = [aws_sqs_queue.q[each.value.send].arn, aws_sqs_queue.q[each.value.receive].arn] },
      { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.q[each.value.send].arn },
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"], Resource = aws_sqs_queue.q[each.value.receive].arn },
    ]
  })
}

# --- Task definitions

locals {
  secret = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
  log = { for svc in ["core-api", "ai-service"] : svc => {
    logDriver = "awslogs"
    options   = { awslogs-group = aws_cloudwatch_log_group.app[svc].name, awslogs-region = var.region, awslogs-stream-prefix = svc }
  } }
}

resource "aws_ecs_task_definition" "core_api" {
  family                   = "${local.name}-core-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task["core-api"].arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name                   = "core-api"
    image                  = "${aws_ecr_repository.app["core-api"].repository_url}:${var.image_tag}"
    essential              = true
    portMappings           = [{ name = "core-api", containerPort = 8081, protocol = "tcp" }]
    logConfiguration       = local.log["core-api"]
    readonlyRootFilesystem = false
    environment = [
      { name = "DB_URL", value = "jdbc:postgresql://${aws_db_instance.db.address}:5432/travelpal?sslmode=require" },
      { name = "DB_USER", value = "travelpal" },
      { name = "DEV_KEYS", value = "false" },
      { name = "COOKIE_SECURE", value = "true" },
      { name = "CLIENT_IP_HEADER", value = "CloudFront-Viewer-Address" },
      { name = "AI_SERVICE_URL", value = "http://ai-service:8090" },
      { name = "SQS_ENDPOINT", value = "" },
      { name = "AWS_REGION", value = var.region },
    ]
    secrets = [
      { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.db.master_user_secret[0].secret_arn}:password::" },
      { name = "REDIS_URL", valueFrom = local.secret["redis-url"] },
      { name = "JWT_PRIVATE_KEY", valueFrom = local.secret["jwt-private-key"] },
      { name = "JWT_PUBLIC_KEY", valueFrom = local.secret["jwt-public-key"] },
      { name = "INTERNAL_JWT_PRIVATE_JWK", valueFrom = local.secret["internal-jwk"] },
    ]
  }])
}

resource "aws_ecs_task_definition" "ai_service" {
  family                   = "${local.name}-ai-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task["ai-service"].arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name             = "ai-service"
    image            = "${aws_ecr_repository.app["ai-service"].repository_url}:${var.image_tag}"
    essential        = true
    portMappings     = [{ name = "ai-service", containerPort = 8090, protocol = "tcp" }]
    logConfiguration = local.log["ai-service"]
    environment = [
      { name = "INTERNAL_JWKS_URL", value = "http://core-api:8081/.well-known/internal-jwks.json" },
      { name = "AWS_REGION", value = var.region },
    ]
    secrets = [
      { name = "ANTHROPIC_API_KEY", valueFrom = local.secret["anthropic-api-key"] },
      { name = "VOYAGE_API_KEY", valueFrom = local.secret["voyage-api-key"] },
    ]
  }])
}

# --- Services

resource "aws_ecs_service" "core_api" {
  name                              = "core-api"
  cluster                           = aws_ecs_cluster.app.id
  task_definition                   = aws_ecs_task_definition.core_api.arn
  launch_type                       = "FARGATE"
  desired_count                     = 2
  health_check_grace_period_seconds = 90
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.core_api.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.core_api.arn
    container_name   = "core-api"
    container_port   = 8081
  }
  service_connect_configuration {
    enabled = true
    service {
      port_name = "core-api"
      client_alias { port = 8081 }
    }
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle { ignore_changes = [desired_count] }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "ai_service" {
  name            = "ai-service"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.ai_service.arn
  launch_type     = "FARGATE"
  desired_count   = 2
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ai_service.id]
  }
  service_connect_configuration {
    enabled = true
    service {
      port_name = "ai-service"
      client_alias { port = 8090 }
    }
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle { ignore_changes = [desired_count] }
}

# --- Autoscaling. ai-service mostly waits on Claude, so it also scales on optimize backlog per task.

resource "aws_appautoscaling_target" "svc" {
  for_each           = { core-api = aws_ecs_service.core_api.name, ai-service = aws_ecs_service.ai_service.name }
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.app.name}/${each.value}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 2
  max_capacity       = 20
}

# Both services also scale on CPU (for ai-service: assistant chats and discovery, which don't use the queue).
resource "aws_appautoscaling_policy" "cpu" {
  for_each           = aws_appautoscaling_target.svc
  name               = "${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = each.value.resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}

resource "aws_appautoscaling_policy" "ai_backlog" {
  name               = "ai-service-backlog"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.svc["ai-service"].resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  target_tracking_scaling_policy_configuration {
    target_value = 3 # waiting optimize jobs per task
    customized_metric_specification {
      metrics {
        id          = "visible"
        return_data = false
        metric_stat {
          stat = "Average"
          metric {
            namespace   = "AWS/SQS"
            metric_name = "ApproximateNumberOfMessagesVisible"
            dimensions {
              name  = "QueueName"
              value = aws_sqs_queue.q["optimize-jobs"].name
            }
          }
        }
      }
      metrics {
        id          = "tasks"
        return_data = false
        metric_stat {
          stat = "Average"
          metric {
            namespace   = "ECS/ContainerInsights"
            metric_name = "RunningTaskCount"
            dimensions {
              name  = "ClusterName"
              value = aws_ecs_cluster.app.name
            }
            dimensions {
              name  = "ServiceName"
              value = aws_ecs_service.ai_service.name
            }
          }
        }
      }
      metrics {
        id          = "backlog"
        expression  = "visible / tasks"
        return_data = true
      }
    }
  }
}
