#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=database_name="$POSTGRES_DB"  --set=certification_password="$CERTIFICATION_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
-- Init containers start together. Concurrent GRANTs on one database fail with
-- "tuple concurrently updated", so each script holds this lock until psql exits.
SELECT pg_advisory_lock(435000) \g /dev/null
SELECT 'CREATE ROLE certification_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='certification_owner') \gexec
ALTER ROLE certification_owner PASSWORD :'certification_password';
GRANT CONNECT ON DATABASE :"database_name" TO certification_owner;
ALTER SCHEMA certification_engine OWNER TO certification_owner;
REVOKE ALL ON SCHEMA certification_engine FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA certification_engine TO certification_owner;
SQL
