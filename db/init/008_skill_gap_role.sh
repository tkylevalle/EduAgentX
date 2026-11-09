#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=database_name="$POSTGRES_DB" --set=skill_gap_password="$SKILL_GAP_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
-- Init containers start together. Concurrent GRANTs on one database fail with
-- "tuple concurrently updated", so each script holds this lock until psql exits.
SELECT pg_advisory_lock(435000) \g /dev/null
SELECT 'CREATE ROLE skill_gap_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='skill_gap_owner') \gexec
ALTER ROLE skill_gap_owner PASSWORD :'skill_gap_password';
GRANT CONNECT ON DATABASE :"database_name" TO skill_gap_owner;
ALTER SCHEMA skill_gap_service OWNER TO skill_gap_owner;
REVOKE ALL ON SCHEMA skill_gap_service FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA skill_gap_service TO skill_gap_owner;
SQL
