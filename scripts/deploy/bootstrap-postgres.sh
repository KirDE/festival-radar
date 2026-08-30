#!/usr/bin/env bash
set -euo pipefail

database="${FESTIVAL_DB_NAME:-festival_radar}"
role="${FESTIVAL_DB_USER:-festival_radar}"
password="${FESTIVAL_DB_PASSWORD:?FESTIVAL_DB_PASSWORD is required}"

[[ "$database" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid database name" >&2; exit 2; }
[[ "$role" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid database role" >&2; exit 2; }
(( ${#password} >= 24 )) || { echo "database password must contain at least 24 characters" >&2; exit 2; }

sudo -u postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=role_name="$role" --set=role_password="$password" \
  --set=database_name="$database" postgres <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role_name') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'role_name')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database_name') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SQL

echo "PostgreSQL database and least-privilege application role are ready."
