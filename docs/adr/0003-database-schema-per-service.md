# ADR-0003: One PostgreSQL database, one schema and one role per service, SQL migrations

- Status: Accepted
- Date: 2026-11-14

## Context

Free managed PostgreSQL tiers usually allow one small database. We still want
clear service ownership and least privilege.

## Decision

- One database, three schemas: `identity` (web), `payments` (payment-api),
  `monitoring` (monitoring-api).
- Each service connects with its own login role that can only use its own
  schema and only perform data manipulation (no DDL). A separate owner role
  runs migrations.
- Migrations are plain, versioned SQL files in
  `infra/database/migrations/<schema>/` using the
  [golang-migrate](https://github.com/golang-migrate/migrate) file format
  (`000001_name.up.sql` / `.down.sql`). One tool, one format, readable by
  anyone who knows SQL. Each schema tracks applied versions in its own
  `<schema>.schema_migrations` table.
- Migrations run as an explicit step (`docker compose run --rm migrate`
  locally; a manually triggered workflow in production), never automatically
  on application start, because application roles intentionally lack DDL rights.
- Services never join across schemas. Cross-service references (for example
  `payments.created_by` → a user ID) are plain UUIDs without foreign keys.

## Consequences

- Least privilege: a SQL injection in one service cannot alter another
  service's tables or the schema itself.
- A schema can later move to its own database without code changes in other
  services.
- Production migrations need a deliberate human-triggered step (documented in
  `docs/runbooks/DEPLOYMENT.md`).
