# Secrets are created empty here; values are put in by infra/scripts/put-secrets.sh so private keys and API keys
# never pass through Terraform state. Only the Redis URL is written by Terraform (it is derived from its token).

locals {
  external_secrets = ["jwt-private-key", "jwt-public-key", "internal-jwk", "anthropic-api-key", "voyage-api-key", "places-api-key"]
}

resource "aws_secretsmanager_secret" "app" {
  for_each = toset(concat(local.external_secrets, ["redis-url"]))
  name     = "${local.name}/${each.key}"
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.app["redis-url"].id
  secret_string = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}
