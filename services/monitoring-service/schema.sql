-- The Assurance Incident log (target design 7.3; assurance audit E9). Both
-- tables are append-only: an incident is never edited, and its handling is a
-- separate, also immutable, record.

CREATE TABLE IF NOT EXISTS monitoring_service.incidents (
  incident_id uuid PRIMARY KEY,
  source text NOT NULL,
  source_id text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium')),
  kind text NOT NULL,
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
  subject jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS incidents_recorded_at ON monitoring_service.incidents (recorded_at DESC);
-- The spec's Attention Record fields: the state the system put itself in, what a person must do, and who.
ALTER TABLE monitoring_service.incidents ADD COLUMN IF NOT EXISTS safe_state text CHECK (length(safe_state) BETWEEN 1 AND 200);
ALTER TABLE monitoring_service.incidents ADD COLUMN IF NOT EXISTS required_action text CHECK (length(required_action) BETWEEN 1 AND 500);
ALTER TABLE monitoring_service.incidents ADD COLUMN IF NOT EXISTS owner text;

CREATE TABLE IF NOT EXISTS monitoring_service.incident_updates (
  update_id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES monitoring_service.incidents(incident_id),
  status text NOT NULL CHECK (status IN ('acknowledged', 'resolved')),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  actor text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Every read, update and list of an incident joins its updates by incident, in order.
CREATE INDEX IF NOT EXISTS incident_updates_incident ON monitoring_service.incident_updates (incident_id, update_id);
-- The Attention Queue pages by (recorded_at, incident_id), newest first.
CREATE INDEX IF NOT EXISTS incidents_recorded_at_id ON monitoring_service.incidents (recorded_at DESC, incident_id DESC);

CREATE OR REPLACE FUNCTION monitoring_service.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable assurance incident record'; END $$;
DROP TRIGGER IF EXISTS incidents_immutable ON monitoring_service.incidents;
CREATE TRIGGER incidents_immutable BEFORE UPDATE OR DELETE ON monitoring_service.incidents
FOR EACH ROW EXECUTE FUNCTION monitoring_service.forbid_change();
DROP TRIGGER IF EXISTS incident_updates_immutable ON monitoring_service.incident_updates;
CREATE TRIGGER incident_updates_immutable BEFORE UPDATE OR DELETE ON monitoring_service.incident_updates
FOR EACH ROW EXECUTE FUNCTION monitoring_service.forbid_change();
-- TRUNCATE removes rows without firing row triggers, so it is refused separately.
DROP TRIGGER IF EXISTS incidents_no_truncate ON monitoring_service.incidents;
CREATE TRIGGER incidents_no_truncate BEFORE TRUNCATE ON monitoring_service.incidents
FOR EACH STATEMENT EXECUTE FUNCTION monitoring_service.forbid_change();
DROP TRIGGER IF EXISTS incident_updates_no_truncate ON monitoring_service.incident_updates;
CREATE TRIGGER incident_updates_no_truncate BEFORE TRUNCATE ON monitoring_service.incident_updates
FOR EACH STATEMENT EXECUTE FUNCTION monitoring_service.forbid_change();

-- Runtime Monitor manifests: what one certified deployment may do. A new
-- manifest for a credential supersedes the older one; none is ever edited.
CREATE TABLE IF NOT EXISTS monitoring_service.runtime_manifests (
  manifest_id bigserial PRIMARY KEY,
  credential_id text NOT NULL,
  agent_id text NOT NULL,
  manifest jsonb NOT NULL,
  registered_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_manifests_credential ON monitoring_service.runtime_manifests (credential_id, manifest_id DESC);
DROP TRIGGER IF EXISTS runtime_manifests_immutable ON monitoring_service.runtime_manifests;
CREATE TRIGGER runtime_manifests_immutable BEFORE UPDATE OR DELETE ON monitoring_service.runtime_manifests
FOR EACH ROW EXECUTE FUNCTION monitoring_service.forbid_change();

-- When each monitored credential last reported a tool call: operational state,
-- not evidence, so it is updated in place. A deployment that stops reporting
-- is found by comparing this with the silence window.
CREATE TABLE IF NOT EXISTS monitoring_service.runtime_reports (
  credential_id text PRIMARY KEY,
  last_report_at timestamptz NOT NULL
);
