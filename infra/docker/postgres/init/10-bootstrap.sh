#!/bin/sh
# Runs automatically the FIRST time the local PostgreSQL container starts
# (official postgres image: /docker-entrypoint-initdb.d).
# Creates the test database and applies the bootstrap (schemas + roles) to both.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE ${POSTGRES_TEST_DB:-zestops_test};"

for database_name in "$POSTGRES_DB" "${POSTGRES_TEST_DB:-zestops_test}"; do
  echo "Bootstrapping database: $database_name"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database_name" \
    -v web_app_password="$ZESTOPS_WEB_DB_PASSWORD" \
    -v payment_app_password="$ZESTOPS_PAYMENT_DB_PASSWORD" \
    -v monitoring_app_password="$ZESTOPS_MONITORING_DB_PASSWORD" \
    -f /zestops/bootstrap/bootstrap.sql
done
