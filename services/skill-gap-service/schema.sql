CREATE TABLE IF NOT EXISTS skill_gap_service.recommendations (
  id uuid PRIMARY KEY,
  document jsonb NOT NULL CHECK (document->>'recommendationId' = id::text)
);
CREATE TABLE IF NOT EXISTS skill_gap_service.commands (
  actor text NOT NULL,
  command_key text NOT NULL,
  digest text NOT NULL,
  recommendation_id uuid NOT NULL REFERENCES skill_gap_service.recommendations(id),
  PRIMARY KEY (actor, command_key)
);
CREATE TABLE IF NOT EXISTS skill_gap_service.deliveries (
  recommendation_id uuid PRIMARY KEY REFERENCES skill_gap_service.recommendations(id),
  document jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_gap_service.handoff_attempts (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recommendation_id uuid NOT NULL REFERENCES skill_gap_service.recommendations(id),
  document jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION skill_gap_service.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable skill gap evidence'; END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['recommendations','commands','deliveries','handoff_attempts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON skill_gap_service.%I', name || '_immutable', name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON skill_gap_service.%I
      FOR EACH ROW EXECUTE FUNCTION skill_gap_service.forbid_evidence_change()', name || '_immutable', name);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA skill_gap_service FROM PUBLIC;
