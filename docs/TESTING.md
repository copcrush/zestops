# Testing

Testing stack (approved, [ADR-0004](adr/0004-testing-stack.md)): **Vitest**, **Playwright**,
Go **testing + testify**, **pytest**, and a **real PostgreSQL** for integration tests.

## What is tested where

| Layer | Tool | Count* | Highlights |
|---|---|---|---|
| Web unit | Vitest | 66 | money parsing without floats, CSRF tokens, open-redirect guard, RBAC map, Zod schemas, login form (jsdom) |
| Web integration | Vitest + PostgreSQL | 7 | login, hashed session storage, lockout, per-IP rate limit, session expiry/revocation |
| Web E2E | Playwright (Chromium desktop + Pixel 7) | 20 | login/logout, open redirect, cookie flags, CSP headers, payments workflow, amount validation, viewer RBAC (UI + BFF), CSRF/origin rejection, monitoring checks, SSRF rejection, incident lifecycle |
| Payment API unit | Go testing | 40+ cases | state machine, JWT attacks, validation, cursor, rate limiter, references |
| Payment API integration | Go testing + PostgreSQL | 22 | RBAC per route, idempotency (incl. 25 concurrent), concurrent settlement (20), pagination, summary, DB constraints & least privilege |
| Monitoring API | pytest (+ PostgreSQL, local HTTP server) | 119 | SSRF policy (40+ cases), health checker against a real HTTP server (timeouts, redirects, size, DNS rebinding, concurrency), RBAC, incidents (incl. concurrent resolution), automatic incidents, rate limits, production hardening |

\* Counts at the time of writing; CI is the source of truth.

## Prerequisites

Integration and E2E tests need the local stack (see [LOCAL_SETUP.md](LOCAL_SETUP.md)):

```bash
docker compose up -d --build
```

The `migrate` service also creates and migrates the separate **`zestops_test`** database,
so tests never touch your development data.

## Commands

### Web (from `apps/web`)

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs unit + integration tests (integration uses `TEST_DATABASE_URL` from
`.env.local`). `npm run test:e2e` starts `npm run dev` automatically if it is not running.

### Payment API (from `services/payment-api`)

```bash
gofmt -l . && go vet ./...
```

```bash
go test -race ./...
```

Run only the concurrency tests, verbosely:

```bash
go test -run TestConcurrent -v ./tests/integration/
```

### Monitoring API (from `services/monitoring-api`)

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy
```

```bash
uv run pytest
```

Run only the SSRF tests:

```bash
uv run pytest tests/test_ssrf_policy.py tests/test_health_checker.py -v
```

## Rules

- Integration tests skip with a clear message when the test database is not configured;
  CI sets `REQUIRE_INTEGRATION_TESTS=true`, which turns that skip into a failure.
- Never weaken or skip a failing test to get green. Fix the cause or document it.
- When fixing a bug, first write a test that reproduces it.
- Tests for concurrency were verified with **mutation checks**: removing the row lock makes
  them fail (see [security/SECURITY_TEST_PLAN.md](security/SECURITY_TEST_PLAN.md)).

## CI

`.github/workflows/ci.yml` runs every suite on each push and pull request, each backend
against its own PostgreSQL service container prepared with
`infra/database/scripts/prepare-ci-database.sh` (bootstrap + migrations, exactly like a
real environment). The E2E job starts the whole stack with Docker Compose and a production
build of the web app.
