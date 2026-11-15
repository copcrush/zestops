# API Reference

All APIs use JSON, UTC ISO-8601 timestamps, integer minor units for money, and the shared
[error envelope](ERRORS.md). Backends require `Authorization: Bearer <internal JWT>`
(issued only by the web BFF, see [AUTH.md](../architecture/AUTH.md)); browsers call the BFF.

The Monitoring API also serves a generated OpenAPI document at `/openapi.json` and
interactive docs at `/docs` **in development only**.

## Web BFF (`apps/web`, same origin as the UI)

State-changing calls require the session cookie, `X-CSRF-Token`, and a same-origin `Origin`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — (Origin check) | `{email, password}` → sets session cookie |
| POST | `/api/auth/demo` | — (Origin check) | Start a read-only guest session (only if `PUBLIC_DEMO_VIEWER_EMAIL` is set) |
| POST | `/api/auth/logout` | signed in | Revoke session, clear cookie |
| GET | `/api/health` | — | Web liveness |
| POST | `/api/payments` | createPayment | Create payment (`idempotency_key` in body, forwarded as header) |
| POST | `/api/payments/{id}/simulate` | simulatePayment | `{outcome: succeeded\|failed, failure_reason?}` |
| POST | `/api/payments/{id}/cancel` | cancelPayment | Cancel pending payment |
| POST | `/api/monitoring/services` | manageMonitoredServices | Register approved service |
| PATCH | `/api/monitoring/services/{id}` | manageMonitoredServices | Enable/disable, tune thresholds |
| POST | `/api/monitoring/services/{id}/checks` | runHealthChecks | Check one service now |
| POST | `/api/monitoring/checks` | runHealthChecks | Check all enabled services |
| POST | `/api/incidents` | manageIncidents | Report incident |
| POST | `/api/incidents/{id}/status` | manageIncidents | `{status: investigating\|resolved, note?}` (note required to resolve) |
| POST | `/api/incidents/{id}/notes` | manageIncidents | Add investigation note |
| PATCH | `/api/profile` | signed in | `{display_name}` |
| POST | `/api/profile/password` | signed in | `{current_password, new_password}`; revokes other sessions |
| DELETE | `/api/profile/sessions` | signed in | Sign out other sessions |

Reads (lists, details, summaries) are done by Server Components directly against the
backends, not through public BFF endpoints.

## Payment API (`services/payment-api`, Go)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/health/live` | public | Process up |
| GET | `/health/ready` | public | Database reachable |
| GET | `/v1/currencies` | any | Supported currencies with `minor_unit_exponent` |
| GET | `/v1/payments?status=&search=&limit=&cursor=` | any | Keyset pagination (`next_cursor`), max `limit` 100 |
| GET | `/v1/payments/summary` | any | Counts by status, success rate, settled totals (decimal strings) |
| POST | `/v1/payments` | admin | Header `Idempotency-Key` (8–128 `[A-Za-z0-9_-]`); 201 new, 200 replay (`Idempotent-Replayed: true`), 422 key reuse |
| GET | `/v1/payments/{id}` | any | Payment + status history |
| GET | `/v1/payments/{id}/status` | any | Lightweight status |
| POST | `/v1/payments/{id}/simulate` | admin | `pending → processing → succeeded/failed` in one transaction |
| POST | `/v1/payments/{id}/cancel` | admin | `pending → cancelled` |

Create request:

```json
{
  "merchant_reference": "ORDER-1042",
  "description": "Annual plan",
  "amount_minor": 125050,
  "currency": "THB",
  "payment_method": "promptpay"
}
```

`payment_method`: `card`, `bank_transfer`, `promptpay`, `e_wallet`.
`amount_minor` must be a JSON integer between 1 and 100 000 000 000 (floats are rejected).

## Monitoring API (`services/monitoring-api`, Python)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/health/live`, `/health/ready` | public | |
| GET | `/demo/unstable` | public | Always 503; only when `DEMO_ENDPOINTS_ENABLED=true` |
| GET | `/v1/services` | any | Services with latest check and 24 h uptime |
| POST | `/v1/services` | admin | `target_url` must match `MONITORING_ALLOWED_TARGETS` |
| GET | `/v1/services/{id}` | any | Details + last 50 checks |
| PATCH | `/v1/services/{id}` | admin | `is_enabled`, `description`, `timeout_ms`, `degraded_threshold_ms`, `expected_status_code` |
| POST | `/v1/services/{id}/checks` | admin | Run one check |
| POST | `/v1/checks/run` | admin | Run all enabled checks; may open automatic incidents |
| GET | `/v1/checks?service_id=&limit=` | any | Check history (max 200) |
| GET | `/v1/allowed-targets` | admin | Approved origins |
| GET | `/v1/incidents?status=&severity=&limit=&cursor=` | any | `status` also accepts `unresolved` |
| POST | `/v1/incidents` | admin | `{title, description?, severity, service_id?}` |
| GET | `/v1/incidents/{id}` | any | Incident + timeline |
| POST | `/v1/incidents/{id}/status` | admin | Row-locked state change |
| POST | `/v1/incidents/{id}/notes` | admin | Timeline note |
| GET | `/v1/monitoring/summary` | any | Services by status, open incidents by severity, 24 h uptime |
