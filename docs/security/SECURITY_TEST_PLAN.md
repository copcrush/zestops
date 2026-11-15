# Security Test Plan

Automated security tests run on every CI build. Manual checks are listed for UAT.

## Automated

| Area | Test | Location | Runs in |
|---|---|---|---|
| JWT verification | alg none, HS256 confusion with public key, RS256, wrong issuer/audience, expired, nbf in future, lifetime > 5 min, tampered signature, non-UUID subject, unknown role | `services/payment-api/internal/auth/token_test.go`, `services/monitoring-api/tests/test_auth.py` | CI: Go, Python |
| Backend RBAC | Viewer → 403 on every write route; unauthenticated → 401 on every protected route | `services/payment-api/tests/integration`, `services/monitoring-api/tests/test_api_*.py` | CI |
| BFF RBAC + CSRF | Viewer with valid CSRF token → 403; no CSRF token → 403; foreign Origin → 403 | `apps/web/tests/e2e/rbac.spec.ts` | CI: E2E |
| Sessions | HttpOnly/SameSite cookie, logout revokes token, expired/deleted/disabled sessions rejected, token stored hashed | `apps/web/tests/e2e/auth.spec.ts`, `apps/web/tests/integration/auth.test.ts` | CI |
| Brute force | Lockout after 5 failures (even with correct password afterwards); per-IP rate limit | `apps/web/tests/integration/auth.test.ts` | CI |
| Open redirect | External, protocol-relative, backslash, newline paths rejected | `apps/web/tests/unit/security-helpers.test.ts`, E2E | CI |
| Input validation | SQL/HTML payloads, control characters, floats for money, unknown fields, oversized bodies, wrong content type | Go `validation_test.go` + integration, Python API tests, web schema tests | CI |
| SSRF | Allowlist bypasses (decimal IP, userinfo trick, homograph, schemes, ports), metadata/private/link-local IPs, IPv4-mapped IPv6, redirect to metadata, DNS rebinding, mixed DNS answers, oversized/streamed responses, timeouts, concurrency limit | `services/monitoring-api/tests/test_ssrf_policy.py`, `test_health_checker.py` | CI |
| Concurrency | Idempotent create (25 parallel), single settlement (20 parallel), single incident resolution (8 parallel), single automatic incident | Go integration, Python API tests | CI |
| DB least privilege | App role cannot CREATE TABLE, DELETE payments, UPDATE payment history | `TestDatabaseConstraintsProtectPaymentInvariants` | CI |
| Security headers | CSP with nonce, frame-ancestors, X-Frame-Options, nosniff, no X-Powered-By, no CORS on backends | E2E `auth.spec.ts`, Go/Python platform tests | CI |
| Dependencies | `npm audit --omit=dev`, `govulncheck`, `pip-audit` | `.github/workflows/security.yml` | CI + weekly |
| Secrets | gitleaks scan of the repository history | `.github/workflows/security.yml` | CI |

## Mutation checks performed during development

To confirm tests detect real bugs, locks were temporarily removed:

- Without `FOR UPDATE` in the Payment API, the concurrent simulation test reported 4 settlements instead of 1 → test failed as expected.
- Without `with_for_update()` in the Monitoring API, 8 concurrent resolutions all succeeded → test failed as expected.

## Manual UAT security checks

1. Sign in as viewer: confirm no admin buttons and `/audit` shows the 403 page.
2. Open DevTools → Application → Cookies: session cookie is HttpOnly (+ Secure in production).
3. DevTools console: no CSP violations on any page.
4. Try 6 wrong passwords for one account: the 6th attempt with the right password still fails for 15 minutes.
5. Monitoring → Register service with `http://169.254.169.254/latest/meta-data/`: rejected.
6. Sign in on two browsers, change password in one: the other is signed out.
