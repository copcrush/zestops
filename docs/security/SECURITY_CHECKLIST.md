# Security Checklist

Mapped to the OWASP Top 10 (2021) and relevant OWASP ASVS 4.0 areas. ✅ = implemented
and tested, 🟡 = partially / documented limitation, ⬜ = not done.

## A01 Broken Access Control (ASVS V4)

- ✅ Deny by default: every `/v1` backend route requires a valid internal JWT.
- ✅ RBAC enforced in the BFF **and** in each backend (admin vs viewer).
- ✅ Identity (`created_by`, actor IDs) comes from the server-side session, never the request body.
- ✅ Admin-only page (`/audit`) redirects viewers to a 403 page.
- ✅ Open-redirect protection on `?next=`.
- ✅ CORS not enabled on backends; BFF is same-origin only.

## A02 Cryptographic Failures (V2, V3, V6)

- ✅ argon2id password hashing (19 MiB, t=2, p=1).
- ✅ Session tokens: 256-bit CSPRNG; stored as SHA-256 only.
- ✅ Internal JWT: Ed25519 (EdDSA), 60 s lifetime, audience-scoped.
- ✅ HSTS in production (web + backends); TLS provided by hosting platforms.
- 🟡 Key rotation: `kid` header present; rotation procedure documented in the deployment runbook, not automated.

## A03 Injection (V5)

- ✅ Parameterized queries everywhere; LIKE wildcards escaped.
- ✅ Strict input validation (Zod / Go validators / Pydantic `extra="forbid"`).
- ✅ Control characters rejected in free text; tracing headers sanitized (log injection).
- ✅ React output escaping; no `dangerouslySetInnerHTML`.

## A04 Insecure Design

- ✅ Threat model (STRIDE) with abuse cases.
- ✅ Payment state machine + DB constraints + row locks; idempotency keys.
- ✅ Monitoring restricted to an allowlist; on-demand checks (no false 24/7 claims).

## A05 Security Misconfiguration (V14)

- ✅ Security headers: CSP with per-request nonce, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, `Cache-Control: no-store` on APIs.
- ✅ `X-Powered-By` removed; FastAPI docs disabled in production; Gin release mode.
- ✅ Configuration validated at startup (fail fast with clear messages).
- ✅ Non-root containers; distroless runtime for Go.
- ✅ Demo endpoints behind `DEMO_ENDPOINTS_ENABLED`.

## A06 Vulnerable and Outdated Components (V14.2)

- ✅ Lockfiles: `package-lock.json`, `go.sum`, `uv.lock`.
- ✅ CI: `npm audit`, `govulncheck`, `pip-audit`; Dependabot for npm, Go, pip, Docker, Actions.
- 🟡 Known moderate advisories in dev-only ESLint tooling (`typescript-eslint` via `eslint-config-next`) — tracked, not shipped to production.

## A07 Identification and Authentication Failures (V2, V3)

- ✅ Login rate limiting (per IP) + account lockout; generic error messages.
- ✅ Session idle + absolute timeouts; logout revokes server-side; password change revokes other sessions.
- ✅ Cookies: HttpOnly, Secure (prod), SameSite=Lax, `__Host-` prefix (prod).
- ✅ CSRF tokens + Origin checks for every state change; login CSRF via Origin.
- 🟡 No MFA, no password reset by e-mail (out of MVP scope — see KNOWN_LIMITATIONS).

## A08 Software and Data Integrity Failures

- ✅ GitHub Actions pinned to commit SHAs; least-privilege `permissions:`.
- ✅ No secrets exposed to pull requests from forks.
- ✅ Append-only payment history (DB trigger).

## A09 Security Logging and Monitoring Failures (V7)

- ✅ Audit events: login success/failure, lockout, rate limiting, logout, password change, access denied, CSRF rejection.
- ✅ Structured JSON logs with request + correlation IDs; no secrets in logs.
- 🟡 No central log storage/alerting (free tiers); documented.

## A10 Server-Side Request Forgery (V12.6)

- ✅ Origin allowlist (scheme + host + port) configured server-side.
- ✅ Metadata IPs/hostnames always blocked; link-local, multicast, reserved, 0.0.0.0/8 blocked; private ranges blocked unless explicitly enabled.
- ✅ All resolved IPs validated; DNS pinning with Host/SNI preserved; env proxies ignored.
- ✅ Redirects re-validated (max 2); timeouts; max response bytes; max concurrency.

## Before every release

- [ ] All CI jobs green (lint, types, unit, integration, E2E, audits, secret scan).
- [ ] No new `TODO` hiding MVP features; limitations documented.
- [ ] `git diff` reviewed; no `.env`, keys or dumps staged.
- [ ] New endpoints have RBAC + validation + tests.
- [ ] Threat model updated if a new external interaction was added.
