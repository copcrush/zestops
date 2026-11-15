# Known Limitations

Honest list of what ZestOps does **not** do (yet). Each item is a deliberate scope
decision, not a hidden TODO.

## Product scope

- **Payments are simulated.** No payment gateway, no real money, no card data. Never
  enter real financial or personal information.
- **No refunds, partial captures, multi-currency conversion or settlement reports.**
- **No user management UI.** Users are created with `apps/web/scripts/create-user.mjs`
  (or the local seed). Admins cannot invite users from the dashboard.

## Authentication

- **No MFA** (TOTP/WebAuthn) and **no password reset by e-mail**. Upgrade path: add OIDC
  (ADR-0002, option C) or TOTP in the BFF; backends would not change.
- **Idempotency keys never expire.** A key is permanently tied to its first payment for
  that user. Production systems usually expire keys after ~24 h.
- **IP-based login rate limiting** trusts the hosting platform's `x-forwarded-for`/
  `x-real-ip` headers (correct on Vercel). Behind another proxy, review this first.

## Monitoring

- **Checks run on demand only** (an admin presses "Run checks"). There is no scheduler,
  so ZestOps does **not** provide 24/7 monitoring. Continuous monitoring would need an
  always-on worker (e.g. a paid background worker or an external cron hitting a protected
  endpoint) and is not possible on hosting tiers that sleep when idle.
- Only HTTP(S) `GET` checks with an expected status code; no TLS-expiry, keyword or
  multi-step checks.
- The allowlist is configuration (environment variable), not editable in the UI — on
  purpose, to keep SSRF control with operators.

## Operations

- **Rate limiting in the backends is in-memory per instance.** With several instances,
  each keeps its own counters. Use a shared store (Redis) if scaled out.
- **No central log aggregation or alerting.** Logs are JSON on stdout and live as long
  as the hosting provider keeps them.
- **Migrations are a manual workflow** (`Database migrate` in GitHub Actions); they are
  not run automatically on deploy.
- **Free-tier cold starts**: the first request after idle time can take 30–60 s on free
  backend hosting.

## Development tooling

- `npm audit` reports moderate advisories in **dev-only** ESLint tooling
  (`typescript-eslint` via `eslint-config-next`). Production dependencies report 0.
  Waiting for an upstream release; tracked by Dependabot.
- `govulncheck` could not run inside the AI development sandbox (network policy); it runs
  in CI on every push.

## Optional features not started

- **Zest AI Assistant** (roadmap M10) — requires an owner decision on the model provider.
