#!/usr/bin/env bash
# Run the RLS suite against a throwaway local Postgres.
#
# Supabase provides the auth schema and the anon/authenticated roles; on a bare
# Postgres, supabase/tests/00_supabase_shim.sql stands in for them. Needs
# PostgreSQL 14+ and the pgtap extension available to the server.
#
#   ./scripts/test-rls.sh
#
# Against a real Supabase project, use `supabase test db` instead — it runs the
# same supabase/tests/rls.sql without the shim.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-/tmp/marauders-pg}"
PGPORT="${PGPORT:-54329}"
export PGHOST=/tmp

cleanup() { pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ ! -d "$PGDATA" ]; then
  echo "→ creating a throwaway cluster in $PGDATA"
  initdb -U postgres -A trust "$PGDATA" >/dev/null
fi

pg_ctl -D "$PGDATA" -o "-p $PGPORT -k /tmp -c listen_addresses=''" -l /tmp/marauders-pg.log start >/dev/null
sleep 1

psql -U postgres -p "$PGPORT" -d postgres -q -c "drop database if exists marauders_test;" 
psql -U postgres -p "$PGPORT" -d postgres -q -c "create database marauders_test;"

echo "→ applying the Supabase shim"
psql -U postgres -p "$PGPORT" -d marauders_test -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql"

echo "→ applying migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  psql -U postgres -p "$PGPORT" -d marauders_test -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "→ running supabase/tests/rls.sql"
psql -U postgres -p "$PGPORT" -d marauders_test -X -q -f "$ROOT/supabase/tests/rls.sql" \
  | grep -E '^\s*(ok|not ok|# )' || true

if psql -U postgres -p "$PGPORT" -d marauders_test -X -q -f "$ROOT/supabase/tests/rls.sql" 2>&1 | grep -q 'not ok'; then
  echo "✗ RLS suite failed"
  exit 1
fi
echo "✓ RLS suite passed"
