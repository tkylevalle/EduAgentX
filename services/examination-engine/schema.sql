-- Issue #16 admission seam. Issue #17 extends the event vocabulary and
-- response/grade transitions; this immutable manifest is their common root.
CREATE TABLE IF NOT EXISTS examination_engine.attempts (
  attempt_id uuid PRIMARY KEY,
  agent_learner_key text NOT NULL,
  idempotency_key text NOT NULL,
  configuration_fingerprint text NOT NULL,
  package_id text NOT NULL,
  package_version text NOT NULL,
  package_digest text NOT NULL,
  form_digest text NOT NULL,
  form jsonb NOT NULL,
  mode text NOT NULL CHECK (mode = 'standard'),
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL CHECK (deadline_at > started_at),
  correlation_id text NOT NULL,
  UNIQUE (agent_learner_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS examination_engine.attempt_events (
  attempt_id uuid NOT NULL REFERENCES examination_engine.attempts(attempt_id),
  seq integer NOT NULL CHECK (seq > 0),
  event_type text NOT NULL CHECK (event_type = 'attempt_started'),
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  PRIMARY KEY (attempt_id, seq)
);

CREATE OR REPLACE FUNCTION examination_engine.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable examination evidence'; END $$;
DROP TRIGGER IF EXISTS attempts_immutable ON examination_engine.attempts;
CREATE TRIGGER attempts_immutable BEFORE UPDATE OR DELETE ON examination_engine.attempts
FOR EACH ROW EXECUTE FUNCTION examination_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS attempt_events_immutable ON examination_engine.attempt_events;
CREATE TRIGGER attempt_events_immutable BEFORE UPDATE OR DELETE ON examination_engine.attempt_events
FOR EACH ROW EXECUTE FUNCTION examination_engine.forbid_evidence_change();
