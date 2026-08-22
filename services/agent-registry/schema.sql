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

CREATE INDEX IF NOT EXISTS assurance_events_learner_idx
  ON agent_registry.assurance_events (agent_learner_id, occurred_at DESC, id DESC);
