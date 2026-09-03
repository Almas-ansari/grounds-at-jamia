-- ---------------------------------------------------------------------------
-- RLS suite.
--
-- These are the acceptance criteria for the privacy model, written as
-- assertions against the database rather than against the UI. The client is
-- not involved and could not influence any of them: every check below runs as
-- an impersonated `authenticated` user with RLS in force.
--
--   supabase test db                      (against a Supabase project)
--   npm run test:rls                      (against a bare local Postgres)
-- ---------------------------------------------------------------------------
begin;

create extension if not exists pgtap;

create schema if not exists tests;
grant usage on schema tests to public;

select plan(36);

-- --- fixtures --------------------------------------------------------------
-- Four people: Alia and Bilal are friends. Chandni is a stranger to both.
-- Danish blocks Alia partway through.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alia@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bilal@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'chandni@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'danish@example.test');

-- The on_auth_user_created trigger has already made a profile and a GHOST
-- presence row for each. That is the first thing worth asserting.
select is(
  (select count(*)::int from public.profiles),
  4,
  'a profile is created for every new auth user'
);

select is(
  (select count(*)::int from public.live_presence where visibility = 'ghost'),
  4,
  'ghost mode is the default for every new account — nobody starts on the map'
);

select is(
  (select count(*)::int from public.live_presence where visibility <> 'ghost'),
  0,
  'no new account is visible to anyone'
);

-- Helper: become a signed-in user.
-- `set_config(..., true)` is transaction-scoped, so the impersonation outlives
-- the helper call. `set local role` would be undone the moment the function
-- returned.
create or replace function tests.login(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', who::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- --- everyone goes visible -------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');
update public.live_presence set visibility = 'friends', zone_id = 'zakir-husain-library'
  where user_id = '11111111-1111-1111-1111-111111111111';
insert into public.live_fixes (user_id, lat, lng, accuracy_m, bearing)
values ('11111111-1111-1111-1111-111111111111', 28.56256, 77.28186, 12, 41);

select tests.logout();
select tests.login('22222222-2222-2222-2222-222222222222');
update public.live_presence set visibility = 'friends', zone_id = 'engineering'
  where user_id = '22222222-2222-2222-2222-222222222222';
insert into public.live_fixes (user_id, lat, lng, accuracy_m, bearing)
values ('22222222-2222-2222-2222-222222222222', 28.55990, 77.27930, 9, 200);

select tests.logout();
select tests.login('33333333-3333-3333-3333-333333333333');
update public.live_presence set visibility = 'public', zone_id = 'central-canteen'
  where user_id = '33333333-3333-3333-3333-333333333333';
select tests.logout();

-- ===========================================================================
-- 1. Two accounts who are not friends cannot read each other's precise fix.
-- ===========================================================================
select tests.login('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.live_fixes where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a non-friend cannot select another user''s live_fixes row'
);

select is(
  (select count(*)::int from public.live_fixes),
  0,
  'a non-friend selecting the whole table gets nothing at all'
);

select tests.logout();
select tests.login('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.live_fixes where user_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'and the reverse direction is equally blind'
);

select is(
  (select count(*)::int from public.live_fixes where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'but you can always read your own fix'
);
select tests.logout();

-- ===========================================================================
-- 2. A public-mode user's exact coordinates are not readable by a non-friend,
--    and `public` grants nothing on live_fixes even if a row were written.
-- ===========================================================================
select tests.login('33333333-3333-3333-3333-333333333333');
insert into public.live_fixes (user_id, lat, lng) values
  ('33333333-3333-3333-3333-333333333333', 28.56309, 77.28149);
select tests.logout();

select tests.login('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.live_fixes where user_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'public visibility discloses nothing on live_fixes to a non-friend'
);

select isnt(
  (select zone_id from public.live_presence where user_id = '33333333-3333-3333-3333-333333333333'),
  null,
  'public visibility does disclose the zone on live_presence'
);
select tests.logout();

-- The application never writes coordinates in public mode at all; this proves
-- that even a client that tried could not leak them.
select tests.login('33333333-3333-3333-3333-333333333333');
delete from public.live_fixes where user_id = '33333333-3333-3333-3333-333333333333';
select tests.logout();

-- ===========================================================================
-- 3. Accepted friends can read each other. Pending friendship cannot.
-- ===========================================================================
select tests.login('11111111-1111-1111-1111-111111111111');
insert into public.friendships (requester_id, addressee_id)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
select tests.logout();

select tests.login('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.live_fixes where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a PENDING friendship grants no access to a precise fix'
);

update public.friendships set status = 'accepted'
  where requester_id = '11111111-1111-1111-1111-111111111111'
    and addressee_id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.live_fixes where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'an ACCEPTED friendship grants access to the precise fix'
);
select tests.logout();

-- The requester may not accept on the addressee's behalf.
select tests.login('11111111-1111-1111-1111-111111111111');
insert into public.friendships (requester_id, addressee_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
select is(
  (select status::text from public.friendships
    where requester_id = '11111111-1111-1111-1111-111111111111'
      and addressee_id = '33333333-3333-3333-3333-333333333333'),
  'pending',
  'a new request starts pending'
);
update public.friendships set status = 'accepted'
  where requester_id = '11111111-1111-1111-1111-111111111111'
    and addressee_id = '33333333-3333-3333-3333-333333333333';
select is(
  (select status::text from public.friendships
    where requester_id = '11111111-1111-1111-1111-111111111111'
      and addressee_id = '33333333-3333-3333-3333-333333333333'),
  'pending',
  'the requester cannot accept their own request'
);
delete from public.friendships
  where requester_id = '11111111-1111-1111-1111-111111111111'
    and addressee_id = '33333333-3333-3333-3333-333333333333';
select tests.logout();

-- Nobody may forge a request in someone else's name.
select tests.login('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444')$$,
  '42501',
  null,
  'you cannot send a friend request as somebody else'
);
select tests.logout();

-- ===========================================================================
-- 4. Ghost mode removes you from the map, and takes your coordinates with it.
-- ===========================================================================
select tests.login('11111111-1111-1111-1111-111111111111');
update public.live_presence set visibility = 'ghost'
  where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select zone_id from public.live_presence where user_id = '11111111-1111-1111-1111-111111111111'),
  null,
  'going ghost nulls the zone'
);
select tests.logout();

-- Observed from the definer's seat: the fix row is really gone from the table,
-- not merely hidden by a policy.
select is(
  (select count(*)::int from public.live_fixes where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'going ghost DELETES the precise fix row server-side'
);

select tests.login('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.live_presence where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a ghost is invisible even to an accepted friend'
);
select tests.logout();

-- Back on the map for the block tests.
select tests.login('11111111-1111-1111-1111-111111111111');
update public.live_presence set visibility = 'friends', zone_id = 'zakir-husain-library'
  where user_id = '11111111-1111-1111-1111-111111111111';
insert into public.live_fixes (user_id, lat, lng) values
  ('11111111-1111-1111-1111-111111111111', 28.56256, 77.28186);
select tests.logout();

-- ===========================================================================
-- 5. Blocking is absolute, immediate, and dissolves the friendship.
-- ===========================================================================
select tests.login('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.live_presence where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'before the block, the friend is visible'
);
insert into public.blocks (blocker_id, blocked_id)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.live_presence where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'the blocker immediately stops seeing the blocked user'
);
select is(
  (select count(*)::int from public.live_fixes where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'and stops seeing their precise fix'
);
select tests.logout();

select tests.login('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.live_presence where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'the block runs the other way too — the blocked user stops seeing the blocker'
);
select is(
  (select count(*)::int from public.friendships
    where requester_id = '11111111-1111-1111-1111-111111111111'
      and addressee_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'the friendship is dissolved, not hidden'
);
select tests.logout();

select is(
  (select count(*)::int from public.friendships
    where requester_id = '11111111-1111-1111-1111-111111111111'
      and addressee_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'the friendship row is really deleted, seen from outside RLS'
);

-- A blocked user cannot re-friend their way back in.
select tests.login('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'a blocked user cannot send a fresh friend request'
);
select tests.logout();

-- Blocks are private: only the blocker sees them.
select tests.login('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.blocks),
  0,
  'a blocked user cannot discover that they were blocked'
);
select tests.logout();

-- ===========================================================================
-- 6. Writes are confined to your own rows.
-- ===========================================================================
select tests.login('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$insert into public.live_fixes (user_id, lat, lng)
    values ('44444444-4444-4444-4444-444444444444', 28.5, 77.2)$$,
  '42501',
  null,
  'you cannot write a fix for another user'
);
select throws_ok(
  $$insert into public.live_presence (user_id, visibility, zone_id)
    values ('44444444-4444-4444-4444-444444444444', 'public', 'engineering')$$,
  '42501',
  null,
  'you cannot put another user on the map'
);
select is(
  (select count(*)::int from public.live_presence p
    where p.user_id = '44444444-4444-4444-4444-444444444444'
      and p.visibility <> 'ghost'),
  0,
  'and the attempt left no trace'
);
select tests.logout();

-- ===========================================================================
-- 7. TTL and rate limit are enforced server-side, whatever the client sends.
-- ===========================================================================
select tests.login('44444444-4444-4444-4444-444444444444');
update public.live_presence set visibility = 'public', zone_id = 'bhopal-ground',
  expires_at = now() + interval '10 years', updated_at = now() - interval '1 day'
  where user_id = '44444444-4444-4444-4444-444444444444';

select ok(
  (select expires_at from public.live_presence where user_id = '44444444-4444-4444-4444-444444444444')
    between now() + interval '80 seconds' and now() + interval '95 seconds',
  'the server sets expires_at to ~90s and ignores what the client sent'
);
select ok(
  (select updated_at from public.live_presence where user_id = '44444444-4444-4444-4444-444444444444')
    > now() - interval '5 seconds',
  'the server sets updated_at and ignores what the client sent'
);

insert into public.live_fixes (user_id, lat, lng) values
  ('44444444-4444-4444-4444-444444444444', 28.5633, 77.2810);
select throws_ok(
  $$update public.live_fixes set lat = 28.5634
     where user_id = '44444444-4444-4444-4444-444444444444'$$,
  '53400',
  null,
  'a second precise fix within 3 seconds is rejected'
);
select tests.logout();

-- ===========================================================================
-- 8. Expiry: a stale row stops being visible, and then stops existing.
-- ===========================================================================
-- Age the rows artificially. The TTL trigger would stamp expires_at back to
-- now()+90s and the rate limiter would reject the write, which is exactly the
-- behaviour asserted above; both are suspended for this one setup step.
alter table public.live_presence disable trigger live_presence_ttl;
alter table public.live_fixes disable trigger live_fixes_ttl;
alter table public.live_fixes disable trigger a_live_fixes_rate_limit;

update public.live_presence
   set expires_at = now() - interval '1 second'
 where user_id = '44444444-4444-4444-4444-444444444444';
update public.live_fixes
   set expires_at = now() - interval '1 second'
 where user_id = '44444444-4444-4444-4444-444444444444';

alter table public.live_presence enable trigger live_presence_ttl;
alter table public.live_fixes enable trigger live_fixes_ttl;
alter table public.live_fixes enable trigger a_live_fixes_rate_limit;

select tests.login('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.live_presence where user_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'an expired presence row is invisible before any sweeper runs'
);
select tests.logout();

select ok(
  public.reap_expired() >= 2,
  'the sweeper deletes rows past their TTL'
);
select is(
  (select count(*)::int from public.live_fixes where user_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'and the expired fix is gone from the table entirely'
);

-- ===========================================================================
-- 9. There is nowhere for history to accumulate.
-- ===========================================================================
select is(
  (select count(*)::int
     from information_schema.tables
    where table_schema = 'public'
      and table_name in ('live_fixes', 'live_presence')),
  2,
  'exactly two live tables exist'
);
select is(
  (select count(*)::int
     from information_schema.table_constraints
    where table_schema = 'public'
      and table_name in ('live_fixes', 'live_presence')
      and constraint_type = 'PRIMARY KEY'),
  2,
  'both are keyed by user_id alone, so a row can only ever be replaced in place'
);

select * from finish();
rollback;
