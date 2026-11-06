#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=database_name="$POSTGRES_DB"  --set=marketplace_password="$MARKETPLACE_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
-- Init containers start together. Concurrent GRANTs on one database fail with
-- "tuple concurrently updated", so each script holds this lock until psql exits.
SELECT pg_advisory_lock(435000) \g /dev/null
SELECT 'CREATE ROLE marketplace_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='marketplace_owner') \gexec
ALTER ROLE marketplace_owner PASSWORD :'marketplace_password';
GRANT CONNECT ON DATABASE :"database_name" TO marketplace_owner;
ALTER SCHEMA marketplace_service OWNER TO marketplace_owner;
REVOKE ALL ON SCHEMA marketplace_service FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA marketplace_service TO marketplace_owner;
SQL
