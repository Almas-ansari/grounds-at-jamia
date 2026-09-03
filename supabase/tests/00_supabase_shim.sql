-- ---------------------------------------------------------------------------
-- Local-only shim.
--
-- Supabase provides all of this natively: the `auth` schema, `auth.users`,
-- `auth.uid()` reading the request's JWT claims, and the anon / authenticated
-- / service_role roles. Running the RLS suite on a bare Postgres (in CI, or on
-- a laptop with no Docker) needs stand-ins, so here they are.
--
-- This file is NEVER applied to a Supabase project. `supabase test db` runs
-- only the numbered test files against the real platform schema.
-- ---------------------------------------------------------------------------

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase reads the verified JWT out of a per-transaction GUC. Tests set the
-- same GUC to impersonate a signed-in user.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to service_role;

-- Realtime's publication exists on every Supabase project; create it locally so
-- the migration's `alter publication` statements apply unchanged.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
