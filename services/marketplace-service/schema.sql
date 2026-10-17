-- Marketplace (#30). Every table except credential_projection is append-only;
-- the trigger at the end forbids UPDATE and DELETE on them. Run at every start.

-- One row per Capability Request. Its content lives in immutable versions.
CREATE TABLE IF NOT EXISTS marketplace_service.capability_requests (
  id uuid PRIMARY KEY,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  -- Digest of version 1, so a reused key with different content is a 409, not a silent replay.
  request_fingerprint text NOT NULL,
  UNIQUE (created_by, idempotency_key)
);

-- A change is always a new version; an old version is never rewritten.
CREATE TABLE IF NOT EXISTS marketplace_service.capability_request_versions (
  request_id uuid NOT NULL REFERENCES marketplace_service.capability_requests(id),
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  digest text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  UNIQUE (request_id, version),
  UNIQUE (request_id, created_by, idempotency_key)
);

-- Current state is derived: closed wins; otherwise the latest opened version is open.
CREATE TABLE IF NOT EXISTS marketplace_service.capability_request_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES marketplace_service.capability_requests(id),
  event_type text NOT NULL CHECK (event_type IN ('opened', 'closed')),
  version integer,
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event_type = 'opened') = (version IS NOT NULL)),
  FOREIGN KEY (request_id, version) REFERENCES marketplace_service.capability_request_versions(request_id, version)
);
-- A request closes once.
CREATE UNIQUE INDEX IF NOT EXISTS capability_request_closes_once
  ON marketplace_service.capability_request_events (request_id) WHERE event_type = 'closed';

-- Discoverability (decision A): an Agent Learner lists or withdraws itself.
-- Discoverable = the latest event is published.
CREATE TABLE IF NOT EXISTS marketplace_service.listing_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_learner_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('published', 'withdrawn')),
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  -- Only the learner itself may change its own listing.
  CHECK (actor = agent_learner_key),
  UNIQUE (agent_learner_key, idempotency_key)
);

-- Rebuildable read model fed by credential events. Never trusted on its own:
-- status and fingerprint are rechecked against the owners before every result.
CREATE TABLE IF NOT EXISTS marketplace_service.credential_projection (
  credential_id text PRIMARY KEY,
  agent_learner_key text NOT NULL,
  record jsonb NOT NULL,
  last_event_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Each credential event is applied at most once, in the same transaction as the projection change.
CREATE TABLE IF NOT EXISTS marketplace_service.projection_inbox (
  event_id text PRIMARY KEY,
  outcome text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Point-in-time eligibility evidence. Not a ranking: #31 orders results.
CREATE TABLE IF NOT EXISTS marketplace_service.eligibility_checks (
  check_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES marketplace_service.capability_requests(id),
  version integer NOT NULL,
  request_digest text NOT NULL,
  actor text NOT NULL,
  at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  summary jsonb NOT NULL,
  UNIQUE (actor, idempotency_key),
  FOREIGN KEY (request_id, version) REFERENCES marketplace_service.capability_request_versions(request_id, version)
);

CREATE TABLE IF NOT EXISTS marketplace_service.eligibility_check_results (
  check_id uuid NOT NULL REFERENCES marketplace_service.eligibility_checks(check_id),
  agent_learner_key text NOT NULL,
  credential_id text NOT NULL,
  eligible boolean NOT NULL,
  reasons jsonb NOT NULL,
  sources jsonb NOT NULL,
  PRIMARY KEY (check_id, credential_id),
  -- Eligible exactly when no gate failed, so a row can never claim both.
  CHECK (eligible = (jsonb_array_length(reasons) = 0))
);

CREATE OR REPLACE FUNCTION marketplace_service.forbid_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable marketplace evidence'; END $$;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['capability_requests', 'capability_request_versions', 'capability_request_events',
    'listing_events', 'projection_inbox', 'eligibility_checks', 'eligibility_check_results'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON marketplace_service.%I', name || '_immutable', name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON marketplace_service.%I
      FOR EACH ROW EXECUTE FUNCTION marketplace_service.forbid_evidence_change()', name || '_immutable', name);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA marketplace_service FROM PUBLIC;
