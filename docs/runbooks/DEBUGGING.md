# Debugging Runbook

## The method (use it every time)

1. **Reproduce** the problem. Note the exact URL, user role and time.
2. **Find the failing component**: browser console → web server log → backend log → database.
3. **Read the logs and the code** around the failure. Use the request ID (below).
4. **Form one hypothesis** and test it (a small script, a curl call, a failing test).
5. **Fix** the root cause in the smallest reasonable change.
6. **Add a regression test** that failed before the fix.
7. **Re-run** the relevant test suites.
8. **Verify** the original scenario manually.
9. **Write down** the root cause (commit message / PR description).

## Following one request across services

Every API error contains a `request_id`:

```json
{"error": {"code": "INVALID_STATE_TRANSITION", "message": "...", "request_id": "6c1e...", "details": {...}}}
```

- The web BFF creates a **correlation ID** per request and sends it as `X-Correlation-ID`.
- Each backend logs one JSON line per request with `request_id`, `correlation_id`,
  `route`, `status`, `duration_ms`, `user_id`.

```bash
docker compose logs payment-api monitoring-api | grep "<correlation-or-request-id>"
```

The web server logs `backend call` lines with the same `correlation_id` and the backend's
`backend_request_id`.

## Service-by-service

### Web app (Next.js)

- Server logs: the terminal running `npm run dev` (JSON lines from `src/lib/server/logger.ts`).
- Browser: DevTools → Console (CSP violations appear here) and Network (inspect `/api/*`
  responses; they use the shared error envelope).
- Breakpoints: run `NODE_OPTIONS=--inspect npm run dev`, then attach VS Code / Chrome
  (`chrome://inspect`).
- `Invalid server environment variables: ...` → a variable in `apps/web/.env.local` is
  missing or malformed; the message names it.

### Payment API (Go)

- Logs: `docker compose logs -f payment-api` (JSON, `slog`).
- Run outside Docker with a debugger: `dlv debug ./cmd/payment-api` (install
  [Delve](https://github.com/go-delve/delve)), or the VS Code Go extension "Launch Package".
- Database errors are wrapped with context (`insert payment: ...`); unknown errors are
  logged as `unexpected error` with the request ID while the client gets a generic 500.

### Monitoring API (Python)

- Logs: `docker compose logs -f monitoring-api`.
- Interactive API docs (development only): http://localhost:8000/docs.
- Debugger: `uv run python -m debugpy --listen 5678 -m uvicorn app.main:create_app --factory --port 8000`
  then attach VS Code (install `debugpy` in the venv first), or use `breakpoint()` with
  `uv run uvicorn ... --reload`.

### PostgreSQL

```bash
docker compose exec postgres psql -U zestops_owner -d zestops
```

Useful queries:

```sql
SELECT status, count(*) FROM payments.payments GROUP BY status;
SELECT * FROM payments.payment_events WHERE payment_id = '<uuid>' ORDER BY occurred_at;
SELECT event_type, count(*) FROM identity.audit_events GROUP BY 1;
SELECT * FROM zestops_migrations.payments;            -- applied migration version
SELECT pid, state, query FROM pg_stat_activity WHERE datname = 'zestops';
```

## Common problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Section shows "Payment API is unreachable" | Backend container down or starting (free hosting cold start) | `docker compose ps`, `docker compose logs payment-api`; wait for a cold start |
| `401 UNAUTHENTICATED` from a backend while the web session is valid | JWT key mismatch (web private key ≠ backend public key) or clock skew | Regenerate all env files with `node scripts/setup-local-env.mjs --force` and `docker compose up -d --force-recreate` |
| `403 CSRF_TOKEN_INVALID` | Page opened before a re-login (stale token) | Reload the page |
| `429 RATE_LIMITED` on login | Too many attempts from one IP (20 / 15 min) | Wait, or raise `LOGIN_ATTEMPTS_PER_IP_PER_WINDOW` **locally only** |
| Login fails after 5 wrong passwords | Account lockout (15 minutes) | Wait, or (local) `UPDATE identity.users SET locked_until = NULL WHERE email = '...'` |
| Health check `TARGET_BLOCKED` | URL resolves to a private/metadata address | Correct allowlist/target; private targets only with `MONITORING_ALLOW_PRIVATE_NETWORK_TARGETS=true` (local) |
| Registration says "not in the approved monitoring targets" | Origin missing from `MONITORING_ALLOWED_TARGETS` | Add the exact `scheme://host:port` to the service configuration |
| `npm run dev` page reloads endlessly | `.next` contains a production build made while dev was running | Stop dev, delete `apps/web/.next`, start dev |
| Docker build: `x509: certificate signed by unknown authority` | TLS-inspecting proxy (corporate network / sandbox) | Put the proxy CA bundle in `.secrets/extra-ca-certificates.crt` and set `EXTRA_CA_CERTIFICATES_FILE=./.secrets/extra-ca-certificates.crt` in `.env` |
| `migrate` exits with `Dirty database version` | A migration failed halfway | Fix the SQL, then (local only) `docker compose down -v`; in production follow ROLLBACK.md |
| Playwright: `Executable doesn't exist` | Browser not installed for this Playwright version | `npx playwright install chromium` (or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) |

## Safe production errors

Production responses never include stack traces, SQL, or internal hostnames. Look up
details in the logs with the `request_id`; error pages show a digest/reference that
matches the server log entry.
