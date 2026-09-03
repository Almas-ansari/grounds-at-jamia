-- ============================================================================
-- Marauders' Map — Jamia Millia Islamia
--
-- Every visibility rule in this application lives in this file. The client is
-- never trusted to filter anything: Supabase Realtime evaluates these same RLS
-- policies for `postgres_changes` on an authenticated connection, so a browser
-- that subscribes to `live_fixes` is only ever *sent* the rows its policies
-- admit. A row a user may not select is a row that never reaches their socket.
--
-- Three invariants this schema enforces, none of them optional:
--   1. Ghost is the default. A new account is on no one's map.
--   2. There is no location history. One row per user, upserted in place,
--      with a server-set TTL. No trail table exists to be subpoenaed.
--   3. Public visibility discloses a building, never a coordinate.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 32),
  handle text unique not null check (handle ~ '^[a-z0-9_]{3,20}$'),
  faculty text check (faculty is null or char_length(faculty) <= 64),
  sound_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Handles are how you find a friend, so profiles are readable campus-wide.
-- They carry no location: knowing a handle exists tells you nothing about
-- where anybody is.
create policy profiles_select_authenticated on public.profiles
  for select to authenticated
  using (true);

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy profiles_delete_self on public.profiles
  for delete to authenticated
  using (id = (select auth.uid()));

create index profiles_handle_idx on public.profiles (handle);

-- ---------------------------------------------------------------------------
-- friendships — one row per pair, canonically ordered
-- ---------------------------------------------------------------------------
create type public.friend_status as enum ('pending', 'accepted');

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friend_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  -- One row per pair. Without this, A→B and B→A are two different friendships
  -- and every policy below has to reason about both.
  constraint friendships_canonical_order check (requester_id < addressee_id),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

-- Both directions are indexed: is_accepted_friend() probes the pair in
-- canonical order, and the friends drawer lists rows from either side.
create index friendships_requester_idx on public.friendships (requester_id, status);
create index friendships_addressee_idx on public.friendships (addressee_id, status);

-- ---------------------------------------------------------------------------
-- blocks — absolute, and they outrank everything else
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create index blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

-- ---------------------------------------------------------------------------
-- live location — two tables, two very different disclosure levels
-- ---------------------------------------------------------------------------
create type public.visibility_mode as enum ('ghost', 'friends', 'public');

-- Coarse: which building. Readable by any signed-in user, if you opted in.
create table public.live_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  zone_id text check (zone_id is null or char_length(zone_id) <= 48),
  visibility public.visibility_mode not null default 'ghost',
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 seconds'
);

-- Precise: latitude and longitude. Friends only, ever.
create table public.live_fixes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real,
  bearing real,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 seconds'
);

alter table public.live_presence enable row level security;
alter table public.live_fixes enable row level security;

create index live_presence_expires_idx on public.live_presence (expires_at);
create index live_fixes_expires_idx on public.live_fixes (expires_at);

-- ---------------------------------------------------------------------------
-- Predicate helpers
--
-- `security definer` so the policy can read friendships and blocks without
-- the *reader* needing select rights on the other party's rows, and `stable`
-- so the planner may call them once per statement rather than once per row.
-- search_path is pinned: a security definer function with a mutable
-- search_path is a privilege escalation waiting to happen.
-- ---------------------------------------------------------------------------
create or replace function public.is_accepted_friend(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and f.requester_id = least(a, b)
      and f.addressee_id = greatest(a, b)
  );
$$;

create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

revoke all on function public.is_accepted_friend(uuid, uuid) from public;
revoke all on function public.is_blocked_either_way(uuid, uuid) from public;
grant execute on function public.is_accepted_friend(uuid, uuid) to authenticated;
grant execute on function public.is_blocked_either_way(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- friendships policies
-- ---------------------------------------------------------------------------
create policy friendships_select_participant on public.friendships
  for select to authenticated
  using (
    (select auth.uid()) in (requester_id, addressee_id)
    and not public.is_blocked_either_way(requester_id, addressee_id)
  );

-- You may only ever ask on your own behalf, and never of someone who has
-- blocked you (or whom you have blocked).
create policy friendships_insert_as_requester on public.friendships
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and not public.is_blocked_either_way(requester_id, addressee_id)
  );

-- Only the addressee accepts, and acceptance is the only permitted transition.
create policy friendships_update_accept_as_addressee on public.friendships
  for update to authenticated
  using (addressee_id = (select auth.uid()) and status = 'pending')
  with check (addressee_id = (select auth.uid()) and status = 'accepted');

-- Either party can withdraw or unfriend.
create policy friendships_delete_participant on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- ---------------------------------------------------------------------------
-- blocks policies — you manage your own blocks and nobody else's.
-- A blocked user cannot see that they were blocked; they simply stop seeing
-- the blocker anywhere.
-- ---------------------------------------------------------------------------
create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));

create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- live_presence policies
--
-- SELECT: yourself always; anyone else only while they are non-ghost, unexpired
-- and unblocked in either direction.
-- ---------------------------------------------------------------------------
create policy live_presence_select on public.live_presence
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      visibility <> 'ghost'
      and expires_at > now()
      and not public.is_blocked_either_way(user_id, (select auth.uid()))
    )
  );

create policy live_presence_insert_self on public.live_presence
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy live_presence_update_self on public.live_presence
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy live_presence_delete_self on public.live_presence
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- live_fixes policies
--
-- SELECT: yourself always; anyone else only while unexpired, an *accepted*
-- friend, and unblocked in either direction. Note what is absent: `visibility`
-- plays no part here. Public mode grants nothing on this table, because the
-- publisher never writes a row to it in public mode and this policy would not
-- disclose it if it did.
-- ---------------------------------------------------------------------------
create policy live_fixes_select on public.live_fixes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      expires_at > now()
      and public.is_accepted_friend(user_id, (select auth.uid()))
      and not public.is_blocked_either_way(user_id, (select auth.uid()))
    )
  );

create policy live_fixes_insert_self on public.live_fixes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy live_fixes_update_self on public.live_fixes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy live_fixes_delete_self on public.live_fixes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- Triggers
-- ===========================================================================

-- 1. TTL is set by the server. Whatever the client sent for updated_at or
--    expires_at is discarded — a client cannot pin itself to the map.
create or replace function public.enforce_ttl()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.expires_at := now() + interval '90 seconds';
  return new;
end;
$$;

create trigger live_presence_ttl
  before insert or update on public.live_presence
  for each row execute function public.enforce_ttl();

create trigger live_fixes_ttl
  before insert or update on public.live_fixes
  for each row execute function public.enforce_ttl();

-- 2. Ghost means gone. Setting ghost null out the zone and destroys the
--    precise fix in the same statement, so there is no window in which a
--    ghost still has coordinates on the server.
create or replace function public.enforce_ghost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.visibility = 'ghost' then
    new.zone_id := null;
    delete from public.live_fixes where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger live_presence_ghost
  before insert or update on public.live_presence
  for each row execute function public.enforce_ghost();

-- 3. Rate limit. One precise fix every 3 seconds is plenty for a person on
--    foot, and it caps how finely anyone can be tracked even by a friend.
create or replace function public.rate_limit_fixes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous timestamptz;
begin
  select updated_at into previous from public.live_fixes where user_id = new.user_id;
  if previous is not null and previous > now() - interval '3 seconds' then
    raise exception 'Location updates are limited to one every 3 seconds (last was %s ago).',
      round(extract(epoch from (now() - previous))::numeric, 1)
      using errcode = '53400';
  end if;
  return new;
end;
$$;

-- BEFORE the TTL trigger would be equivalent, but ordering triggers by name is
-- fragile; this one is deliberately named to sort first.
create trigger a_live_fixes_rate_limit
  before insert or update on public.live_fixes
  for each row execute function public.rate_limit_fixes();

-- 4. A block dissolves the friendship. Not "hides" — deletes.
create or replace function public.block_dissolves_friendship()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.friendships
   where requester_id = least(new.blocker_id, new.blocked_id)
     and addressee_id = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;

create trigger blocks_dissolve_friendship
  after insert on public.blocks
  for each row execute function public.block_dissolves_friendship();

-- 5. New accounts get a profile, and they get it as a ghost. The presence row
--    is created with visibility 'ghost', which means it is invisible to every
--    policy above and carries no zone. Nobody is on the map by default.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_handle text;
  candidate text;
  suffix int := 0;
begin
  base_handle := lower(regexp_replace(split_part(coalesce(new.email, 'wanderer'), '@', 1), '[^a-z0-9_]', '_', 'g'));
  base_handle := left(base_handle, 16);
  if char_length(base_handle) < 3 then
    base_handle := base_handle || 'ink';
  end if;

  candidate := base_handle;
  while exists (select 1 from public.profiles where handle = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_handle, 16) || suffix::text;
  end loop;

  insert into public.profiles (id, display_name, handle)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'A Wanderer'), '@', 1)
    ), 32),
    candidate
  )
  on conflict (id) do nothing;

  insert into public.live_presence (user_id, visibility)
  values (new.id, 'ghost')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. Account deletion, initiated by the user. Removes every row that belongs
--    to them, in both directions, then the auth user itself.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  delete from public.live_fixes where user_id = me;
  delete from public.live_presence where user_id = me;
  delete from public.friendships where requester_id = me or addressee_id = me;
  delete from public.blocks where blocker_id = me or blocked_id = me;
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- 7. Sweeper. Rows past their TTL are deleted, not archived. Scheduled with
--    pg_cron where available; supabase/functions/reap/index.ts is the fallback
--    for projects without it (see README).
create or replace function public.reap_expired()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer := 0;
  n integer;
begin
  delete from public.live_fixes where expires_at <= now();
  get diagnostics n = row_count; removed := removed + n;
  delete from public.live_presence where expires_at <= now() and visibility <> 'ghost';
  get diagnostics n = row_count; removed := removed + n;
  return removed;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.schedule('reap-expired-presence', '* * * * *', 'select public.reap_expired();');
  else
    raise notice 'pg_cron unavailable — schedule supabase/functions/reap on a 60s cron instead.';
  end if;
exception when others then
  raise notice 'Could not schedule pg_cron job (%). Use the reap Edge Function instead.', sqlerrm;
end;
$$;

-- ===========================================================================
-- Realtime
--
-- RLS is applied to postgres_changes for authenticated subscriptions, so these
-- publications hand each client only the rows its policies already admit. The
-- browser subscribes with the user's access token (see src/lib/supabase.ts,
-- which calls realtime.setAuth) — an anonymous socket receives nothing.
-- ===========================================================================
alter publication supabase_realtime add table public.live_presence;
alter publication supabase_realtime add table public.live_fixes;
alter publication supabase_realtime add table public.friendships;

-- Realtime needs the primary key in DELETE payloads so clients can lift a
-- print off the parchment when a row goes away.
alter table public.live_presence replica identity full;
alter table public.live_fixes replica identity full;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.friendships, public.blocks,
  public.live_presence, public.live_fixes
to authenticated;
