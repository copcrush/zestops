-- Monitoring schema: owned by the Python Monitoring API.

CREATE FUNCTION monitoring.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Approved services that may be health-checked. target_url is validated
-- against a server-side allowlist before insert (SSRF protection).
CREATE TABLE monitoring.services (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  description           text        NOT NULL DEFAULT '',
  target_url            text        NOT NULL,
  expected_status_code  integer     NOT NULL DEFAULT 200,
  timeout_ms            integer     NOT NULL DEFAULT 3000,
  degraded_threshold_ms integer     NOT NULL DEFAULT 1000,
  is_enabled            boolean     NOT NULL DEFAULT true,
  is_demo_seed          boolean     NOT NULL DEFAULT false,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_name_key UNIQUE (name),
  CONSTRAINT services_name_length_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT services_description_length_check CHECK (char_length(description) <= 280),
  CONSTRAINT services_target_url_check CHECK (target_url ~ '^https?://' AND char_length(target_url) <= 2048),
  CONSTRAINT services_expected_status_code_check CHECK (expected_status_code BETWEEN 100 AND 599),
  CONSTRAINT services_timeout_ms_check CHECK (timeout_ms BETWEEN 100 AND 10000),
  CONSTRAINT services_degraded_threshold_ms_check CHECK (degraded_threshold_ms BETWEEN 1 AND timeout_ms)
);

CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON monitoring.services
  FOR EACH ROW EXECUTE FUNCTION monitoring.set_updated_at();

-- One row per executed health check (monitoring history).
CREATE TABLE monitoring.check_results (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id       uuid        NOT NULL REFERENCES monitoring.services (id) ON DELETE CASCADE,
  status           text        NOT NULL,
  http_status_code integer,
  latency_ms       integer,
  error_code       text,
  error_message    text,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  triggered_by     uuid,
  CONSTRAINT check_results_status_check CHECK (status IN ('up', 'degraded', 'down')),
  CONSTRAINT check_results_http_status_code_check CHECK (http_status_code IS NULL OR http_status_code BETWEEN 100 AND 599),
  CONSTRAINT check_results_latency_ms_check CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT check_results_error_code_check CHECK (error_code IS NULL OR error_code ~ '^[A-Z_]{3,64}$'),
  CONSTRAINT check_results_error_message_length_check CHECK (char_length(error_message) <= 500),
  CONSTRAINT check_results_down_has_error_check CHECK (status <> 'down' OR error_code IS NOT NULL)
);

CREATE INDEX check_results_service_id_checked_at_idx ON monitoring.check_results (service_id, checked_at DESC);
CREATE INDEX check_results_checked_at_idx ON monitoring.check_results (checked_at DESC);

CREATE TABLE monitoring.incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text        NOT NULL,
  service_id       uuid REFERENCES monitoring.services (id) ON DELETE SET NULL,
  title            text        NOT NULL,
  description      text        NOT NULL DEFAULT '',
  severity         text        NOT NULL,
  status           text        NOT NULL DEFAULT 'open',
  source           text        NOT NULL,
  created_by       uuid,
  acknowledged_by  uuid,
  acknowledged_at  timestamptz,
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolution_note  text,
  is_demo_seed     boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_reference_key UNIQUE (reference),
  CONSTRAINT incidents_title_length_check CHECK (char_length(title) BETWEEN 3 AND 120),
  CONSTRAINT incidents_description_length_check CHECK (char_length(description) <= 2000),
  CONSTRAINT incidents_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT incidents_status_check CHECK (status IN ('open', 'investigating', 'resolved')),
  CONSTRAINT incidents_source_check CHECK (source IN ('manual', 'automatic')),
  CONSTRAINT incidents_manual_has_creator_check CHECK (source = 'automatic' OR created_by IS NOT NULL),
  CONSTRAINT incidents_resolution_check CHECK (
    (status = 'resolved') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
  ),
  CONSTRAINT incidents_resolution_note_length_check CHECK (char_length(resolution_note) BETWEEN 3 AND 2000)
);

CREATE INDEX incidents_status_created_at_idx ON monitoring.incidents (status, created_at DESC);
CREATE INDEX incidents_created_at_idx ON monitoring.incidents (created_at DESC, id DESC);
CREATE INDEX incidents_service_id_idx ON monitoring.incidents (service_id);

-- At most one unresolved automatic incident per service, so repeated failed
-- checks do not create duplicate incidents (also safe under concurrency).
CREATE UNIQUE INDEX incidents_one_open_automatic_per_service_key
  ON monitoring.incidents (service_id)
  WHERE source = 'automatic' AND status <> 'resolved';

CREATE TRIGGER incidents_set_updated_at
  BEFORE UPDATE ON monitoring.incidents
  FOR EACH ROW EXECUTE FUNCTION monitoring.set_updated_at();

-- Timeline of everything that happened to an incident.
CREATE TABLE monitoring.incident_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id uuid        NOT NULL REFERENCES monitoring.incidents (id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  from_status text,
  to_status   text,
  note        text,
  actor_id    uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_events_event_type_check CHECK (event_type IN ('created', 'status_changed', 'note_added')),
  CONSTRAINT incident_events_note_length_check CHECK (char_length(note) <= 2000)
);

CREATE INDEX incident_events_incident_id_idx ON monitoring.incident_events (incident_id, occurred_at, id);
