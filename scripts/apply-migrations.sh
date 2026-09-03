#!/usr/bin/env bash
#
# Apply the migrations to a real Supabase project, then prove they took.
#
#   npm run db:apply
#
# Reads SUPABASE_DB_URL from .env.local. Get it from the dashboard:
#   Settings → Database → Connection string → URI
# and use the **Session pooler** string if it is offered — direct connections
# are IPv6-only on newer projects, which most home networks cannot reach.
#
# The password is never echoed, never passed on the command line (where it
# would show up in `ps`), and never written anywhere but your own .env.local.
# Rotate it afterwards from the same dashboard page if you would rather.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. brew install postgresql@16" >&2
  exit 1
fi

# Pull the URL out of .env.local without sourcing the file.
DB_URL="${SUPABASE_DB_URL:-$(grep -E '^SUPABASE_DB_URL=' "$ROOT/.env.local" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'' || true)}"

if [ -z "${DB_URL:-}" ]; then
  cat >&2 <<'MSG'

  SUPABASE_DB_URL is not set.

  Supabase dashboard → Settings → Database → Connection string → URI.
  Prefer the "Session pooler" string. Then add it to .env.local:

      SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

  .env.local is git-ignored.

MSG
  exit 1
fi

case "$DB_URL" in
  *'[YOUR-PASSWORD]'*|*'<password>'*|*'[password]'*)
    echo "SUPABASE_DB_URL still has the placeholder password in it." >&2
    exit 1;;
esac

# Redact anything that looks like a password before printing.
echo "→ target: $(echo "$DB_URL" | sed -E 's#(//[^:]+:)[^@]+(@)#\1********\2#')"

echo "→ checking the connection"
psql "$DB_URL" -Atqc 'select 1' >/dev/null

for file in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ applying $(basename "$file")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "→ verifying"
psql "$DB_URL" -Atq <<'SQL'
select '  tables:   ' || count(*) || '/5'
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('profiles','friendships','blocks','live_presence','live_fixes');

select '  RLS on:   ' || count(*) || '/5'
  from pg_tables
 where schemaname = 'public'
   and tablename in ('profiles','friendships','blocks','live_presence','live_fixes')
   and rowsecurity;

select '  policies: ' || count(*) from pg_policies where schemaname = 'public';

select '  triggers: ' || count(*)
  from information_schema.triggers
 where trigger_schema in ('public','auth');

select '  realtime: ' || count(*) || '/2'
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and tablename in ('live_presence','live_fixes');
SQL

echo "✓ done — run \`npm run doctor\` to confirm from the outside"
