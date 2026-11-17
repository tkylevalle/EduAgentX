#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=database_name="$POSTGRES_DB" --set=monitoring_password="$MONITORING_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
-- Init containers start together. Concurrent GRANTs on one database fail with
-- "tuple concurrently updated", so each script holds this lock until psql exits.
SELECT pg_advisory_lock(435000) \g /dev/null
SELECT 'CREATE ROLE monitoring_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='monitoring_owner') \gexec
ALTER ROLE monitoring_owner PASSWORD :'monitoring_password';
GRANT CONNECT ON DATABASE :"database_name" TO monitoring_owner;
CREATE SCHEMA IF NOT EXISTS monitoring_service;
ALTER SCHEMA monitoring_service OWNER TO monitoring_owner;
REVOKE ALL ON SCHEMA monitoring_service FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA monitoring_service TO monitoring_owner;
SQL
