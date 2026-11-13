# TravelPal — Architecture & Development Plan

## Context
TravelPal is a new project. The product spec (`docs/PRODUCT_SPEC.md`) defines a collaborative AI trip planner but no stack. Goal: pick a scalable stack, define the architecture, and break delivery into stages, with MVC structure, `main <- develop <- feature/*` git flow, enforced test coverage, and standard security (JWT/JWA, RBAC, OWASP). Decisions: **Java 25 + Spring Boot** core API, **separate Python + FastAPI AI service**, **React + Vite SPA**, **AWS**. Claude = LLM, Voyage = embeddings for RAG.


---

## 1. Architecture

Two backend services with a hard boundary: **core API (Spring Boot)** owns all user/trip data, auth and permissions; **AI service (FastAPI)** is stateless w.r.t. trips — it receives context, returns previews/results, never writes trip data. Each scales independently.

```
React SPA (S3 + CloudFront)
   │ HTTPS: REST + SSE
ALB ─► core-api (Spring Boot, ECS Fargate, autoscale on CPU/RPS, virtual threads)
         ├─ modules: auth · trips · itinerary · destinations · collaboration · proposals · history · previews
         ├─ PostgreSQL 17 (RDS Multi-AZ, read replica) + PostGIS     [schema: core]
         ├─ Redis (ElastiCache): cache, rate limits, token denylist, pub/sub for SSE fan-out
         │
         ├── SQS jobs ──────────►  ai-service (FastAPI, private subnet, autoscale on queue depth)
         │◄─ SQS results ────────    ├─ optimizer: geo clustering + OR-Tools ordering (deterministic)
         └── internal HTTP (stream) ─►├─ Claude: list parsing, constraint parsing, explanations, impact analysis, chat
                                      ├─ Voyage embeddings + pgvector retrieval   [schema/DB: ai, owned by ai-service]
                                      ├─ link import (best-effort fetch + extraction)
                                      └─ Places provider (Google Places / Foursquare — pick in Stage 1)
```

Key decisions:
- **Why separate AI service:** LLM calls are slow (seconds), costly, and rate-limited; they scale on queue depth, not CPU. Prompts/models iterate weekly — deploy independently. Python has official Voyage + Anthropic SDKs and OR-Tools. Provider outages degrade only AI features.
- **Communication:**
  - *Async* (optimize, link import, embedding updates): core-api publishes job to SQS with `trip_id`, `base_version`, trip snapshot → ai-service writes result to results queue → core-api stores `optimization_preview` → SSE notifies clients.
  - *Sync streaming* (chat drawer): SPA → core-api (auth/RBAC check, attaches trip context) → ai-service over internal HTTP, streamed back as SSE. The SPA never talks to ai-service directly.
- **Contracts:** JSON Schema / OpenAPI in `contracts/`; both services run contract tests against them in CI.
- **AI writes nothing directly.** Every AI change is a preview stored by core-api; Apply goes through core-api with optimistic locking.
- **Optimistic locking:** trip `version`; previews/proposals carry `base_version`; stale apply → `409`, UI forces refresh (spec §14).
- **History = append-only `trip_event` log** (actor, type, before/after JSON). Undo = inverse event; restore = preview diff vs current.
- **Realtime = SSE + Redis pub/sub** (any core-api node can push to any client).
- **pgvector** (in ai-service's own schema/DB) instead of a separate vector DB until scale proves otherwise.
- Map: **MapLibre GL** + MapTiler; dashed straight lines between ordered stops — no routing (spec §9).

### MVC layout — core-api (package-by-feature, MVC inside each)
```
core-api/src/main/java/com/travelpal/
  trip/        TripController · TripService · TripRepository · Trip (entity) · dto/
  itinerary/ destination/ collaboration/ proposal/ history/ preview/ auth/
  aiclient/    SQS publisher/consumer + streaming HTTP client to ai-service
  common/      security config, RFC 9457 error handling, validation
```
Controller = HTTP + DTO validation. Service = business rules, transactions, authorization. Repository = Spring Data JPA. Entities never leave the service layer. Flyway migrations. OpenAPI → generated TS client for frontend.

### Layout — ai-service (same controller/service/repository split)
```
ai-service/app/
  routers/     (controllers: chat, health)   workers/ (SQS consumers)
  services/    optimizer.py · claude_client.py · embeddings.py · discovery.py · link_import.py
  repositories/ (pgvector access)   schemas/ (Pydantic models, generated from contracts/)
```

### Frontend (View)
`frontend/src/{pages,components,features/*,api}` — React 19, TypeScript, Vite, TanStack Query, React Router, Tailwind, MapLibre.

### Monorepo
```
core-api/  ai-service/  frontend/  contracts/  infra/ (Terraform)  docs/  docker-compose.yml  .github/workflows/
```
CI uses path filters so each service builds/tests/deploys only when it (or `contracts/`) changes.

## 1a. Database scalability

**Queue the slow / bursty writes** (SQS, with DLQ + idempotency keys so retries are safe):
- Off the request path: AI jobs, embedding (re)generation, link import, `trip_event` fan-out to SSE, notifications, personalization-signal ingestion (saves / accepts / rejects batched into taste updates).
- On the request path, kept synchronous: itinerary edits. Users need read-your-writes on those, and they are small single-row transactions.
- Consumers batch-insert (JDBC batch / `COPY` / `executemany`) instead of one row per message.

**Concurrency / async**
- core-api: Java 25 **virtual threads** (`spring.threads.virtual.enabled=true`), so blocking JDBC and HTTP calls don't tie up platform threads.
  - `@Async` / `CompletableFuture` for parallel lookups (e.g. Places details for many destinations).
  - Structured concurrency where several calls fan out together.
- ai-service: fully async (FastAPI + `asyncpg` + `httpx`/async Anthropic and Voyage clients).
  - `asyncio.gather` with a semaphore caps parallel LLM calls (provider rate limits).
  - Worker concurrency is tuned per task.
- CPU-bound OR-Tools solves run in a process pool so they don't block the event loop.

**Connections**
- HikariCP (pool sized per task, not "max").
- **RDS Proxy** in front of Postgres so autoscaled tasks don't exhaust `max_connections`.
- Short transactions only: no LLM or HTTP call ever happens inside a DB transaction.

**Reads**
- Read replica for dashboard, history, and discovery reads.
  - Routing via `@Transactional(readOnly = true)` → replica datasource.
  - Read-your-writes paths stay on the primary.
- Redis cache for the trip snapshot (keyed by `trip_id:version`, so it never goes stale) and Places lookups (TTL).
- Keyset (cursor) pagination for history, proposals, and trips; no `OFFSET` scans.
- No N+1: fetch joins / `@EntityGraph`, plus Hibernate statistics checked in integration tests.

**Indexing (created in Flyway migrations, verified with `EXPLAIN` in tests)**

| Table | Index |
|---|---|
| `trip_member` | `UNIQUE (trip_id, user_id)`, `(user_id)` — dashboard + every RBAC check |
| `trip_day` | `UNIQUE (trip_id, day_index)` |
| `itinerary_item` | `(trip_day_id, position)`, `(destination_id)` |
| `destination` | `(trip_id, status)` for scheduled/unscheduled filter, `GIST (location)` PostGIS for proximity, `UNIQUE (trip_id, place_provider_id)` to prevent duplicates |
| `trip_event` | `(trip_id, created_at DESC)`; **partitioned monthly** by `created_at` (append-only, grows fastest) |
| `proposal` | `(trip_id, status, created_at DESC)` |
| `invite_link` | `UNIQUE (token_hash)` |
| `refresh_token` | `UNIQUE (token_hash)`, `(family_id)` |
| `optimization_preview` | `(trip_id, created_at DESC)`, TTL cleanup job |
| ai: `place_embedding` | **HNSW** (`vector_cosine_ops`) + B-tree on `(city_id)` for pre-filtering |
| ai: `user_taste_signal` | `(user_id, created_at DESC)` |

Plus: `pg_stat_statements` enabled, and a slow-query (>100 ms) alarm in CloudWatch. No index is added without a query that needs it.

**Scale-out path (only when metrics demand it):**
1. Vertical RDS + more replicas.
2. Split the ai schema into its own RDS instance.
3. Partition or shard core tables by `trip_id` (Citus / app-level).

## 2. Tech stack
| Area | Choice |
|---|---|
| Core API | Java 25, Spring Boot 3.5+, Spring MVC, Spring Security (OAuth2 Resource Server), Spring Data JPA, Flyway, Gradle (Kotlin DSL) |
| AI service | Python 3.13, FastAPI, Pydantic v2, `anthropic` SDK, `voyageai` SDK, OR-Tools, boto3 (SQS), SQLAlchemy + pgvector, uv for deps |
| DB | PostgreSQL 17 + PostGIS (core) · pgvector (ai) |
| Cache / realtime | Redis |
| Queue | SQS + DLQ (LocalStack locally) |
| LLM | Claude — Sonnet for chat/parsing/explanations, Haiku for cheap classification; prompt caching on trip context |
| Embeddings | Voyage (`voyage-3.5` class) |
| Frontend | React + Vite + TS, TanStack Query, Tailwind, MapLibre |
| Tests | core: JUnit 5, Mockito, Testcontainers, JaCoCo · ai: pytest, pytest-cov, respx/moto · web: Vitest, RTL, MSW · Playwright e2e · k6 load |
| Infra | AWS: ECS Fargate (2 services), RDS, ElastiCache, SQS, S3+CloudFront, Secrets Manager, KMS, WAF, CloudWatch; Terraform |
| Observability | OpenTelemetry traces across core-api → SQS → ai-service, JSON logs, Micrometer / Prometheus metrics, LLM token/cost metrics |

## 3. Security standards
- **User auth:** email/password (Argon2id) + Google OAuth. Access token = **JWT signed per JWA with ES256** (asymmetric, keys in KMS/Secrets Manager, `kid` rotation, JWKS endpoint), 15 min TTL. Refresh token = opaque, httpOnly + Secure + SameSite=Strict cookie, rotated on use, reuse detection → revoke family.
- **RBAC:** global roles `USER`, `ADMIN`; trip roles `OWNER`, `EDITOR`, `VIEWER` (`trip_member`). Enforced in service layer (`@PreAuthorize("@tripAuth.can(#tripId,'EDIT')")`), default-deny, every query scoped by membership (no IDOR). Proposal approval rules left open (spec §16) — modeled as permissions, not hardcoded.
- **Service-to-service:** ai-service in private subnet, no public ingress; core-api → ai-service calls carry short-lived internal JWT (separate signing key, `aud=ai-service`); SQS access via IAM task roles, least privilege.
- **Invite links:** 256-bit random token, stored hashed, revocable/regenerable by OWNER, optional expiry.
- **OWASP ASVS L2 baseline:** validation on all inputs (Bean Validation / Pydantic), parameterized queries, CSP/HSTS/X-Frame headers, CORS allowlist, CSRF protection on cookie endpoints, rate limiting (Bucket4j + Redis) on auth & AI endpoints, AWS WAF.
- **AI safety:** imported page content and user text delimited as data in prompts, never instructions; Claude output validated against Pydantic schema before use; link import fetcher blocks private IP ranges (SSRF); per-user AI quota + cost alarms.
- **Supply chain / CI:** Dependabot, Trivy image scan, OWASP dependency-check + pip-audit, CodeQL SAST, gitleaks. Secrets never committed (`.env` gitignored, `.env.example` committed).
- **Privacy:** personalization data deletable per user, PII minimized in logs and in LLM prompts.

## 4. Git workflow
- `main` (production, tagged) ← `develop` (integration) ← `feature/<ticket>-<slug>`, `fix/…`, `chore/…`. `release/x.y.z` from develop → main; `hotfix/…` from main → main + develop.
- PRs only into `develop`/`main`; branch protection: CI green + 1 review + up to date.
- Squash-merge feature → develop; merge-commit release → main; tag `vX.Y.Z` (SemVer).
- **Conventional Commits** with scope (`feat(core-api): …`, `fix(ai-service): …`). **No `Co-Authored-By: Claude` trailers** on any commit or PR.

## 5. Testing & coverage
- Pyramid: unit (services, optimizer, mappers) → integration (core: `@SpringBootTest` + Testcontainers Postgres/Redis/LocalStack, MockMvc incl. security rules; ai: pytest with moto SQS + Testcontainers pgvector) → contract tests on `contracts/` → e2e Playwright for spec flows A–D.
- Claude/Voyage mocked in unit/integration; small tagged live-API suite runs nightly only. Optimizer has golden-file tests (fixed place sets → expected day grouping/order).
- **CI gates (fail build):** core-api JaCoCo ≥ 80% line / 70% branch; ai-service pytest-cov ≥ 80%; frontend Vitest ≥ 80% lines; every RBAC rule has an allow + deny test.
- Load (Stage 6): k6 on itinerary read/write, SSE fan-out, AI job enqueue; target p95 < 200 ms for non-AI endpoints; AI jobs measured by queue latency.

## 6. Stages
Each stage = feature branches into `develop`, ends with a `release/` cut to `main`.

| Stage | Scope | Done when |
|---|---|---|
| **0 Foundation** | Monorepo, core-api + ai-service + frontend skeletons, docker-compose (Postgres+PostGIS+pgvector, Redis, LocalStack), CI per service with path filters, coverage gates, scans, branch protection, auth (register/login/refresh/Google), JWT + RBAC scaffold, internal service JWT, `contracts/` + contract test harness | Login works locally; core-api ↔ ai-service health round-trip over SQS and HTTP; CI green |
| **1 Trips core (single user)** | My Trips dashboard, minimal create, multi-city + city/day allocation with locks, days, destinations (manual + Places search), Destinations tab (scheduled/unscheduled, no duplicates), itinerary CRUD/reorder/lock, map↔itinerary sync, responsive | Flow A without AI |
| **2 Collaboration** | Invite link (hashed, revoke/regenerate), join flow, trip roles, SSE realtime, optimistic locking + 409, `trip_event` history, undo/restore with preview | Flow B minus proposals |
| **3 AI optimizer & assistant** | ai-service optimizer (trip/day/selection scope, Relaxed/Balanced/Packed, respects locks & city dates), Claude constraint parsing + explanations, preview/diff → Apply/Modify/Discard, overflow list, Needs Review, chat drawer (streamed; parse pasted lists, check fit) | Flows A + D with AI |
| **4 Proposals** | Suggestions tab (open/merged/closed), multi-edit proposals, comments, accept/merge with stale-version check, AI impact analysis | Flow B complete |
| **5 Discovery & import** | Voyage embeddings for places + taste signals (personal / trip / group kept separate), pgvector retrieval + Claude re-rank and "Why this?", Find More Places / More Like This / Not Interested, link import with graceful fallback | Flow C |
| **6 Scale & launch** | Terraform prod (Multi-AZ RDS, read replica, autoscaling per service), k6 load tests, OTel dashboards/alerts incl. LLM cost, WAF, pen-test checklist, backup/restore drill | Load targets met; `v1.0.0` tagged on main |

