#!/usr/bin/env bash
# Prepare a fresh PostgreSQL (CI service container) exactly like a real
# environment: bootstrap schemas + least-privilege roles, then run migrations.
#
# Required: CI_DB_OWNER_URL (owner role on the target database).
# The role passwords below are throwaway values for an ephemeral CI database.
set -euo pipefail

: "${CI_DB_OWNER_URL:?CI_DB_OWNER_URL is required}"
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"

psql "$CI_DB_OWNER_URL" -v ON_ERROR_STOP=1 -q \
  -v web_app_password="${CI_WEB_DB_PASSWORD:-ci-web-password}" \
  -v payment_app_password="${CI_PAYMENT_DB_PASSWORD:-ci-payment-password}" \
  -v monitoring_app_password="${CI_MONITORING_DB_PASSWORD:-ci-monitoring-password}" \
  -f "$repository_root/infra/database/bootstrap/bootstrap.sql"

docker run --rm --network host \
  -v "$repository_root/infra/database/migrations:/migrations:ro" \
  -v "$repository_root/infra/database/scripts:/scripts:ro" \
  -e MIGRATION_DATABASE_URLS="$CI_DB_OWNER_URL" \
  --entrypoint /bin/sh migrate/migrate:v4.20.1 /scripts/migrate.sh up
