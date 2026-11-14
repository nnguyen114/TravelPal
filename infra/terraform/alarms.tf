# Alarms email var.alarm_email. Dashboards: CloudWatch Container Insights (enabled on the cluster) covers CPU,
# memory and task counts per service; RDS Performance Insights covers slow queries.

# trivy:ignore:AVD-AWS-0136 Alarm notices hold no user data; the AWS-managed key is enough.
resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    api-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 20, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.api.arn_suffix }, help = "core-api returned many 5xx in 5 minutes"
    }
    api-p95-latency = {
      namespace = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "p95", threshold = 0.5, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.api.arn_suffix }, help = "p95 response time over 500 ms (includes streamed AI calls)"
    }
    api-unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.core_api.arn_suffix }, help = "a core-api task fails health checks"
    }
    jobs-dlq = {
      namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold"
      dims      = { QueueName = aws_sqs_queue.dlq["optimize-jobs"].name }, help = "optimize jobs keep failing"
    }
    results-dlq = {
      namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold"
      dims      = { QueueName = aws_sqs_queue.dlq["optimize-results"].name }, help = "optimize results can't be stored"
    }
    jobs-backlog-age = {
      namespace = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", stat = "Maximum", threshold = 120, op = "GreaterThanThreshold"
      dims      = { QueueName = aws_sqs_queue.q["optimize-jobs"].name }, help = "optimize jobs wait over 2 minutes"
    }
    db-cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.db.identifier }, help = "database CPU high"
    }
    db-storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 5e9, op = "LessThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.db.identifier }, help = "under 5 GB database storage left"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "app" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.help
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  statistic           = each.value.stat == "p95" ? null : each.value.stat
  extended_statistic  = each.value.stat == "p95" ? "p95" : null
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
