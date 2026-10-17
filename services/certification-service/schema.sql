CREATE TABLE IF NOT EXISTS certification_engine.decisions (
  decision_id uuid PRIMARY KEY,
  examination_id uuid NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  command_digest text NOT NULL,
  subject_id text NOT NULL,
  subject_fingerprint text NOT NULL,
  package_id text NOT NULL,
  package_version text NOT NULL,
  package_digest text NOT NULL,
  template_id text NOT NULL,
  template_version text NOT NULL,
  template_digest text NOT NULL,
  rubric_id text NOT NULL,
  rubric_version text NOT NULL,
  rubric_digest text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('standard', 'fallback')),
  scores jsonb NOT NULL,
  safety_result jsonb NOT NULL,
  examination_evidence jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE certification_engine.decisions ADD COLUMN IF NOT EXISTS template_digest text NOT NULL DEFAULT 'legacy-unavailable';

CREATE TABLE IF NOT EXISTS certification_engine.credentials (
  credential_id uuid PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES certification_engine.decisions(decision_id),
  credential jsonb NOT NULL,
  compact_jws text NOT NULL,
  key_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  issuance_latency_ms integer NOT NULL CHECK (issuance_latency_ms >= 0),
  processing_latency_ms integer NOT NULL CHECK (processing_latency_ms >= 0)
);
ALTER TABLE certification_engine.credentials ADD COLUMN IF NOT EXISTS issuance_latency_ms integer NOT NULL DEFAULT 0;
ALTER TABLE certification_engine.credentials ADD COLUMN IF NOT EXISTS processing_latency_ms integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION certification_engine.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable certification evidence'; END $$;
DROP TRIGGER IF EXISTS decisions_immutable ON certification_engine.decisions;
CREATE TRIGGER decisions_immutable BEFORE UPDATE OR DELETE ON certification_engine.decisions
FOR EACH ROW EXECUTE FUNCTION certification_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS credentials_immutable ON certification_engine.credentials;
CREATE TRIGGER credentials_immutable BEFORE UPDATE OR DELETE ON certification_engine.credentials
FOR EACH ROW EXECUTE FUNCTION certification_engine.forbid_evidence_change();

REVOKE ALL ON certification_engine.decisions, certification_engine.credentials FROM PUBLIC;

CREATE TABLE IF NOT EXISTS certification_engine.issuance_cursor (
  cursor_id integer PRIMARY KEY CHECK (cursor_id = 1),
  completed_at timestamptz NOT NULL,
  examination_id uuid NOT NULL
);
