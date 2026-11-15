-- =============================================================================
-- ZestOps database bootstrap (run ONCE per environment, as the owner role)
-- =============================================================================
-- What this does:
--   1. Creates one schema per service: identity, payments, monitoring
--      (plus zestops_migrations for migration bookkeeping).
--   2. Creates one LOGIN role per service with least privilege:
--        zestops_web_app        -> identity schema only
--        zestops_payment_app    -> payments schema only
--        zestops_monitoring_app -> monitoring schema only
--      Application roles can read/write rows but cannot create, alter or drop
--      tables. Only the owner role (the one running this file and the
--      migrations) can change the schema.
--   3. Sets DEFAULT PRIVILEGES so tables created later by migrations are
--      automatically usable by the matching application role.
--
-- It is idempotent: running it again only re-applies grants and passwords.
--
-- Usage (psql variables supply the passwords; never hard-code them):
--   psql "$OWNER_DATABASE_URL" \
--     -v web_app_password="..." \
--     -v payment_app_password="..." \
--     -v monitoring_app_password="..." \
--     -f infra/database/bootstrap/bootstrap.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- schemas ---
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS monitoring;
-- Migration bookkeeping lives in its own schema that application roles
-- cannot see, so a compromised service cannot tamper with migration history.
CREATE SCHEMA IF NOT EXISTS zestops_migrations;
REVOKE ALL ON SCHEMA zestops_migrations FROM PUBLIC;

-- Nobody except the owner may create objects in the public schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ------------------------------------------------------------------ roles ---
-- CREATE ROLE has no IF NOT EXISTS, so check first. (Plain SQL, no psql-only
-- commands, so the same file also works in a web SQL editor such as Neon's.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zestops_web_app') THEN
    CREATE ROLE zestops_web_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zestops_payment_app') THEN
    CREATE ROLE zestops_payment_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zestops_monitoring_app') THEN
    CREATE ROLE zestops_monitoring_app LOGIN;
  END IF;
END
$$;

-- New roles are already NOSUPERUSER, NOCREATEDB and NOCREATEROLE by default. We do not
-- repeat those attributes: managed PostgreSQL (Neon, ...) does not give the owner
-- superuser rights, and only a superuser may even mention the SUPERUSER attribute.
ALTER ROLE zestops_web_app        WITH LOGIN PASSWORD :'web_app_password';
ALTER ROLE zestops_payment_app    WITH LOGIN PASSWORD :'payment_app_password';
ALTER ROLE zestops_monitoring_app WITH LOGIN PASSWORD :'monitoring_app_password';

-- Each role sees only its own schema by default.
ALTER ROLE zestops_web_app        SET search_path = identity;
ALTER ROLE zestops_payment_app    SET search_path = payments;
ALTER ROLE zestops_monitoring_app SET search_path = monitoring;

-- Defensive limits: a runaway query cannot hold locks forever.
ALTER ROLE zestops_web_app        SET statement_timeout = '15s';
ALTER ROLE zestops_payment_app    SET statement_timeout = '15s';
ALTER ROLE zestops_monitoring_app SET statement_timeout = '15s';

-- ------------------------------------------------------- schema access ---
GRANT USAGE ON SCHEMA identity   TO zestops_web_app;
GRANT USAGE ON SCHEMA payments   TO zestops_payment_app;
GRANT USAGE ON SCHEMA monitoring TO zestops_monitoring_app;

-- identity: sessions and rate-limit rows are deleted on logout/cleanup.
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zestops_web_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT USAGE, SELECT ON SEQUENCES TO zestops_web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO zestops_web_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity TO zestops_web_app;

-- payments: financial records are never deleted by the application.
ALTER DEFAULT PRIVILEGES IN SCHEMA payments
  GRANT SELECT, INSERT, UPDATE ON TABLES TO zestops_payment_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA payments
  GRANT USAGE, SELECT ON SEQUENCES TO zestops_payment_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA payments TO zestops_payment_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA payments TO zestops_payment_app;

-- monitoring: services are disabled, not deleted; history is append-only.
ALTER DEFAULT PRIVILEGES IN SCHEMA monitoring
  GRANT SELECT, INSERT, UPDATE ON TABLES TO zestops_monitoring_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA monitoring
  GRANT USAGE, SELECT ON SEQUENCES TO zestops_monitoring_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA monitoring TO zestops_monitoring_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA monitoring TO zestops_monitoring_app;
