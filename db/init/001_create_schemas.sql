-- one shared postgres container, but each service gets its own schema
-- so nobody's migrations step on anyone else's tables. doesn't create
-- any actual tables here - that's on each service.

CREATE SCHEMA IF NOT EXISTS agent_registry;
CREATE SCHEMA IF NOT EXISTS curriculum_engine;
CREATE SCHEMA IF NOT EXISTS training_service;
CREATE SCHEMA IF NOT EXISTS examination_engine;
CREATE SCHEMA IF NOT EXISTS certification_engine;
CREATE SCHEMA IF NOT EXISTS marketplace_service;
CREATE SCHEMA IF NOT EXISTS skill_gap_service;
CREATE SCHEMA IF NOT EXISTS monitoring_service;
