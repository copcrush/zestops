# CLAUDE.md — Web app & BFF (Next.js 16 / TypeScript)

Read the root `CLAUDE.md` first. This file adds web-specific rules.

> Next.js 16 has breaking changes compared to older versions (e.g. `middleware.ts`
> is now `src/proxy.ts`, `params`/`searchParams` are Promises, `PageProps<...>`
> and `LayoutProps<...>` are generated global types). Check
> `node_modules/next/dist/docs/` before using an API you are unsure about.

## What this app does

1. Renders the dashboard (Server Components read data on the server).
2. Acts as the **BFF (Backend-for-Frontend)**: the browser only talks to this app.
   It owns users and sessions (`identity` schema) and signs a short-lived internal
   JWT for every call to the Go and Python services (ADR-0002).

## Layout

| Path | Responsibility |
|---|---|
| `src/proxy.ts` | Per-request CSP nonce + optimistic "no cookie -> /login" redirect |
| `src/app/(dashboard)/**/page.tsx` | Signed-in pages. **Each page calls `requireSession()`** |
| `src/app/api/**/route.ts` | BFF endpoints for mutations. Wrap with `protectedRoute()` |
| `src/features/auth/server/` | Sessions, login, CSRF, password hashing, rate limit, audit |
| `src/features/*/server/*-api.ts` | Typed read helpers for the backends (server-only) |
| `src/features/*/components/` | Client Components (forms, dialogs, action buttons) |
| `src/lib/server/` | env validation, DB pool, logger, backend client, route wrapper |
| `src/lib/shared/` | Code safe for server AND browser: money, zod schemas, formatting |
| `src/lib/browser/api-client.ts` | `sendApiRequest()` — fetch wrapper adding the CSRF header |
| `src/components/ui/` | Design-system components (Playful Neobrutalism, primary `#C7E6A0`) |
| `tests/unit`, `tests/integration`, `tests/e2e` | Vitest unit, Vitest + PostgreSQL, Playwright |

## Rules

- Files that touch secrets, the DB or the backends start with `import "server-only"`.
- Never put tokens in `localStorage`, React state that reaches the client, or URLs.
- Every state-changing endpoint uses `protectedRoute({ permission })`, validates its
  body with a Zod schema from `lib/shared/validation-schemas.ts`, and checks path IDs
  with `uuidSchema` before forwarding.
- Hide admin-only UI with `hasPermission()`, but never rely on hiding: the BFF and the
  backends enforce the same rule.
- Money: integer minor units. Use `parseDecimalToMinorUnits` / `formatMoney`; never
  `parseFloat` on amounts.
- No inline `style` attributes: the production CSP does not allow them. Use Tailwind
  classes, or SVG attributes for dynamic sizes (see `latency-chart.tsx`).
- Pages that must load scripts but have no dynamic data still need `await connection()`
  so the CSP nonce is applied (see `src/app/unauthorized/page.tsx`).
- Cache Components (`cacheComponents`) is intentionally disabled: every page is
  per-user. Don't add `"use cache"` without discussing it.
- Tables go inside `<DataTable>` (it has `relative overflow-x-auto`; without
  `relative`, screen-reader-only labels widen the whole page on mobile).

## Commands

```bash
npm run dev            # http://localhost:3000 (needs docker compose up -d)
npm run lint           # ESLint
npm run typecheck      # next typegen + tsc
npm test               # Vitest unit + integration (integration needs the test DB)
npm run test:e2e       # Playwright (needs the full stack running)
npm run build          # production build
```

In sandboxes whose pre-installed Chromium belongs to another Playwright version, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to that browser for `npm run test:e2e`.

## Adding a BFF endpoint

1. Add a Zod schema in `src/lib/shared/validation-schemas.ts`.
2. Create `src/app/api/<name>/route.ts` exporting `protectedRoute({ permission }, handler)`.
3. Forward with `callBackend(...)` and return `relayBackendResponse(...)`.
4. Call it from a Client Component with `sendApiRequest()`; refresh with `router.refresh()`.
5. Add unit tests for the schema and an E2E test for the user flow.
