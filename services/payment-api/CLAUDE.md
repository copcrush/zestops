# CLAUDE.md — Payment API (Go / Gin)

Read the root `CLAUDE.md` first. This file adds Go-specific rules.

## Layout (request flow top to bottom)

| Folder | Responsibility | May import |
|---|---|---|
| `cmd/payment-api` | `main`: config, DB pool, wiring, graceful shutdown | everything |
| `internal/handler` | **HTTP entry**: parse + validate input, call service, map errors to JSON | service, model, middleware |
| `internal/middleware` | request ID, access log, recovery, security headers, JWT auth, RBAC, rate limit | auth |
| `internal/service` | **business logic**: idempotency, simulation workflow, transactions boundaries | repository, model, auth |
| `internal/repository` | **SQL only** (pgx, parameterized), DB errors -> domain errors | model |
| `internal/model` | domain types, state machine, domain errors (no HTTP, no SQL) | — |
| `internal/auth` | internal JWT verification (EdDSA only) | — |
| `tests/integration` | full-stack tests against real PostgreSQL | everything |

## Rules

- Handle every `error`. Wrap with context: `fmt.Errorf("load payment: %w", err)`.
- Handlers never contain SQL; repositories never contain business rules.
- Payment status changes only through `model.PaymentStatus.CanTransitionTo` inside
  `repository.RunInTransaction` with `GetPaymentForUpdate` (row lock).
- Never add a role check only in the frontend: use `middleware.RequireRole`.
- Money is `int64` minor units. Never `float64` for amounts.
- JSON bodies are decoded strictly (`DisallowUnknownFields`). Keep it that way.
- Log with `slog` key/value pairs. Never log tokens, Authorization headers or bodies.

## Commands

```bash
go run ./cmd/payment-api            # uses .env (created by scripts/setup-local-env.mjs)
gofmt -l . && go vet ./...          # format + static checks
go test -race ./...                 # unit + integration (needs docker compose up -d)
go test -run TestConcurrent -v ./tests/integration/
```

## Adding an endpoint

1. Add the route in `internal/handler/router.go` with the right `RequireRole`.
2. Add request struct + `validate...` function in `internal/handler/validation.go`.
3. Add the handler method; map new domain errors in `respondServiceError`.
4. Add business logic in `internal/service`, SQL in `internal/repository`.
5. Add tests: unit (validation/rules) + integration (`tests/integration`).
6. Document it in `docs/api/README.md`.
