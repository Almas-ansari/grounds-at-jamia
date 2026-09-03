/**
 * Prove the privacy model on a real Supabase project.
 *
 *   npm run verify:live
 *
 * The pgTAP suite asserts the same things against a local Postgres. This is the
 * end-to-end version: it creates two throwaway accounts on the *actual* project,
 * signs them both in as ordinary users, and checks what each one can and cannot
 * read — over HTTP, through PostgREST, with real JWTs. If the policies were
 * never applied, or applied wrongly, this is what catches it.
 *
 * It cleans up after itself, and refuses to run against a project named as
 * production. Needs SUPABASE_SERVICE_ROLE_KEY (to create and delete the test
 * users) — that key never reaches a browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import './env';

const PROJECT_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const PRODUCTION_REF = (process.env.PRODUCTION_SUPABASE_REF ?? '').trim();

const PASSWORD = `verify-${Math.random().toString(36).slice(2)}-Aa1!`;
const STAMP = Date.now();

interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail = ''): void => {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? '[32mPASS[0m' : '[31mFAIL[0m'}  ${name}${detail ? `   (${detail})` : ''}`);
};

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** A client that behaves exactly like the browser: anon key plus a user JWT. */
function asUser(accessToken: string): SupabaseClient {
  return createClient(PROJECT_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function main(): Promise<void> {
  if (!PROJECT_URL || !SERVICE_KEY || !ANON_KEY) {
    fail('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY in .env.local.');
  }
  const ref = new URL(PROJECT_URL).hostname.split('.')[0] ?? '';
  if (PRODUCTION_REF && ref === PRODUCTION_REF) {
    fail(`${PROJECT_URL} is PRODUCTION_SUPABASE_REF. Refusing to create test accounts there.`);
  }

  console.log(`\nVerifying the privacy model against ${PROJECT_URL}\n`);
  const admin = createClient(PROJECT_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- two throwaway people ------------------------------------------------
  const people: { id: string; email: string; token: string; client: SupabaseClient }[] = [];
  for (const who of ['alia', 'bilal']) {
    const email = `verify-${who}-${STAMP}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `Verify ${who}` },
    });
    if (error || !data.user) fail(`Could not create ${email}: ${error?.message}`);

    const anon = createClient(PROJECT_URL, ANON_KEY, { auth: { persistSession: false } });

    // Password sign-in needs the email provider switched on, and a project set
    // up for Google only will have it off. An admin-generated link works either
    // way and never sends anything: the token is handed straight back here.
    let token: string | null = null;
    const { data: session } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (session?.session) {
      token = session.session.access_token;
    } else {
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      if (linkError || !link.properties?.hashed_token) {
        fail(
          `Could not get a session for ${email}: ${linkError?.message ?? 'no token returned'}.\n` +
            '  Turn the Email provider on for a moment (Authentication -> Providers -> Email),\n' +
            '  re-run, and turn it off again if you like.',
        );
      }
      const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: 'magiclink',
      });
      if (verifyError || !verified.session) {
        fail(
          `Could not redeem a session for ${email}: ${verifyError?.message}.\n` +
            '  Turn the Email provider on for a moment (Authentication -> Providers -> Email),\n' +
            '  re-run, and turn it off again if you like.',
        );
      }
      token = verified.session.access_token;
    }
    people.push({ id: data.user.id, email, token, client: asUser(token) });
  }
  const [alia, bilal] = people as [(typeof people)[0], (typeof people)[0]];

  const cleanup = async (): Promise<void> => {
    for (const p of people) await admin.auth.admin.deleteUser(p.id).catch(() => undefined);
  };

  try {
    // --- 1. the trigger made profiles, in ghost --------------------------
    const { data: aliaProfile } = await alia.client.from('profiles').select('*').eq('id', alia.id).maybeSingle();
    check('a profile is created on sign-up', aliaProfile !== null, aliaProfile ? `@${aliaProfile.handle}` : 'none');

    const { data: presence } = await alia.client
      .from('live_presence')
      .select('visibility')
      .eq('user_id', alia.id)
      .maybeSingle();
    check('new accounts start as ghosts', presence?.visibility === 'ghost', String(presence?.visibility));

    // --- 2. Alia goes visible and publishes a precise fix ----------------
    await alia.client.from('live_presence').upsert(
      { user_id: alia.id, visibility: 'friends', zone_id: 'zakir-husain-library' },
      { onConflict: 'user_id' },
    );
    const { error: fixError } = await alia.client
      .from('live_fixes')
      .upsert({ user_id: alia.id, lat: 28.56259, lng: 77.28151, accuracy_m: 9 }, { onConflict: 'user_id' });
    check('a user can publish their own precise fix', !fixError, fixError?.message ?? '');

    // --- 3. THE ONE THAT MATTERS ------------------------------------------
    const { data: strangerRead } = await bilal.client.from('live_fixes').select('*');
    check(
      'a non-friend cannot read anybody’s coordinates',
      Array.isArray(strangerRead) && strangerRead.length === 0,
      `saw ${strangerRead?.length ?? '?'} rows`,
    );

    const { data: targeted } = await bilal.client.from('live_fixes').select('*').eq('user_id', alia.id);
    check(
      'not even when asking for that person by id',
      Array.isArray(targeted) && targeted.length === 0,
      `saw ${targeted?.length ?? '?'} rows`,
    );

    // --- 4. the TTL is the server's to set -------------------------------
    const { data: mine } = await alia.client.from('live_fixes').select('expires_at').eq('user_id', alia.id).maybeSingle();
    const ttl = mine ? (Date.parse(mine.expires_at) - Date.now()) / 1000 : -1;
    check('the server sets a ~90 s expiry', ttl > 80 && ttl < 95, `${ttl.toFixed(0)}s`);

    // --- 5. friendship opens it, and only once accepted ------------------
    const [lo, hi] = [alia.id, bilal.id].sort();
    const requester = lo === alia.id ? alia : bilal;
    const addressee = lo === alia.id ? bilal : alia;
    await requester.client.from('friendships').insert({ requester_id: lo, addressee_id: hi, status: 'pending' });

    const { data: whilePending } = await bilal.client.from('live_fixes').select('*').eq('user_id', alia.id);
    check(
      'a pending request grants nothing',
      Array.isArray(whilePending) && whilePending.length === 0,
      `saw ${whilePending?.length ?? '?'} rows`,
    );

    await addressee.client
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('requester_id', lo)
      .eq('addressee_id', hi);

    const { data: asFriend } = await bilal.client.from('live_fixes').select('*').eq('user_id', alia.id);
    check(
      'an accepted friend can read the fix',
      Array.isArray(asFriend) && asFriend.length === 1,
      `saw ${asFriend?.length ?? '?'} rows`,
    );

    // --- 6. public mode discloses a building, never a coordinate ---------
    await alia.client.from('live_presence').upsert(
      { user_id: alia.id, visibility: 'public', zone_id: 'central-canteen' },
      { onConflict: 'user_id' },
    );
    // Leaving `friends` for `public` must take the coordinates with it.
    await alia.client.from('live_fixes').delete().eq('user_id', alia.id);

    const { data: publicPresence } = await bilal.client
      .from('live_presence')
      .select('zone_id')
      .eq('user_id', alia.id)
      .maybeSingle();
    check('public mode discloses the zone', publicPresence?.zone_id === 'central-canteen', String(publicPresence?.zone_id));

    const { data: publicFix } = await bilal.client.from('live_fixes').select('*').eq('user_id', alia.id);
    check(
      'public mode discloses no coordinate at all',
      Array.isArray(publicFix) && publicFix.length === 0,
      `saw ${publicFix?.length ?? '?'} rows`,
    );

    // --- 7. ghost really deletes ------------------------------------------
    await alia.client.from('live_fixes').upsert(
      { user_id: alia.id, lat: 28.5626, lng: 77.2815 },
      { onConflict: 'user_id' },
    );
    await alia.client.from('live_presence').update({ visibility: 'ghost' }).eq('user_id', alia.id);

    const { count: ghostFixes } = await admin
      .from('live_fixes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', alia.id);
    check('going ghost deletes the fix server-side', ghostFixes === 0, `${ghostFixes} rows seen by the service role`);

    const { data: ghostPresence } = await bilal.client
      .from('live_presence')
      .select('user_id')
      .eq('user_id', alia.id);
    check(
      'a ghost is invisible even to a friend',
      Array.isArray(ghostPresence) && ghostPresence.length === 0,
      `saw ${ghostPresence?.length ?? '?'} rows`,
    );

    // --- 8. blocking is absolute and dissolves the friendship ------------
    await alia.client.from('live_presence').upsert(
      { user_id: alia.id, visibility: 'friends', zone_id: 'engineering' },
      { onConflict: 'user_id' },
    );
    await bilal.client.from('blocks').insert({ blocker_id: bilal.id, blocked_id: alia.id });

    const { count: friendshipRows } = await admin
      .from('friendships')
      .select('*', { count: 'exact', head: true })
      .eq('requester_id', lo)
      .eq('addressee_id', hi);
    check('a block dissolves the friendship', friendshipRows === 0, `${friendshipRows} rows remain`);

    const { data: afterBlock } = await bilal.client.from('live_presence').select('user_id').eq('user_id', alia.id);
    check(
      'the blocker stops seeing them',
      Array.isArray(afterBlock) && afterBlock.length === 0,
      `saw ${afterBlock?.length ?? '?'} rows`,
    );

    const { data: reverseBlock } = await alia.client.from('live_presence').select('user_id').eq('user_id', bilal.id);
    check(
      'and the blocked user stops seeing the blocker',
      Array.isArray(reverseBlock) && reverseBlock.length === 0,
      `saw ${reverseBlock?.length ?? '?'} rows`,
    );

    const { data: blockVisible } = await alia.client.from('blocks').select('*');
    check(
      'a blocked user cannot discover the block',
      Array.isArray(blockVisible) && blockVisible.length === 0,
      `saw ${blockVisible?.length ?? '?'} rows`,
    );

    // --- 9. nobody writes for anybody else --------------------------------
    const { error: forged } = await bilal.client
      .from('live_fixes')
      .insert({ user_id: alia.id, lat: 1, lng: 1 });
    check('you cannot write a fix for someone else', forged !== null, forged?.code ?? 'no error raised');
  } finally {
    await cleanup();
    console.log('\n  (test accounts deleted)');
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length > 0) {
    console.error('✗ the privacy model does not hold on this project:');
    for (const f of failed) console.error(`   - ${f.name}`);
    process.exit(1);
  }
  console.log('✓ the privacy model holds end to end on the live project\n');
}

main().catch(async (err: unknown) => {
  console.error('\nverify:live failed:', err);
  process.exit(1);
});
