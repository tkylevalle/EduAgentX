CREATE TABLE IF NOT EXISTS agent_registry.agent_learners (
  id UUID PRIMARY KEY,
  agent_learner_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  configuration_version INTEGER NOT NULL DEFAULT 0 CHECK (configuration_version >= 0),
  current_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_registry.agent_configurations (
  id UUID PRIMARY KEY,
  agent_learner_id UUID NOT NULL REFERENCES agent_registry.agent_learners(id),
  configuration_version INTEGER NOT NULL CHECK (configuration_version > 0),
  fingerprint TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  system_prompt_hash TEXT NOT NULL,
  approved_tool_manifest JSONB NOT NULL,
  policy_configuration_hash TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_learner_id, configuration_version)
);

-- Older local checkouts briefly created a uniqueness constraint for
-- (agent_learner_id, fingerprint). A learner may legitimately return to a
-- prior configuration after an intervening material change, so remove that
-- obsolete constraint when upgrading an existing local volume.
ALTER TABLE agent_registry.agent_configurations
  DROP CONSTRAINT IF EXISTS agent_configurations_agent_learner_id_fingerprint_key;

CREATE TABLE IF NOT EXISTS agent_registry.assurance_events (
  id UUID PRIMARY KEY,
  agent_learner_id UUID NOT NULL REFERENCES agent_registry.agent_learners(id),
  configuration_id UUID REFERENCES agent_registry.agent_configurations(id),
  event_type TEXT NOT NULL,
  configuration_version INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  previous_fingerprint TEXT,
  correlation_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_configurations_learner_version_idx
  ON agent_registry.agent_configurations (agent_learner_id, configuration_version DESC);

CREATE INDEX IF NOT EXISTS agent_configurations_learner_fingerprint_idx
  ON agent_registry.agent_configurations (agent_learner_id, fingerprint);

CREATE INDEX IF NOT EXISTS assurance_events_latest_idx
  ON agent_registry.assurance_events (occurred_at DESC, id DESC);
ALTER TABLE agent_registry.assurance_events ALTER COLUMN occurred_at SET DEFAULT clock_timestamp();

CREATE INDEX IF NOT EXISTS assurance_events_learner_idx
  ON agent_registry.assurance_events (agent_learner_id, occurred_at DESC, id DESC);

-- Event delivery is at least once. The durable inbox makes its effect exactly once.
CREATE TABLE IF NOT EXISTS agent_registry.event_outbox (
  event_id UUID PRIMARY KEY REFERENCES agent_registry.assurance_events(id),
  aggregate_id UUID NOT NULL REFERENCES agent_registry.agent_learners(id),
  sequence INTEGER NOT NULL,
  envelope JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (aggregate_id, sequence)
);
CREATE TABLE IF NOT EXISTS agent_registry.registration_requests (
  subject TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  PRIMARY KEY (subject, request_key)
);
CREATE TABLE IF NOT EXISTS agent_registry.event_inbox (
  stream_id TEXT PRIMARY KEY,
  event_id UUID UNIQUE,
  aggregate_id UUID,
  sequence INTEGER,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'applied', 'quarantined')),
  reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_registry.event_projection (
  aggregate_id UUID PRIMARY KEY REFERENCES agent_registry.agent_learners(id),
  sequence INTEGER NOT NULL DEFAULT 0,
  event_id UUID
);
ALTER TABLE agent_registry.event_outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS agent_registry.event_attempts (
  stream_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent_registry.delivery_incidents (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'integration',
  severity TEXT NOT NULL,
  affected_id TEXT NOT NULL,
  cause TEXT NOT NULL,
  safe_state TEXT NOT NULL,
  recovery_condition TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_incidents_exhaustion_idx
  ON agent_registry.delivery_incidents (affected_id) WHERE cause='automatic_attempts_exhausted';
