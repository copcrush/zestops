# ADR-0004: Testing stack

- Status: Accepted (owner approved)
- Date: 2026-11-14

## Decision

| Layer | Tool | Purpose |
|---|---|---|
| Web unit/component | Vitest + Testing Library | Pure logic (money parsing, CSRF, RBAC helpers), components |
| Browser E2E | Playwright | Real browser against the full stack (login, payments, incidents, RBAC) |
| Payment API | Go `testing` + testify | Unit tests for rules, integration tests against real PostgreSQL, concurrency tests |
| Monitoring API | pytest + pytest-asyncio + httpx | API tests, SSRF guard tests, integration tests against real PostgreSQL |
| Contracts | OpenAPI documents + typed clients | Lightweight; consumer-driven contract tools (Pact) are not justified for two internal services |

Jest and Playwright are not alternatives: Jest/Vitest run code in Node,
Playwright drives a browser. Vitest was chosen over Jest because it supports
TypeScript and ES modules without extra transforms and has a Jest-compatible API.

Integration tests use a real PostgreSQL (Docker locally, service containers in
CI), never mocks, because constraints, locks and transactions are exactly what
we need to verify.
