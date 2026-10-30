#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=database_name="$POSTGRES_DB" --set=skill_gap_password="$SKILL_GAP_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE skill_gap_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='skill_gap_owner') \gexec
ALTER ROLE skill_gap_owner PASSWORD :'skill_gap_password';
GRANT CONNECT ON DATABASE :"database_name" TO skill_gap_owner;
ALTER SCHEMA skill_gap_service OWNER TO skill_gap_owner;
REVOKE ALL ON SCHEMA skill_gap_service FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA skill_gap_service TO skill_gap_owner;
SQL
