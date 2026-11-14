-- Payments schema: owned by the Go Payment API.
-- All payments are SIMULATED. Amounts are integer minor units (see ADR-0005).

CREATE FUNCTION payments.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Supported currencies and how many decimal places their minor unit has.
CREATE TABLE payments.currencies (
  code                char(3)  PRIMARY KEY,
  display_name        text     NOT NULL,
  minor_unit_exponent smallint NOT NULL,
  CONSTRAINT currencies_code_format_check CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currencies_exponent_check CHECK (minor_unit_exponent BETWEEN 0 AND 3)
);

INSERT INTO payments.currencies (code, display_name, minor_unit_exponent) VALUES
  ('THB', 'Thai Baht', 2),
  ('USD', 'US Dollar', 2),
  ('EUR', 'Euro', 2),
  ('GBP', 'British Pound', 2),
  ('SGD', 'Singapore Dollar', 2),
  ('JPY', 'Japanese Yen', 0);

CREATE TABLE payments.payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-friendly reference shown in the UI, e.g. PAY-7K2M9Q4XZD.
  reference           text        NOT NULL,
  merchant_reference  text        NOT NULL,
  description         text        NOT NULL DEFAULT '',
  amount_minor        bigint      NOT NULL,
  currency            char(3)     NOT NULL REFERENCES payments.currencies (code),
  payment_method      text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  failure_reason      text,
  -- Idempotency: the same user + key always maps to the same payment.
  idempotency_key     text        NOT NULL,
  request_fingerprint text        NOT NULL,
  created_by          uuid        NOT NULL,
  is_demo_seed        boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT payments_reference_key UNIQUE (reference),
  CONSTRAINT payments_idempotency_key UNIQUE (created_by, idempotency_key),
  CONSTRAINT payments_amount_minor_check CHECK (amount_minor > 0 AND amount_minor <= 100000000000),
  CONSTRAINT payments_status_check CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT payments_payment_method_check CHECK (payment_method IN ('card', 'bank_transfer', 'promptpay', 'e_wallet')),
  CONSTRAINT payments_merchant_reference_check CHECK (merchant_reference ~ '^[A-Za-z0-9._:-]{1,64}$'),
  CONSTRAINT payments_description_length_check CHECK (char_length(description) <= 280),
  CONSTRAINT payments_idempotency_key_format_check CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  CONSTRAINT payments_failure_reason_check CHECK (
    (status = 'failed' AND failure_reason IS NOT NULL AND char_length(failure_reason) BETWEEN 1 AND 200)
    OR (status <> 'failed' AND failure_reason IS NULL)
  ),
  -- completed_at is set exactly when the payment reaches a terminal state.
  CONSTRAINT payments_completed_at_check CHECK (
    (status IN ('succeeded', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
  )
);

-- Keyset pagination: newest first, ties broken by id.
CREATE INDEX payments_created_at_id_idx ON payments.payments (created_at DESC, id DESC);
CREATE INDEX payments_status_created_at_id_idx ON payments.payments (status, created_at DESC, id DESC);

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments.payments
  FOR EACH ROW EXECUTE FUNCTION payments.set_updated_at();

-- Append-only history of every status change (audit trail).
CREATE TABLE payments.payment_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id  uuid        NOT NULL REFERENCES payments.payments (id) ON DELETE RESTRICT,
  from_status text,
  to_status   text        NOT NULL,
  actor_id    uuid        NOT NULL,
  actor_role  text        NOT NULL,
  note        text,
  request_id  text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_from_status_check CHECK (from_status IS NULL OR from_status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT payment_events_to_status_check CHECK (to_status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT payment_events_actor_role_check CHECK (actor_role IN ('admin', 'viewer', 'system')),
  CONSTRAINT payment_events_note_length_check CHECK (char_length(note) <= 200)
);

CREATE INDEX payment_events_payment_id_idx ON payments.payment_events (payment_id, occurred_at, id);

-- Events are history: block UPDATE and DELETE even for application roles.
CREATE FUNCTION payments.reject_payment_event_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only';
END;
$$;

CREATE TRIGGER payment_events_append_only
  BEFORE UPDATE OR DELETE ON payments.payment_events
  FOR EACH ROW EXECUTE FUNCTION payments.reject_payment_event_change();
