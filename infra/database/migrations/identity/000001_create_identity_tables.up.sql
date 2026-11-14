-- Identity schema: owned by the web app (BFF).
-- Stores users, server-side sessions, login rate-limit buckets and an audit log.

CREATE FUNCTION identity.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE identity.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text        NOT NULL,
  display_name       text        NOT NULL,
  password_hash      text        NOT NULL,
  role               text        NOT NULL,
  is_active          boolean     NOT NULL DEFAULT true,
  failed_login_count integer     NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'viewer')),
  CONSTRAINT users_email_format_check CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(email) <= 254),
  CONSTRAINT users_display_name_length_check CHECK (char_length(display_name) BETWEEN 1 AND 80),
  CONSTRAINT users_failed_login_count_check CHECK (failed_login_count >= 0)
);

-- Emails are unique regardless of letter case.
CREATE UNIQUE INDEX users_email_lower_key ON identity.users (lower(email));

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION identity.set_updated_at();

CREATE TABLE identity.sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  -- SHA-256 of the random session token. The raw token only exists in the cookie.
  token_hash          bytea       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  user_agent          text,
  ip_address          inet,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_length_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_expiry_order_check CHECK (idle_expires_at <= absolute_expires_at),
  CONSTRAINT sessions_user_agent_length_check CHECK (char_length(user_agent) <= 512)
);

CREATE INDEX sessions_user_id_idx ON identity.sessions (user_id);
CREATE INDEX sessions_absolute_expires_at_idx ON identity.sessions (absolute_expires_at);

-- Fixed-window counters used to rate-limit login attempts per IP address.
-- Stored in PostgreSQL so limits work on serverless hosting with many instances.
CREATE TABLE identity.rate_limit_buckets (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  hit_count    integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start),
  CONSTRAINT rate_limit_buckets_hit_count_check CHECK (hit_count >= 0)
);

CREATE INDEX rate_limit_buckets_window_start_idx ON identity.rate_limit_buckets (window_start);

-- Security audit log (login success/failure, logout, password change, ...).
-- Never store passwords, tokens or full request bodies here.
CREATE TABLE identity.audit_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text        NOT NULL,
  actor_user_id uuid REFERENCES identity.users (id) ON DELETE SET NULL,
  ip_address    inet,
  request_id    text,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_event_type_check CHECK (event_type ~ '^[a-z_]{3,64}$')
);

CREATE INDEX audit_events_occurred_at_idx ON identity.audit_events (occurred_at DESC);
CREATE INDEX audit_events_actor_user_id_idx ON identity.audit_events (actor_user_id, occurred_at DESC);
