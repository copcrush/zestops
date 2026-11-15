# Project Structure

```
zestops/
├── apps/web/                    Next.js 16 dashboard + BFF (TypeScript)
│   ├── src/proxy.ts             runs before every page: CSP nonce, login redirect
│   ├── src/app/                 routes (App Router)
│   │   ├── (dashboard)/         signed-in pages: dashboard, payments, monitoring, incidents, settings, audit
│   │   ├── api/                 BFF endpoints (route.ts) for every mutation
│   │   ├── login/, unauthorized/, not-found.tsx, global-error.tsx
│   ├── src/features/<feature>/  server/ (data + logic) and components/ (UI) per feature
│   ├── src/lib/server|shared|browser/   helpers by where they may run
│   ├── src/components/ui|layout/        design system
│   ├── tests/unit|integration|e2e/      Vitest, Vitest + PostgreSQL, Playwright
│   └── scripts/create-user.mjs          create/update users in any environment
├── services/payment-api/        Go service
│   ├── cmd/payment-api/main.go  entry point: config → DB pool → router → server
│   ├── internal/handler/        HTTP entry (Gin handlers, validation, router)
│   ├── internal/middleware/     request IDs, logs, security headers, auth, RBAC, rate limit
│   ├── internal/service/        business logic (idempotency, workflow, transactions)
│   ├── internal/repository/     SQL (pgx)
│   ├── internal/model/          domain types, state machine, domain errors
│   ├── internal/auth/           internal JWT verification
│   ├── internal/config/         environment configuration
│   └── tests/integration/       full-stack tests against PostgreSQL
├── services/monitoring-api/     Python service
│   ├── app/main.py              create_app() factory
│   ├── app/api/                 HTTP entry (FastAPI routers, dependencies)
│   ├── app/schemas/             Pydantic validation models
│   ├── app/services/            business logic, SSRF-safe health checker
│   ├── app/repositories/        SQL (SQLAlchemy)
│   ├── app/models/              ORM table mappings
│   ├── app/security/            JWT verification, SSRF policy
│   ├── app/core/                config, logging, errors, middleware, rate limit
│   └── tests/                   pytest
├── infra/
│   ├── database/bootstrap/      one-time schemas + least-privilege roles
│   ├── database/migrations/     versioned SQL per schema (golang-migrate format)
│   ├── database/seeds/local/    LOCAL demo data (flagged is_demo_seed)
│   ├── database/scripts/        migrate.sh, seed-local.sh (run in containers)
│   ├── docker/                  PostgreSQL init script, build helpers
│   └── deployment/              hosting configuration (Render blueprint, ...)
├── docs/                        architecture, ADRs, API, security, runbooks
├── scripts/setup-local-env.mjs  generates local secrets into git-ignored .env files
├── .github/workflows/           CI pipelines
├── compose.yaml                 local stack
└── CLAUDE.md                    engineering rules (root + one per app/service)
```

## Where a request enters, and where things happen

| Question | Web (TypeScript) | Payment API (Go) | Monitoring API (Python) |
|---|---|---|---|
| Where do HTTP requests enter? | `src/app/**/page.tsx`, `src/app/api/**/route.ts` | `internal/handler/router.go` | `app/api/*.py` |
| Where is input validated? | Zod in `lib/shared/validation-schemas.ts` | `internal/handler/validation.go` + strict JSON decoding | Pydantic in `app/schemas/` |
| Where is business logic? | `src/features/*/server/` | `internal/service/` | `app/services/` |
| Where are DB queries? | `src/features/auth/server/*.ts` via `lib/server/db.ts` | `internal/repository/` | `app/repositories/` |
| Where is auth checked? | `lib/server/route-handler.ts`, `features/auth/server/current-session.ts` | `internal/middleware/authentication.go` | `app/api/dependencies.py` |
| Where are errors formatted? | `lib/server/route-handler.ts` | `internal/middleware/errors.go`, `respondServiceError` | `app/core/errors.py` |

## Adding an endpoint

### Payment API (Go)

1. `internal/handler/router.go`: add the route with `anyRole` or `adminOnly`.
2. `internal/handler/validation.go`: request struct (pointer fields) + `validate...` function.
3. `internal/handler/payment_handler.go`: parse → validate → call service → `context.JSON`.
4. `internal/service/`: business rules; use `RunInTransaction` for multi-step writes.
5. `internal/repository/`: parameterized SQL; map `pgx.ErrNoRows` to a domain error.
6. Tests: unit (validation/rules) + `tests/integration` (HTTP + DB + RBAC).

### Monitoring API (Python)

1. `app/schemas/`: request model inheriting `RequestModel` (rejects unknown fields).
2. `app/services/`: logic; `app/repositories/`: queries.
3. `app/api/`: router function with `CurrentPrincipal` (read) or `AdminPrincipal` (write).
4. Tests in `tests/` using the `client`, `tokens`, `admin`, `viewer` fixtures.

### Web BFF (TypeScript)

1. Zod schema in `src/lib/shared/validation-schemas.ts`.
2. `src/app/api/<path>/route.ts`: `export const POST = protectedRoute({ permission }, handler)`.
3. Call the backend with `callBackend()` and return `relayBackendResponse()`.
4. UI: Client Component calls `sendApiRequest()`, then `router.refresh()`.
5. Tests: schema unit test + Playwright flow.

## Naming conventions

- Go: packages lowercase single words; exported `PascalCase`; receivers named after the
  type (`paymentService *PaymentService`).
- Python: modules `snake_case.py`, classes `PascalCase`, functions `snake_case`.
- TypeScript: files `kebab-case.tsx`, components `PascalCase`, functions `camelCase`.
- SQL: tables plural `snake_case`; constraints `<table>_<column>_<kind>`.
