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

-- Issue 13: practice, remediation and progress. Every statement can run again
-- on each start, and rows written before this change keep their meaning.

-- A remediation session stores the structured request, including the evidence
-- that caused it. The completion policy and delivery plan (identities only,
-- no lesson text) are pinned when the session is created.
ALTER TABLE training_service.sessions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS remediation jsonb,
  ADD COLUMN IF NOT EXISTS completion_policy jsonb NOT NULL
    DEFAULT '{"version":"training-completion/0","minPracticeItemsPerModule":0,"maxResponseChars":4000}',
  ADD COLUMN IF NOT EXISTS delivery_plan jsonb;
ALTER TABLE training_service.sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE training_service.sessions ADD CONSTRAINT sessions_kind_check
  CHECK (kind IN ('standard', 'remediation') AND ((kind = 'remediation') = (remediation IS NOT NULL)));

-- One session per remediation request, so a retried request cannot assign twice.
CREATE UNIQUE INDEX IF NOT EXISTS remediation_request_once
  ON training_service.sessions (agent_learner_key, (remediation->>'requestId')) WHERE kind = 'remediation';

ALTER TABLE training_service.session_events
  ADD COLUMN IF NOT EXISTS item_kind text CHECK (item_kind IN ('lesson', 'practice'));
ALTER TABLE training_service.session_events DROP CONSTRAINT IF EXISTS session_events_event_type_check;
ALTER TABLE training_service.session_events ADD CONSTRAINT session_events_event_type_check
  CHECK (event_type IN ('session_started', 'item_delivered', 'item_completed', 'session_completed', 'session_blocked',
    'session_resumed', 'remediation_assigned'));

-- A session ends once: one completion or one block, never both or two.
-- Issue 12 could block a completed session, and the events are immutable, so
-- a database holding such a session keeps starting: the index is skipped with
-- a warning instead of failing the whole schema.
DO $$
BEGIN
  IF to_regclass('training_service.one_terminal_event') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM training_service.session_events
      WHERE event_type IN ('session_completed', 'session_blocked')
      GROUP BY session_id HAVING count(*) > 1
    ) THEN
      RAISE WARNING 'one_terminal_event not created: a session already has more than one terminal event';
    ELSE
      CREATE UNIQUE INDEX one_terminal_event
        ON training_service.session_events (session_id) WHERE event_type IN ('session_completed', 'session_blocked');
    END IF;
  END IF;
END $$;

-- Outbox of training.session.completed events, written in the same
-- transaction as session_completed. The id is derived from the session, so
-- the event is emitted once whatever the retries.
CREATE TABLE IF NOT EXISTS training_service.completion_events (
  event_id text PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE REFERENCES training_service.sessions(session_id),
  envelope jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS completion_events_immutable ON training_service.completion_events;
CREATE TRIGGER completion_events_immutable BEFORE UPDATE OR DELETE ON training_service.completion_events
FOR EACH ROW EXECUTE FUNCTION training_service.forbid_evidence_change();

-- One row per completion event the relay has published to the Redis Stream.
-- An event with no row here is still pending and is sent on the next run.
CREATE TABLE IF NOT EXISTS training_service.completion_publications (
  event_id text PRIMARY KEY REFERENCES training_service.completion_events(event_id),
  stream_id text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS completion_publications_immutable ON training_service.completion_publications;
CREATE TRIGGER completion_publications_immutable BEFORE UPDATE OR DELETE ON training_service.completion_publications
FOR EACH ROW EXECUTE FUNCTION training_service.forbid_evidence_change();
