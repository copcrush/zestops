# CLAUDE.md — Monitoring API (Python / FastAPI)

Read the root `CLAUDE.md` first. This file adds Python-specific rules.

## Layout (request flow top to bottom)

| Folder | Responsibility |
|---|---|
| `app/main.py` | `create_app()` factory: settings, DB engine, middleware, routers |
| `app/api/` | **HTTP entry points** (FastAPI routers). Thin: parse input, call a service |
| `app/api/dependencies.py` | DB session, `CurrentPrincipal` (JWT auth + rate limit), `AdminPrincipal` (RBAC) |
| `app/schemas/` | **Validation**: Pydantic request/response models (`extra="forbid"`) |
| `app/services/` | **Business logic**: checks, automatic incidents, incident state machine |
| `app/services/health_checker.py` | SSRF-safe HTTP check (DNS pinning, limits) |
| `app/security/` | `auth.py` (internal JWT), `ssrf.py` (target allowlist + IP policy) |
| `app/repositories/` | **Database queries** (SQLAlchemy, always bound parameters) |
| `app/models/` | ORM table mappings (tables are created by SQL migrations, not SQLAlchemy) |
| `app/core/` | config, JSON logging, error envelope, middleware, rate limiter |
| `tests/` | pytest: unit tests + API tests against real PostgreSQL + a local HTTP target server |

## Rules

- Full type hints; `uv run mypy` (strict) must pass.
- Request models inherit `RequestModel` (unknown fields rejected). Free text uses `CleanText`.
- Endpoints that change data depend on `AdminPrincipal`; read endpoints on `CurrentPrincipal`.
- Raise `AppError` subclasses for expected errors; never return raw exception text.
- Any outbound HTTP request MUST go through `HealthChecker` (never call httpx directly
  with a user-supplied URL).
- Status changes on incidents use `get_incident_for_update` (row lock) inside one commit.
- Log with `logger.info("message", extra={...})`. Never log tokens or request bodies.

## Commands

```bash
uv sync                                                    # install dependencies
uv run uvicorn app.main:create_app --factory --reload --port 8000
uv run ruff check . && uv run ruff format --check .        # lint + format
uv run mypy                                                # type check (strict)
uv run pytest                                              # tests (needs docker compose up -d)
uv run pip-audit                                           # dependency vulnerabilities
```

## Adding an endpoint

1. Pydantic schema in `app/schemas/`.
2. Business logic in `app/services/`, queries in `app/repositories/`.
3. Route in `app/api/` with `CurrentPrincipal` or `AdminPrincipal`.
4. Tests in `tests/` (happy path, validation, RBAC, edge cases).
