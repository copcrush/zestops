# ADR-0002: Application-managed authentication with a BFF, server-side sessions, and internal JWTs

- Status: Accepted (owner decision, option B)
- Date: 2026-11-14

## Context

Authentication and RBAC (admin, viewer) are mandatory. Options considered:

| | A: Managed OIDC (Auth0/Clerk/Google) | B: App-managed BFF | C: Hybrid OIDC + app RBAC |
|---|---|---|---|
| Password storage | Provider | Us (argon2id) | Provider |
| Complexity | Medium–high | Medium | Highest |
| Cost | Free tier, vendor lock-in | Free | Free tier |
| Testable offline / in CI | Needs provider network access | Yes | Needs provider |
| Interview demo | Reviewer needs an IdP account | Shared demo accounts | Both |

## Decision

Option **B**:

1. **Next.js acts as a Backend-for-Frontend (BFF).** The browser only talks to
   Next.js. It never calls the Go or Python APIs directly.
2. **Login** verifies an argon2id password hash stored in the `identity` schema.
   Brute force is limited by a per-account lockout and a per-IP rate limit
   stored in PostgreSQL (works on serverless hosting).
3. **Sessions** are server-side. The browser holds an opaque random 256-bit
   token in an `HttpOnly`, `Secure` (production), `SameSite=Lax` cookie
   (`__Host-` prefix in production). The database stores only a SHA-256 hash of
   the token, plus idle and absolute expiry. Logout deletes the session row, so
   revocation is immediate.
4. **CSRF**: every state-changing BFF request must send `X-CSRF-Token`, an
   HMAC of the session ID, and must have a matching `Origin` header.
5. **Service-to-service auth**: for each backend call, the BFF signs a
   short-lived (≤ 5 minutes) **EdDSA (Ed25519) JWT** with claims `iss`, `aud`
   (one audience per backend), `sub` (user ID), `role`, `iat`, `nbf`, `exp`,
   `jti`. Backends verify signature (only `EdDSA` accepted), issuer, audience,
   expiry, and maximum token lifetime with the **public** key. The private key
   exists only in the web app.
6. **RBAC is enforced twice**: in the BFF (to give fast, friendly errors and
   hide UI) and in each backend (the real security boundary).

## Consequences

- No tokens ever reach the browser or `localStorage`.
- We own password security: hashing parameters, lockout, rate limiting,
  password change, session revocation. These are covered by tests.
- No MFA in the MVP (documented in known limitations).
- Upgrading to OIDC later (option C) only changes the login step in the BFF;
  backends keep verifying the same internal JWT.
