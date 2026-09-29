#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=curriculum_password="$CURRICULUM_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE curriculum_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='curriculum_owner') \gexec
ALTER ROLE curriculum_owner PASSWORD :'curriculum_password';
ALTER SCHEMA curriculum_engine OWNER TO curriculum_owner;
REVOKE ALL ON SCHEMA curriculum_engine FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA curriculum_engine TO curriculum_owner;
SQL
