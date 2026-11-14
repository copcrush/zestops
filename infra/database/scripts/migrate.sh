#!/bin/sh
# -----------------------------------------------------------------------------
# Apply ZestOps SQL migrations with golang-migrate.
#
# Runs inside the official migrate/migrate Docker image (see compose.yaml),
# so it works the same on Windows, macOS and Linux.
#
# Environment:
#   MIGRATION_DATABASE_URLS  Space-separated owner connection URLs. Each one is
#                            migrated for all schemas (identity, payments, monitoring).
#   MIGRATIONS_DIR           Defaults to /migrations
#
# Usage:  migrate.sh up        Apply all pending migrations (default)
#         migrate.sh version   Print the current version of each schema
#
# Destructive commands (down, drop, force) are intentionally NOT supported here.
# -----------------------------------------------------------------------------
set -eu

command_name="${1:-up}"
migrations_dir="${MIGRATIONS_DIR:-/migrations}"
schemas="identity payments monitoring"

case "$command_name" in
  up|version) ;;
  *) echo "Unsupported command '$command_name'. Use 'up' or 'version'." >&2; exit 2 ;;
esac

if [ -z "${MIGRATION_DATABASE_URLS:-}" ]; then
  echo "MIGRATION_DATABASE_URLS is not set." >&2
  exit 2
fi

for database_url in $MIGRATION_DATABASE_URLS; do
  case "$database_url" in
    *\?*) separator="&" ;;
    *) separator="?" ;;
  esac
  # Print the database name only (never the password).
  database_name=$(echo "$database_url" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')

  for schema in $schemas; do
    # Each schema keeps its own history table: zestops_migrations.<schema>
    tracking_table="x-migrations-table=%22zestops_migrations%22.%22${schema}%22&x-migrations-table-quoted=1"
    echo "==> [$database_name] $schema: $command_name"
    migrate -path "$migrations_dir/$schema" \
      -database "${database_url}${separator}${tracking_table}" \
      "$command_name"
  done
done

echo "==> Migrations finished."
