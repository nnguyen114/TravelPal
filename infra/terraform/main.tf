# TravelPal on AWS. Nothing here has been applied: see infra/README.md before running it.
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # State holds the Redis auth token: keep it in an encrypted, private bucket.
  # terraform init -backend-config="bucket=<state bucket>" -backend-config="key=travelpal/prod.tfstate" -backend-config="region=<region>"
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = { app = local.name } }
}

# CloudFront certificates and web ACLs must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = { app = local.name } }
}

locals {
  name   = "travelpal"
  domain = var.domain_name
  api    = "api-origin.${var.domain_name}"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "domain_name" {
  description = "Public domain for the app, e.g. travelpal.example.com (its Route 53 zone must exist)."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone that owns domain_name."
  type        = string
}

variable "alarm_email" {
  description = "Where CloudWatch alarms are emailed (confirm the subscription email once)."
  type        = string
}

variable "image_tag" {
  description = "Image tag for both services in ECR."
  type        = string
  default     = "latest"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

data "aws_availability_zones" "up" { state = "available" }

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name            = local.name
  cidr            = "10.20.0.0/16"
  azs             = slice(data.aws_availability_zones.up.names, 0, 2)
  public_subnets  = ["10.20.0.0/24", "10.20.1.0/24"]
  private_subnets = ["10.20.10.0/24", "10.20.11.0/24"]
  # ponytail: one NAT gateway (cheaper, single-AZ egress); one per AZ if an AZ outage must not stop AI calls.
  enable_nat_gateway = true
  single_nat_gateway = true
}

output "app_url" { value = "https://${local.domain}" }
output "ecr_core_api" { value = aws_ecr_repository.app["core-api"].repository_url }
output "ecr_ai_service" { value = aws_ecr_repository.app["ai-service"].repository_url }
output "spa_bucket" { value = aws_s3_bucket.spa.bucket }
output "cloudfront_id" { value = aws_cloudfront_distribution.app.id }
output "secret_ids" { value = { for k, s in aws_secretsmanager_secret.app : k => s.id } }
