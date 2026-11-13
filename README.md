# TravelPal

Collaborative AI travel planner: collect destinations, let AI organize them into geographically convenient days, and plan together via direct edits or proposals.

- Product spec: [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)
- Architecture, stack, security, git workflow, and delivery stages: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)

## Run locally

Needs Docker, JDK 21+, Node 24, and [uv](https://docs.astral.sh/uv/).

```bash
docker compose up -d                                      # Postgres on localhost:5433
(cd core-api && COOKIE_SECURE=false ./mvnw spring-boot:run)   # API on :8081
(cd frontend && npm install && npm run dev)               # UI on :5173, proxies /api to :8081
(cd ai-service && uv run uvicorn app.main:app --port 8090)   # AI service on :8090
```

Without `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` the API signs tokens with a throwaway dev key (sessions end on restart). See [.env.example](.env.example).

## Tests (CI enforces the same coverage gates)

```bash
(cd core-api && ./mvnw verify)        # JUnit + Testcontainers, JaCoCo ≥80% line / ≥70% branch
(cd ai-service && uv run pytest)      # pytest, ≥80%
(cd frontend && npm run coverage)     # Vitest, ≥80% lines / ≥70% branches
```

## Branching
`main` (production) ← `develop` (integration) ← `feature/*`, `fix/*`, `chore/*`. PRs only; Conventional Commits.
