#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=certification_password="$CERTIFICATION_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE certification_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='certification_owner') \gexec
ALTER ROLE certification_owner PASSWORD :'certification_password';
ALTER SCHEMA certification_engine OWNER TO certification_owner;
REVOKE ALL ON SCHEMA certification_engine FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA certification_engine TO certification_owner;
SQL
