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

CREATE TABLE IF NOT EXISTS monitoring_service.incident_updates (
  update_id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES monitoring_service.incidents(incident_id),
  status text NOT NULL CHECK (status IN ('acknowledged', 'resolved')),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  actor text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION monitoring_service.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable assurance incident record'; END $$;
DROP TRIGGER IF EXISTS incidents_immutable ON monitoring_service.incidents;
CREATE TRIGGER incidents_immutable BEFORE UPDATE OR DELETE ON monitoring_service.incidents
FOR EACH ROW EXECUTE FUNCTION monitoring_service.forbid_change();
DROP TRIGGER IF EXISTS incident_updates_immutable ON monitoring_service.incident_updates;
CREATE TRIGGER incident_updates_immutable BEFORE UPDATE OR DELETE ON monitoring_service.incident_updates
FOR EACH ROW EXECUTE FUNCTION monitoring_service.forbid_change();

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
