# Postgres, Redis and the optimize queues. All private, encrypted at rest and in transit.

resource "aws_security_group" "db" {
  name   = "${local.name}-db"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.core_api.id]
  }
}

resource "aws_db_subnet_group" "db" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "db" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "17"
  instance_class               = var.db_instance_class
  allocated_storage            = 50
  max_allocated_storage        = 500
  storage_encrypted            = true
  db_name                      = "travelpal"
  username                     = "travelpal"
  manage_master_user_password  = true # password lives in Secrets Manager, rotated by RDS
  multi_az                     = true
  db_subnet_group_name         = aws_db_subnet_group.db.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  backup_retention_period      = 14
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.name}-final"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  # Postgres 15+ on RDS already requires TLS (rds.force_ssl=1); the JDBC URL also asks for it.
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.core_api.id]
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = local.name
  description                = "Rate limits, AI quotas, ended sessions, live-update fan-out"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
}

# Jobs: core-api -> ai-service. Results: ai-service -> core-api. A message that keeps failing goes to its DLQ (alarmed).
resource "aws_sqs_queue" "dlq" {
  for_each                  = toset(["optimize-jobs", "optimize-results"])
  name                      = "${each.key}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "q" {
  for_each                   = toset(["optimize-jobs", "optimize-results"])
  name                       = each.key
  visibility_timeout_seconds = 180 # longer than one optimize run including Claude calls
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn, maxReceiveCount = 5 })
}
