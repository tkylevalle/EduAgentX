CREATE TABLE IF NOT EXISTS curriculum_engine.packages (
  package_id text NOT NULL,
  version text NOT NULL,
  domain text NOT NULL,
  payload jsonb NOT NULL,
  digest char(64) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (package_id, version)
);

CREATE TABLE IF NOT EXISTS curriculum_engine.package_lifecycle_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id text NOT NULL,
  version text NOT NULL,
  state text NOT NULL CHECK (state IN ('Candidate', 'Active', 'Quarantined', 'Superseded')),
  actor text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  FOREIGN KEY (package_id, version) REFERENCES curriculum_engine.packages(package_id, version)
);

CREATE OR REPLACE FUNCTION curriculum_engine.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable curriculum evidence'; END $$;

DROP TRIGGER IF EXISTS packages_immutable ON curriculum_engine.packages;
CREATE TRIGGER packages_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.packages
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS lifecycle_immutable ON curriculum_engine.package_lifecycle_events;
CREATE TRIGGER lifecycle_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.package_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();
