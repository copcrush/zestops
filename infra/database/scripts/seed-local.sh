#!/bin/sh
# Load LOCAL demo seed data. Refuses to run unless SEED_ENVIRONMENT=local.
set -eu

if [ "${SEED_ENVIRONMENT:-}" != "local" ]; then
  echo "Refusing to seed: SEED_ENVIRONMENT must be 'local'." >&2
  exit 2
fi

: "${SEED_DATABASE_URL:?SEED_DATABASE_URL is required}"
seeds_dir="${SEEDS_DIR:-/seeds/local}"

for seed_file in "$seeds_dir"/*.sql; do
  echo "==> Seeding $(basename "$seed_file")"
  psql "$SEED_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -v payment_api_health_url="${SEED_PAYMENT_API_HEALTH_URL:-http://payment-api:8080/health/ready}" \
    -v monitoring_api_health_url="${SEED_MONITORING_API_HEALTH_URL:-http://monitoring-api:8000/health/ready}" \
    -v unstable_demo_url="${SEED_UNSTABLE_DEMO_URL:-http://monitoring-api:8000/demo/unstable}" \
    -f "$seed_file"
done
echo "==> Seed finished."
