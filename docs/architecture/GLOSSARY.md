# Glossary

Terms used in ZestOps, explained for a JavaScript developer.

| Term | Meaning |
|---|---|
| **BFF (Backend-for-Frontend)** | A server that belongs to one frontend and talks to other services on its behalf. Here: the Next.js server. The browser never calls the Go/Python services directly. |
| **Server Component** | A React component that runs only on the server (default in the Next.js App Router). It can read the database and secrets; its code never ships to the browser. |
| **Client Component** | A component marked `"use client"`; runs in the browser for interactivity (forms, dialogs). |
| **Route Handler** | `route.ts` file in `src/app/api/...` that answers HTTP requests (like an Express route). |
| **Proxy (`proxy.ts`)** | Next.js 16 name for middleware: code that runs before each matching request. |
| **Session** | Server-side record that "this browser is signed in as user X". The browser only holds a random token in a cookie. |
| **HttpOnly cookie** | A cookie JavaScript cannot read (`document.cookie` does not show it), which limits damage from XSS. |
| **CSRF** | Cross-Site Request Forgery: another website makes your browser send a request to our site with your cookie. Blocked with SameSite cookies, Origin checks and CSRF tokens. |
| **CSP / nonce** | Content-Security-Policy tells the browser which scripts may run. A nonce is a random value per page load; only scripts carrying it run. |
| **JWT** | JSON Web Token: signed JSON claims (`sub`, `role`, `exp`...). Here only used server-to-server, signed with **EdDSA (Ed25519)**. |
| **`iss` / `aud` / `exp`** | JWT claims: who issued it, which service it is for, when it expires. |
| **RBAC** | Role-Based Access Control: what a role (`admin`, `viewer`) may do. |
| **argon2id** | A slow, memory-hard password hashing algorithm recommended by OWASP. |
| **Idempotency key** | A unique value sent with a "create" request so that retries return the first result instead of creating duplicates. |
| **Request fingerprint** | Hash of the business fields of a request; detects reuse of an idempotency key with a different body. |
| **Minor units** | The smallest unit of a currency (satang, cent). 1,250.50 THB = 125050 minor units. Avoids floating point. |
| **State machine** | The allowed status changes of a payment or incident (e.g. `pending → processing → succeeded`). |
| **Transaction** | A group of SQL statements that all succeed or all fail together. |
| **Row lock (`SELECT … FOR UPDATE`)** | Makes other transactions wait before changing the same row, preventing races. |
| **Keyset pagination** | "Give me rows after this (created_at, id)" instead of `OFFSET`; fast and stable while data changes. |
| **Schema (PostgreSQL)** | A namespace inside a database (`identity`, `payments`, `monitoring`). |
| **Migration** | A versioned SQL file that changes the database structure; applied once, tracked in `zestops_migrations`. |
| **Least privilege** | Each component gets only the permissions it needs (e.g. the payment role cannot delete payments). |
| **SSRF** | Server-Side Request Forgery: tricking a server into making requests to internal systems (e.g. `169.254.169.254`, the cloud metadata service). |
| **Allowlist** | Explicit list of allowed values (here: monitoring origins); everything else is denied. |
| **DNS rebinding** | A host name that resolves to a safe IP when checked and a private IP when used. Prevented by connecting to the already-validated IP (DNS pinning). |
| **Correlation ID / Request ID** | IDs written to logs so one user action can be followed through several services. |
| **Health check: live / ready** | `live`: the process runs. `ready`: it can serve traffic (database reachable). |
| **Cold start** | Free hosting tiers stop idle services; the first request wakes them up (can take 30–60 s). |
| **Go `context`** | Carries deadlines/cancellation through a request; the first parameter of most Go functions (`ctx`). |
| **Go `error`** | Go returns errors as values (`result, err := f()`); every `err` must be checked. |
| **Gin** | Go HTTP framework (routing + middleware), similar to Express. |
| **pgx** | Go PostgreSQL driver. |
| **FastAPI** | Python web framework; uses type hints for validation and docs. |
| **Pydantic** | Python data validation library (like Zod). |
| **SQLAlchemy** | Python database toolkit / ORM. |
| **`async` / `await` (Python)** | Same idea as in JavaScript: non-blocking I/O on an event loop. |
| **uv** | Fast Python package manager with a lockfile (`uv.lock`), similar to npm. |
| **Distroless image** | A container image without a shell or package manager — smaller attack surface. |
| **STRIDE** | Threat categories: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege. |
