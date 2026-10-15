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

-- Additive Issue #17 migration: existing manifests and seq=1 events remain valid.
ALTER TABLE examination_engine.attempt_events DROP CONSTRAINT IF EXISTS attempt_events_event_type_check;
ALTER TABLE examination_engine.attempt_events ADD CONSTRAINT attempt_events_event_type_check
  CHECK (event_type IN ('attempt_started','response_accepted','grade_recorded','attempt_completed','agent_failed','system_aborted'));
ALTER TABLE examination_engine.attempt_events ADD COLUMN IF NOT EXISTS event_id text;
ALTER TABLE examination_engine.attempt_events ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS attempt_event_identity ON examination_engine.attempt_events(event_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attempt_one_terminal ON examination_engine.attempt_events(attempt_id)
  WHERE event_type IN ('attempt_completed','agent_failed','system_aborted');
CREATE UNIQUE INDEX IF NOT EXISTS attempt_one_start ON examination_engine.attempt_events(attempt_id) WHERE event_type = 'attempt_started';

-- Restricted evidence: only the Engine's database role and protected grading seam read answers.
CREATE TABLE IF NOT EXISTS examination_engine.attempt_responses (
  attempt_id uuid NOT NULL REFERENCES examination_engine.attempts(attempt_id),
  item_id text NOT NULL,
  response text NOT NULL CHECK (length(response) BETWEEN 1 AND 16000),
  response_digest text NOT NULL,
  accepted_at timestamptz NOT NULL,
  seq integer NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY (attempt_id, item_id),
  FOREIGN KEY (attempt_id, seq) REFERENCES examination_engine.attempt_events(attempt_id, seq)
);
CREATE TABLE IF NOT EXISTS examination_engine.attempt_commands (
  attempt_id uuid NOT NULL REFERENCES examination_engine.attempts(attempt_id),
  idempotency_key text NOT NULL,
  command_digest text NOT NULL,
  event_id text UNIQUE,
  receipt jsonb NOT NULL,
  PRIMARY KEY (attempt_id, idempotency_key)
);
REVOKE ALL ON examination_engine.attempt_responses, examination_engine.attempt_commands FROM PUBLIC;
DROP TRIGGER IF EXISTS attempt_responses_immutable ON examination_engine.attempt_responses;
CREATE TRIGGER attempt_responses_immutable BEFORE UPDATE OR DELETE ON examination_engine.attempt_responses
FOR EACH ROW EXECUTE FUNCTION examination_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS attempt_commands_immutable ON examination_engine.attempt_commands;
CREATE TRIGGER attempt_commands_immutable BEFORE UPDATE OR DELETE ON examination_engine.attempt_commands
FOR EACH ROW EXECUTE FUNCTION examination_engine.forbid_evidence_change();

-- Additive Issue #20 migration: a Deterministic Fallback Examination is a new
-- labelled attempt. Existing standard manifests keep every fallback column null.
ALTER TABLE examination_engine.attempts DROP CONSTRAINT IF EXISTS attempts_mode_check;
ALTER TABLE examination_engine.attempts ADD CONSTRAINT attempts_mode_check CHECK (mode IN ('standard','fallback'));
ALTER TABLE examination_engine.attempts ADD COLUMN IF NOT EXISTS fallback_cause_attempt_id uuid
  REFERENCES examination_engine.attempts(attempt_id);
ALTER TABLE examination_engine.attempts ADD COLUMN IF NOT EXISTS fallback_reason text;
ALTER TABLE examination_engine.attempts ADD COLUMN IF NOT EXISTS fallback_bank_id text;
ALTER TABLE examination_engine.attempts ADD COLUMN IF NOT EXISTS fallback_bank_version text;
ALTER TABLE examination_engine.attempts ADD COLUMN IF NOT EXISTS fallback_bank_digest text;
ALTER TABLE examination_engine.attempts DROP CONSTRAINT IF EXISTS attempts_fallback_fields_check;
ALTER TABLE examination_engine.attempts ADD CONSTRAINT attempts_fallback_fields_check CHECK (
  (mode = 'fallback' AND fallback_reason IS NOT NULL AND fallback_bank_id IS NOT NULL
    AND fallback_bank_version IS NOT NULL AND fallback_bank_digest IS NOT NULL)
  OR (mode = 'standard' AND fallback_cause_attempt_id IS NULL AND fallback_reason IS NULL
    AND fallback_bank_id IS NULL AND fallback_bank_version IS NULL AND fallback_bank_digest IS NULL));
-- One aborted attempt can cause at most one fallback attempt.
CREATE UNIQUE INDEX IF NOT EXISTS attempt_fallback_one_per_cause ON examination_engine.attempts(fallback_cause_attempt_id)
  WHERE fallback_cause_attempt_id IS NOT NULL;

-- Additive Issue #21 migration: the remediation outbox. One event per valid
-- Agent-Failed attempt, written in the attempt's terminal transaction, and at
-- most one final delivery outcome per event. Both are immutable evidence.
CREATE TABLE IF NOT EXISTS examination_engine.remediation_events (
  event_id text PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES examination_engine.attempts(attempt_id),
  agent_learner_key text NOT NULL,
  package_id text NOT NULL,
  package_version text NOT NULL,
  package_digest text NOT NULL,
  occurred_at timestamptz NOT NULL,
  envelope jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS remediation_events_by_learner_package ON examination_engine.remediation_events
  (agent_learner_key, package_id, package_version, occurred_at DESC);
CREATE TABLE IF NOT EXISTS examination_engine.remediation_deliveries (
  event_id text PRIMARY KEY REFERENCES examination_engine.remediation_events(event_id),
  outcome text NOT NULL CHECK (outcome IN ('delivered','refused')),
  training_session_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL,
  CHECK ((outcome = 'delivered') = (training_session_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS attempts_by_remediation_request ON examination_engine.attempts
  ((form->'training'->>'remediationRequestId')) WHERE form->'training'->>'remediationRequestId' IS NOT NULL;
DROP TRIGGER IF EXISTS remediation_events_immutable ON examination_engine.remediation_events;
CREATE TRIGGER remediation_events_immutable BEFORE UPDATE OR DELETE ON examination_engine.remediation_events
FOR EACH ROW EXECUTE FUNCTION examination_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS remediation_deliveries_immutable ON examination_engine.remediation_deliveries;
CREATE TRIGGER remediation_deliveries_immutable BEFORE UPDATE OR DELETE ON examination_engine.remediation_deliveries
FOR EACH ROW EXECUTE FUNCTION examination_engine.forbid_evidence_change();
