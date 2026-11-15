# Data Flow

How a request travels through ZestOps, step by step.

## 1. Request lifecycle (any page)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant X as proxy.ts (Next.js)
    participant S as Server Component (page.tsx)
    participant D as identity schema
    participant A as Backend API
    B->>X: GET /payments (cookie)
    X->>X: no cookie? → redirect /login?next=/payments
    X->>X: create CSP nonce, set CSP header
    X->>S: forward request (x-nonce header)
    S->>D: requireSession(): validate session (cached per request)
    S->>A: listPayments(user) with internal JWT + X-Correlation-ID
    A-->>S: JSON
    S-->>B: HTML (streamed) + nonce'd scripts
```

- `loading.tsx` shows a skeleton immediately while the server loads data.
- If a backend is down, the page shows an inline error state for that section
  (`Promise.allSettled` + `describeBackendFailure`) instead of failing the whole page.
- Unexpected errors are caught by `error.tsx` (safe message + digest, no stack trace).

## 2. Payment flow

```mermaid
stateDiagram-v2
    [*] --> pending: POST /v1/payments (admin, Idempotency-Key)
    pending --> processing: simulate (same transaction)
    processing --> succeeded: outcome = succeeded
    processing --> failed: outcome = failed (+ reason)
    pending --> cancelled: cancel
    succeeded --> [*]
    failed --> [*]
    cancelled --> [*]
```

**Create (idempotent):**

1. The browser form generates a random `idempotency_key` once per opened form.
2. BFF validates (Zod), checks `createPayment` permission, forwards with
   `Idempotency-Key` header.
3. Go handler strictly decodes JSON (unknown fields, floats-as-integers rejected) and validates.
4. Service computes a SHA-256 **fingerprint** of the business fields, then in one transaction:
   `INSERT ... ON CONFLICT (created_by, idempotency_key) DO NOTHING RETURNING ...`
   - new row → insert `payment_events` (null → pending) → **201**
   - existing row, same fingerprint → **200** + `Idempotent-Replayed: true`
   - existing row, different fingerprint → **422 IDEMPOTENCY_KEY_REUSED**
5. Concurrent identical requests: PostgreSQL makes the second INSERT wait on the unique
   index until the first commits, so exactly one payment is created
   (tested with 25 parallel requests).

**Simulate / cancel:** one transaction with `SELECT ... FOR UPDATE` (row lock), state
machine check (`CanTransitionTo`), status update, and append-only history rows. Twenty
parallel simulations settle a payment exactly once (tested; removing the lock makes the
test fail).

## 3. Monitoring flow

```mermaid
sequenceDiagram
    autonumber
    participant W as Web BFF
    participant M as Monitoring API
    participant P as SSRF policy
    participant DNS as DNS
    participant T as Target service
    participant DB as monitoring schema
    W->>M: POST /v1/checks/run (admin JWT)
    M->>DB: load enabled services
    loop each service (max N concurrent)
        M->>P: URL origin in allowlist?
        M->>DNS: resolve host
        M->>P: every IP allowed? (no metadata, link-local, private unless enabled)
        M->>T: GET http(s)://<validated IP>/path<br/>Host/SNI = original host, no proxies
        T-->>M: status (body read up to max bytes)
        Note over M: 3xx → re-validate next hop (max 2)<br/>timeout → TIMEOUT
    end
    M->>DB: INSERT check_results
    M->>DB: down & no unresolved incident? INSERT incident (automatic)<br/>(partial unique index prevents duplicates)
    M-->>W: results + incidents_opened
```

Check outcome rules: expected status and fast → `up`; expected status but slower than
`degraded_threshold_ms` → `degraded` (`SLOW_RESPONSE`); anything else → `down` with an
error code (`UNEXPECTED_STATUS`, `TIMEOUT`, `CONNECTION_FAILED`, `TARGET_BLOCKED`,
`REDIRECT_BLOCKED`, `TOO_MANY_REDIRECTS`, `RESPONSE_TOO_LARGE`, `DNS_RESOLUTION_FAILED`).

## 4. Incident flow

`open → investigating → resolved` (or `open → resolved`). Resolving requires a note.
Status changes lock the incident row, so two admins resolving at once produce one
success and one `409 INVALID_STATE_TRANSITION`. Every change is appended to
`incident_events` (timeline shown in the UI).

## 5. Database migration flow

```mermaid
flowchart LR
    Dev["Developer adds<br/>infra/database/migrations/&lt;schema&gt;/00000N_name.up.sql"] --> Review["PR review + CI<br/>(migrations applied to a fresh DB)"]
    Review --> Local["docker compose run --rm migrate<br/>(zestops + zestops_test)"]
    Review --> Prod["Manual 'Database migrate' workflow<br/>(owner role, production DB)"]
    Local --> Track[("zestops_migrations.&lt;schema&gt;<br/>version tracking")]
    Prod --> Track
```

- One-time per environment: `infra/database/bootstrap/bootstrap.sql` (schemas, roles, grants).
- Migrations run as the owner role; applications use roles without DDL rights.
- Only `up` and `version` are exposed by `scripts/migrate.sh`; never reset production.

## 6. Observability flow

- The BFF creates a **correlation ID** per request and sends `X-Correlation-ID` to backends.
- Each backend creates its own **request ID**, returns it as `X-Request-ID`, includes it
  in every error body, and logs both IDs in JSON (`request completed` lines).
- Unsafe incoming correlation IDs (newlines, > 64 chars) are replaced, preventing log injection.
- To trace a user report: take the `request_id` shown in the error → search logs of all
  services for the same `correlation_id` (see [DEBUGGING.md](../runbooks/DEBUGGING.md)).
