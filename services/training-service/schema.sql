-- A Training Session is written once when it starts and never updated. Its
-- current state (open, completed, blocked) is derived from session_events.
CREATE TABLE IF NOT EXISTS training_service.sessions (
  session_id uuid PRIMARY KEY,
  agent_learner_key text NOT NULL,
  configuration_fingerprint text NOT NULL,
  configuration_version integer NOT NULL,
  package_id text NOT NULL,
  package_version text NOT NULL,
  -- The validation service's digest, stored exactly as received (no padding or format assumption).
  package_digest text NOT NULL,
  started_at timestamptz NOT NULL,
  correlation_id text NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_learner
  ON training_service.sessions (agent_learner_key, started_at);

-- Append-only progress. Each row names its package, module, objectives,
-- evidence mode, environment and time so it stands alone as evidence.
CREATE TABLE IF NOT EXISTS training_service.session_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES training_service.sessions(session_id),
  seq integer NOT NULL CHECK (seq > 0),
  event_type text NOT NULL CHECK (event_type IN
    ('session_started', 'item_delivered', 'item_completed', 'session_completed', 'session_blocked')),
  package_id text NOT NULL,
  package_version text NOT NULL,
  module_id text,
  module_sequence integer,
  objective_ids text[] NOT NULL DEFAULT '{}',
  delivery_item_id text,
  evidence_mode text NOT NULL CHECK (evidence_mode IN ('synthetic', 'replay', 'live', 'fallback')),
  evidence_environment text NOT NULL CHECK (evidence_environment IN ('simulation', 'live')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text NOT NULL,
  actor text NOT NULL,
  idempotency_key text,
  request_fingerprint text,
  response_digest text,
  stored_response jsonb,
  block_reason text,
  -- Only live evidence may claim the live environment, as in the protocol contract.
  CHECK ((evidence_mode = 'live') = (evidence_environment = 'live')),
  -- One event per position, so a concurrent duplicate append fails instead of forking progress.
  UNIQUE (session_id, seq),
  -- A retried request finds its original row instead of writing a second one.
  -- Block and completion events have no key; PostgreSQL allows many NULLs.
  UNIQUE (session_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION training_service.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable training evidence'; END $$;

DROP TRIGGER IF EXISTS sessions_immutable ON training_service.sessions;
CREATE TRIGGER sessions_immutable BEFORE UPDATE OR DELETE ON training_service.sessions
FOR EACH ROW EXECUTE FUNCTION training_service.forbid_evidence_change();
DROP TRIGGER IF EXISTS session_events_immutable ON training_service.session_events;
CREATE TRIGGER session_events_immutable BEFORE UPDATE OR DELETE ON training_service.session_events
FOR EACH ROW EXECUTE FUNCTION training_service.forbid_evidence_change();
