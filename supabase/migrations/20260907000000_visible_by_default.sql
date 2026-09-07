-- New accounts arrive visible.
--
-- The original design put every new account into ghost, on the principle that
-- nobody should appear on a map before they have understood it. The author's
-- call is the opposite, and it is his to make: a map that is empty the first
-- time you open it is a map nobody opens twice. An account now starts public,
-- and ghost is one tap away in Settings.
--
-- Nothing else in the model moves. Ghost still deletes the precise row on the
-- server, the row still expires after ninety seconds, and every rule about who
-- can see whom is still a policy here rather than a check in the client.

alter table public.live_presence
  alter column visibility set default 'public';

-- The trigger hard-coded 'ghost'; it now leans on the column default, so this
-- is the only place the starting state is written down.
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

  insert into public.live_presence (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
