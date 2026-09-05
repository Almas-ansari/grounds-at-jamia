/**
 * Does the map actually update live, and does going ghost actually remove you?
 *
 *   npm run verify:realtime
 *
 * Two throwaway accounts, made friends, with the second one subscribed exactly
 * the way the browser subscribes. Then the first one moves, and then goes
 * ghost, and we watch what the second one is actually sent. Realtime is the
 * one part of this app that cannot be checked by querying — the question is
 * what arrives unasked, and how quickly.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import './env';

const PROJECT_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

const STAMP = Date.now();
const PASSWORD = `rt-${Math.random().toString(36).slice(2)}-Aa1!`;

interface Event {
  readonly at: number;
  readonly table: string;
  readonly type: string;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ok = (pass: boolean, name: string, detail = ''): boolean => {
  console.log(`  ${pass ? '[32mPASS[0m' : '[31mFAIL[0m'}  ${name}${detail ? `   (${detail})` : ''}`);
  return pass;
};

async function session(admin: SupabaseClient, email: string): Promise<string> {
  const anon = createClient(PROJECT_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: pw } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (pw?.session) return pw.session.access_token;
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link.properties?.hashed_token;
  if (!hashed) throw new Error(`no token for ${email}`);
  const { data: v } = await anon.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
  if (!v.session) throw new Error(`could not redeem a session for ${email}`);
  return v.session.access_token;
}

async function main(): Promise<void> {
  if (!PROJECT_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY.');
    process.exit(1);
  }
  console.log(`\nWatching realtime on ${PROJECT_URL}\n`);

  const admin = createClient(PROJECT_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const people: { id: string; email: string; token: string; client: SupabaseClient }[] = [];
  for (const who of ['mover', 'watcher']) {
    const email = `rt-${who}-${STAMP}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    const token = await session(admin, email);
    const client = createClient(PROJECT_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.realtime.setAuth(token);
    people.push({ id: data.user.id, email, token, client });
  }
  const [mover, watcher] = people as [(typeof people)[0], (typeof people)[0]];

  let channel: RealtimeChannel | null = null;
  const results: boolean[] = [];

  try {
    // Friends, so the watcher is entitled to the precise fix.
    const [lo, hi] = [mover.id, watcher.id].sort();
    const requester = lo === mover.id ? mover : watcher;
    const addressee = lo === mover.id ? watcher : mover;
    await requester.client.from('friendships').insert({ requester_id: lo, addressee_id: hi });
    await addressee.client
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('requester_id', lo)
      .eq('addressee_id', hi);

    // --- the watcher subscribes, exactly as the browser does -------------
    const events: Event[] = [];
    let subscribed = false;
    channel = watcher.client
      .channel('verify-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_fixes' }, (p) =>
        events.push({ at: Date.now(), table: 'live_fixes', type: p.eventType }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_presence' }, (p) =>
        events.push({ at: Date.now(), table: 'live_presence', type: p.eventType }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') subscribed = true;
      });

    for (let i = 0; i < 50 && !subscribed; i++) await wait(200);
    results.push(ok(subscribed, 'the watcher can open an authenticated realtime channel'));

    // --- 1. the mover appears --------------------------------------------
    await mover.client
      .from('live_presence')
      .upsert({ user_id: mover.id, visibility: 'friends', zone_id: 'zakir-husain-library' }, { onConflict: 'user_id' });
    await mover.client
      .from('live_fixes')
      .upsert({ user_id: mover.id, lat: 28.56259, lng: 77.28151 }, { onConflict: 'user_id' });

    const t0 = Date.now();
    for (let i = 0; i < 40 && !events.some((e) => e.table === 'live_fixes'); i++) await wait(150);
    const first = events.find((e) => e.table === 'live_fixes');
    results.push(
      ok(Boolean(first), 'a friend appearing is pushed to the watcher', first ? `${first.at - t0} ms` : 'never arrived'),
    );

    // --- 2. the mover moves ----------------------------------------------
    events.length = 0;
    await wait(3400); // the server rate-limits precise fixes to one per 3 s
    const t1 = Date.now();
    await mover.client
      .from('live_fixes')
      .upsert({ user_id: mover.id, lat: 28.5629, lng: 77.2818 }, { onConflict: 'user_id' });
    for (let i = 0; i < 40 && !events.some((e) => e.table === 'live_fixes'); i++) await wait(150);
    const moved = events.find((e) => e.table === 'live_fixes');
    results.push(
      ok(Boolean(moved), 'movement is pushed live, with no polling', moved ? `${moved.at - t1} ms` : 'never arrived'),
    );

    // --- 3. going ghost while in Friends mode ----------------------------
    // The app deletes the presence row rather than setting it to ghost. That
    // matters: realtime evaluates the SELECT policy against the *new* row on an
    // UPDATE, and a ghost row fails it, so an update never reaches watchers. A
    // DELETE is authorised against the old row, which they could see.
    events.length = 0;
    const t2 = Date.now();
    await mover.client.from('live_fixes').delete().eq('user_id', mover.id);
    await mover.client.from('live_presence').delete().eq('user_id', mover.id);

    for (let i = 0; i < 40 && events.length < 2; i++) await wait(150);
    await wait(800);

    const fixGone = events.find((e) => e.table === 'live_fixes' && e.type === 'DELETE');
    const presenceGone = events.find((e) => e.table === 'live_presence' && e.type === 'DELETE');
    results.push(
      ok(
        Boolean(fixGone),
        'going ghost pushes a live_fixes DELETE',
        fixGone ? `${fixGone.at - t2} ms` : 'nothing arrived',
      ),
    );
    results.push(
      ok(
        Boolean(presenceGone),
        'going ghost pushes a live_presence DELETE',
        presenceGone ? `${presenceGone.at - t2} ms` : 'nothing arrived',
      ),
    );

    // --- 4. the case that was actually broken -----------------------------
    // Campus mode has no live_fixes row at all, so the presence DELETE is the
    // only thing that can tell a watcher the person has gone. Before this was
    // fixed they lingered on the map for the full 90-second TTL.
    events.length = 0;
    await mover.client
      .from('live_presence')
      .upsert({ user_id: mover.id, visibility: 'public', zone_id: 'central-canteen' }, { onConflict: 'user_id' });
    for (let i = 0; i < 40 && events.length === 0; i++) await wait(150);

    events.length = 0;
    const t3 = Date.now();
    await mover.client.from('live_presence').delete().eq('user_id', mover.id);
    for (let i = 0; i < 40 && events.length === 0; i++) await wait(150);
    await wait(600);

    const campusGone = events.find((e) => e.table === 'live_presence' && e.type === 'DELETE');
    results.push(
      ok(
        Boolean(campusGone),
        'a Campus-mode person going ghost is removed from watchers at once',
        campusGone ? `${campusGone.at - t3} ms` : 'nothing arrived — they would linger for the 90 s TTL',
      ),
    );

  } finally {
    if (channel) await watcher.client.removeChannel(channel);
    for (const p of people) await admin.auth.admin.deleteUser(p.id).catch(() => undefined);
    console.log('\n  (test accounts deleted)');
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('\nverify:realtime failed:', err);
  process.exit(1);
});
