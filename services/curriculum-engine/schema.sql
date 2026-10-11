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
  state text NOT NULL CHECK (state IN ('Candidate', 'Invalid', 'AwaitingReview', 'Active', 'Quarantined', 'Superseded')),
  actor text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  FOREIGN KEY (package_id, version) REFERENCES curriculum_engine.packages(package_id, version)
);

ALTER TABLE curriculum_engine.package_lifecycle_events
  DROP CONSTRAINT IF EXISTS package_lifecycle_events_state_check;
ALTER TABLE curriculum_engine.package_lifecycle_events
  ADD CONSTRAINT package_lifecycle_events_state_check
  CHECK (state IN ('Candidate', 'Invalid', 'AwaitingReview', 'Active', 'Quarantined', 'Superseded'));

CREATE OR REPLACE FUNCTION curriculum_engine.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable curriculum evidence'; END $$;

DROP TRIGGER IF EXISTS packages_immutable ON curriculum_engine.packages;
CREATE TRIGGER packages_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.packages
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS lifecycle_immutable ON curriculum_engine.package_lifecycle_events;
CREATE TRIGGER lifecycle_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.package_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();

-- Freshness and scope-quarantine evidence is append-only and belongs to the
-- exact immutable package version whose source or content was reviewed.
CREATE TABLE IF NOT EXISTS curriculum_engine.freshness_checks (
  check_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id text NOT NULL,
  version text NOT NULL,
  source_id text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('No Change', 'Watch', 'Patch', 'Substantive', 'Critical')),
  evidence jsonb NOT NULL,
  actor text NOT NULL,
  checked_at timestamptz NOT NULL,
  FOREIGN KEY (package_id, version) REFERENCES curriculum_engine.packages(package_id, version)
);

CREATE TABLE IF NOT EXISTS curriculum_engine.package_scope_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id text NOT NULL,
  version text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('source', 'module', 'objective', 'delivery_item')),
  scope_id text NOT NULL,
  event text NOT NULL CHECK (event IN ('quarantined', 'restored')),
  evidence jsonb NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (package_id, version) REFERENCES curriculum_engine.packages(package_id, version)
);

CREATE TABLE IF NOT EXISTS curriculum_engine.package_evidence (
  evidence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id text NOT NULL,
  version text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (package_id, version) REFERENCES curriculum_engine.packages(package_id, version)
);

DROP TRIGGER IF EXISTS freshness_checks_immutable ON curriculum_engine.freshness_checks;
CREATE TRIGGER freshness_checks_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.freshness_checks
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS scope_events_immutable ON curriculum_engine.package_scope_events;
CREATE TRIGGER scope_events_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.package_scope_events
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();
DROP TRIGGER IF EXISTS package_evidence_immutable ON curriculum_engine.package_evidence;
CREATE TRIGGER package_evidence_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.package_evidence
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_evidence_change();
