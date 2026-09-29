#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=registry_password="$REGISTRY_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE registry_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='registry_owner') \gexec
ALTER ROLE registry_owner PASSWORD :'registry_password';
ALTER SCHEMA agent_registry OWNER TO registry_owner;
SELECT format('ALTER TABLE %I.%I OWNER TO registry_owner', schemaname, tablename)
FROM pg_tables WHERE schemaname='agent_registry' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO registry_owner', sequence_schema, sequence_name)
FROM information_schema.sequences WHERE sequence_schema='agent_registry' \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA agent_registry FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA agent_registry TO registry_owner;
SQL
