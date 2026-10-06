#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=training_password="$TRAINING_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE training_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='training_owner') \gexec
ALTER ROLE training_owner PASSWORD :'training_password';
ALTER SCHEMA training_service OWNER TO training_owner;
REVOKE ALL ON SCHEMA training_service FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA training_service TO training_owner;
SQL
