# CLAUDE.md — ZestOps Engineering Rules

These rules apply to every Claude Code session (and every human contributor)
working in this repository. Service-specific rules live in:

- `apps/web/CLAUDE.md` — Next.js / TypeScript
- `services/payment-api/CLAUDE.md` — Go / Gin
- `services/monitoring-api/CLAUDE.md` — Python / FastAPI

Read this file first, then the file for the service you are changing.

## 1. What ZestOps is

ZestOps is a portfolio-grade **Financial Operations & Service Monitoring Platform**.
All payments are **simulated**. Never integrate a real payment gateway and never
store real financial or personal data.

| Component | Path | Language | Port (local) |
| --- | --- | --- | --- |
| Web dashboard + BFF (auth, sessions) | `apps/web` | TypeScript / Next.js | 3000 |
| Payment API | `services/payment-api` | Go / Gin | 8080 |
| Monitoring API | `services/monitoring-api` | Python / FastAPI | 8000 |
| PostgreSQL | `infra/database` | SQL | 5432 |

Architecture details: `docs/architecture/OVERVIEW.md`.

## 2. Communication

- The project owner gives instructions in English and **receives answers in Thai**.
- Source code, identifiers, commits, and technical docs are **English**.
- Explain choices in beginner-friendly language (the owner knows JavaScript and is
  learning Go, Python, PostgreSQL, security, and DevOps).
- For significant choices, present 2–3 options with trade-offs (security, cost,
  complexity) and a recommendation, then wait for a decision.
- Never fabricate test results, completed features, or deployments.

## 3. Readability

- Use descriptive English names: `paymentStatus`, not `ps`;
  `calculateTotalAmount()`, not `calc()`.
- No unexplained abbreviations. Common ones are fine: `id`, `url`, `http`, `db`,
  `ctx` (Go context), `err` (Go error).
- Keep functions focused. If a function needs a comment block to explain its
  sections, split it.
- Prefer straightforward control flow and early returns over deep nesting.
- Do not introduce design patterns (factories, generic repositories, DI containers)
  without a concrete, present-day reason.
- Comments explain **why**, not what. Beginner-oriented "how this works" notes go
  in docs or in the package/module doc comment, not on every line.

## 4. Code quality

- Follow idiomatic conventions: `gofmt` + `go vet` for Go, `ruff` + `mypy` for
  Python, ESLint + TypeScript `strict` for the web app.
- Python code is fully type-hinted. TypeScript never uses `any` without a written
  justification.
- Go errors are always handled explicitly; wrap with context (`fmt.Errorf("...: %w", err)`).
- **Validate every external input** at the boundary (HTTP handler / route handler).
- **Use parameterized queries only.** Never build SQL by string concatenation with
  user data.
- Every API returns errors in the shared shape (see `docs/api/ERRORS.md`):
  `{"error": {"code": "SNAKE_CASE_CODE", "message": "...", "request_id": "..."}}`.
- Money is **never** a floating-point number. Use integer minor units
  (`amount_minor`, e.g. satang/cents) everywhere: DB, Go, Python, TypeScript.
- Do not duplicate business rules across services. Each rule has one owner
  (e.g. payment state transitions live only in the Payment API).
- Do not ship MVP features hidden behind `TODO`. If something is out of scope,
  document it in `docs/KNOWN_LIMITATIONS.md` instead.

## 5. Architecture map (where things live)

- **HTTP entry points**
  - Web: `apps/web/src/app/**/page.tsx` (pages) and `apps/web/src/app/api/**/route.ts` (BFF endpoints)
  - Go: `services/payment-api/internal/handler/`
  - Python: `services/monitoring-api/app/api/`
- **Validation**: Zod schemas (web), handler request structs + `validate` (Go),
  Pydantic schemas in `app/schemas/` (Python).
- **Business logic**: `internal/service/` (Go), `app/services/` (Python),
  `src/features/*/server/` (web).
- **Database access**: `internal/repository/` (Go), `app/repositories/` (Python),
  `src/lib/db/` (web, identity schema only).
- **Authentication & authorization**: see `docs/architecture/AUTH.md`.
  Backends trust only signed internal JWTs; they never trust a role or user ID
  sent by the browser.

How to add a new endpoint: `docs/architecture/PROJECT_STRUCTURE.md#adding-an-endpoint`.
How to debug each service: `docs/runbooks/DEBUGGING.md`.

## 6. Database rules

- One PostgreSQL database, **one schema per owner**: `identity` (web), `payments`
  (payment-api), `monitoring` (monitoring-api). A service never reads or writes
  another service's schema.
- Schema changes go through versioned SQL migrations in
  `infra/database/migrations/<schema>/`. Never edit an applied migration; add a new one.
- Every table has a primary key; use foreign keys, unique and check constraints
  to enforce invariants in the database, not only in code.
- Multi-step writes use a transaction. Concurrency-sensitive updates use row locks
  (`SELECT ... FOR UPDATE`) or unique constraints.
- Never reset, drop, or truncate a non-local database. Never commit credentials
  or database dumps.

## 7. Testing

- Write tests for critical business logic (money, state transitions, idempotency,
  authorization, SSRF protection).
- When fixing a bug, add a regression test that fails before the fix.
- Run the relevant test suites after every change (commands in `docs/TESTING.md`).
- Never skip, delete, or weaken a failing test to get a green result.
- Report actual results. If something was not run, say so.

## 8. Security

- Never expose secrets in code, logs, error messages, commits, or the browser.
- Never trust client-provided roles or user IDs. Authorization is enforced on the
  server (BFF **and** each backend).
- Secure defaults: deny by default, short token lifetimes, HttpOnly + Secure +
  SameSite cookies, strict CORS, security headers.
- Log security-relevant events (login success/failure, authorization denials,
  payment state changes, incident resolution) without credentials, tokens, or
  full request bodies.
- Do not store authentication tokens in `localStorage` / `sessionStorage`.
- Review new dependencies (maintenance status, license, known CVEs) before adding.
- Threat model: `docs/security/THREAT_MODEL.md`. Checklist:
  `docs/security/SECURITY_CHECKLIST.md`.
- Never claim the application is "fully secure" or "certified".

## 9. Git and deployment

- Keep commits focused, with conventional messages (`feat(payment-api): ...`,
  `fix(web): ...`, `docs: ...`, `ci: ...`).
- Review `git diff` before committing. Never commit `.env` files, keys, or dumps.
- Never overwrite or revert unrelated work. Never force-push without explicit
  owner approval.
- Never deploy publicly, create cloud resources, or create paid resources without
  explicit owner approval.

## 10. Common commands

```bash
docker compose up -d postgres          # start database
docker compose run --rm migrate        # apply all migrations
docker compose up -d payment-api monitoring-api
cd apps/web && npm run dev             # http://localhost:3000
```

Full setup: `docs/LOCAL_SETUP.md`. Test commands: `docs/TESTING.md`.
