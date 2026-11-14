# TravelPal on AWS

Terraform for production. **Nothing has been created yet.** Applying it creates billable resources
(roughly: Multi-AZ Postgres, a two-node Redis, NAT gateway, ALB, 4+ Fargate tasks, CloudFront, WAF).

```
Viewer ─► CloudFront (WAF, TLS, CSP/HSTS) ─┬─► S3 (the React app, private)
                                           └─► /api/* ─► ALB (CloudFront-only) ─► core-api tasks ─┬─► Postgres (RDS Multi-AZ)
                                                                                                  ├─► Redis (ElastiCache, TLS)
                                                                                                  ├─► SQS jobs ⇄ ai-service tasks ─► Claude, Voyage
                                                                                                  └─► ai-service (Service Connect, private)
```

| File | What |
|---|---|
| `terraform/main.tf` | Providers, variables, VPC (2 AZs, private subnets for everything but the ALB), outputs |
| `terraform/data.tf` | Postgres, Redis, SQS queues + dead-letter queues |
| `terraform/secrets.tf` | Secrets Manager entries (values put in by the script below, never via Terraform) |
| `terraform/ecs.tf` | ECR, ECS cluster, task definitions, services, IAM (least privilege per service), autoscaling |
| `terraform/edge.tf` | Certificates, ALB, CloudFront, S3, security headers, WAF |
| `terraform/alarms.tf` | CloudWatch alarms to email |
| `scripts/put-secrets.sh` | Generates signing keys and stores them with the API keys |

## Decisions needed before applying

1. AWS account and region (`region`, default `us-east-1`).
2. A domain with a Route 53 hosted zone (`domain_name`, `hosted_zone_id`). The app is served at that domain;
   `api-origin.<domain>` is used between CloudFront and the ALB.
3. An email for alarms (`alarm_email`).
4. An S3 bucket for Terraform state (encrypted, versioned, private).

## First deploy

```bash
cd infra/terraform
terraform init -backend-config="bucket=<state-bucket>" -backend-config="key=travelpal/prod.tfstate" -backend-config="region=<region>"
terraform plan -var domain_name=... -var hosted_zone_id=... -var alarm_email=... -out plan
terraform apply plan            # services start once images exist; until then ECS keeps retrying
```

Then store the secrets (generated keys never touch disk or Terraform state):

```bash
ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... infra/scripts/put-secrets.sh
```

Build and push images (tags are immutable: use the git SHA), then deploy that tag:

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker buildx build --platform linux/arm64 -t <ecr_core_api>:<sha> --push core-api
docker buildx build --platform linux/arm64 -t <ecr_ai_service>:<sha> --push ai-service
terraform apply -var image_tag=<sha> ...
```

Ship the web app:

```bash
cd frontend && npm ci && npm run build
aws s3 sync dist s3://<spa_bucket> --delete
aws cloudfront create-invalidation --distribution-id <cloudfront_id> --paths '/index.html'
```

## Operating it

- **Scaling**: core-api scales on CPU (2–20 tasks); ai-service on CPU and on optimize jobs waiting per task.
  Live updates and limits are shared through Redis, so any number of core-api tasks is fine.
- **Keys**: rerun `put-secrets.sh` and redeploy to rotate. Rotating the user-token key signs everyone out once
  (they sign back in); rotating the internal key is invisible.
- **Backups**: RDS keeps 14 days of point-in-time backups and a final snapshot on delete. Restore drill: restore
  to a new instance (`aws rds restore-db-instance-to-point-in-time`), point a copy of core-api at it, check a trip.
- **Load test**: `k6 run -e BASE_URL=https://<domain> load/trips.js`. Sign-up is capped at 10/minute per IP, so
  run it from a few machines or with fewer `USERS`. Locally: 30 users, p95 59 ms, 0.01% errors.
- **Not here yet**: a deploy pipeline (images and `terraform apply` are manual), and tracing across services
  (Container Insights, ALB metrics and logs cover the alarms; add OpenTelemetry when a slow request needs following).
