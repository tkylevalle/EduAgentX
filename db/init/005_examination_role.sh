#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=examination_password="$EXAMINATION_DB_PASSWORD" --set=database_name="$POSTGRES_DB" <<'SQL'
\set ON_ERROR_STOP on
-- Init containers start together. Concurrent GRANTs on one database fail with
-- "tuple concurrently updated", so each script holds this lock until psql exits.
SELECT pg_advisory_lock(435000) \g /dev/null
SELECT 'CREATE ROLE examination_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='examination_owner') \gexec
ALTER ROLE examination_owner PASSWORD :'examination_password';
GRANT CONNECT ON DATABASE :"database_name" TO examination_owner;
ALTER SCHEMA examination_engine OWNER TO examination_owner;
REVOKE ALL ON SCHEMA examination_engine FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA examination_engine TO examination_owner;
SQL
