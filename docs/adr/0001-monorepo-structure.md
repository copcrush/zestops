# ADR-0001: Single monorepo for all services

- Status: Accepted
- Date: 2026-11-14

## Context

ZestOps has a Next.js web app, a Go Payment API, a Python Monitoring API,
database migrations, infrastructure, and documentation. The owner works on both
Windows and macOS and wants one repository (`copcrush/zestops`).

## Decision

Use one monorepo:

- `apps/web` — Next.js dashboard and Backend-for-Frontend (BFF)
- `services/payment-api` — Go service
- `services/monitoring-api` — Python service
- `infra/` — database migrations, bootstrap SQL, seeds, deployment config
- `docs/` — architecture, ADRs, API, security, runbooks

Each app/service keeps its own dependency manifest (`package.json`, `go.mod`,
`pyproject.toml`). There is no workspace tool (Turborepo, Nx, Bazel): three
independent toolchains do not benefit from one, and it would add a concept the
owner has to learn without solving a present problem.

## Consequences

- One clone, one CI configuration, atomic cross-service changes.
- CI uses path filters so that a Go-only change does not rebuild the web app.
- Deployment platforms point at sub-directories (`apps/web` on Vercel, Docker
  contexts for the backends).
