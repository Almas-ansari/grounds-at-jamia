/**
 * Tell me what is still missing.
 *
 *   npm run doctor
 *
 * Everything this app needs beyond `npm install` lives in two places: a .env
 * file and the Supabase dashboard. This checks both and prints exactly what is
 * left to do, with the link to do it. It only ever reads.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const GREEN = '[32m';
const RED = '[31m';
const RESET = '[0m';

const tick = (ok: boolean): string => (ok ? `${GREEN}  ok  ${RESET}` : `${RED} TODO ${RESET}`);
const todo: string[] = [];

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env.local', '.env']) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !out[m[1]!]) out[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

function report(url: string): void {
  const ref = url.replace('https://', '').replace('.supabase.co', '');
  if (todo.length === 0) {
    console.log(`\n${GREEN}Everything is set up. Run \`npm run dev\` and sign in.${RESET}\n`);
    return;
  }
  console.log(`\n${todo.length} thing${todo.length === 1 ? '' : 's'} left:\n`);
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}\n`));
  if (ref) console.log(`  Dashboard: https://supabase.com/dashboard/project/${ref}\n`);
}

async function main(): Promise<void> {
  console.log('\nThe Grounds at Jamia — setup check\n');
  const e = env();
  const url = e.VITE_SUPABASE_URL ?? '';
  const key = e.VITE_SUPABASE_ANON_KEY ?? '';
  const placeholder = (v: string): boolean =>
    !v || v.includes('your-project-ref') || v.includes('your-anon');

  // --- 1. the env file ----------------------------------------------------
  const urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url);
  console.log(`${tick(urlOk)} VITE_SUPABASE_URL        ${url || '(not set)'}`);
  if (!urlOk) {
    todo.push(
      url.includes('/rest/')
        ? 'VITE_SUPABASE_URL must be the bare project URL. Drop the /rest/v1/ suffix — supabase-js appends it itself, and with it there every request 404s.'
        : 'Set VITE_SUPABASE_URL in .env.local (Supabase dashboard, Settings, API, "Project URL").',
    );
  }

  const keyOk = !placeholder(key) && (key.startsWith('sb_publishable_') || key.startsWith('eyJ'));
  console.log(
    `${tick(keyOk)} VITE_SUPABASE_ANON_KEY   ${keyOk ? `set (${key.slice(0, 14)}...)` : '(not set)'}`,
  );
  if (!keyOk) {
    todo.push('Set VITE_SUPABASE_ANON_KEY in .env.local (Settings, API, the anon / publishable key).');
  }

  if (key && e.SUPABASE_SERVICE_ROLE_KEY && key === e.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(`${RED} WARN ${RESET} the anon key and the service role key are the same value`);
    todo.push(
      'CRITICAL: your anon key is the service role key. It bypasses every RLS policy and it ships in the browser bundle. Replace it before deploying anywhere.',
    );
  }

  if (!urlOk || !keyOk) {
    report(url);
    return;
  }

  const ref = url.replace('https://', '').replace('.supabase.co', '');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  // --- 2. is the project awake? -------------------------------------------
  // Any HTTP answer means the project is up; only a network failure means it is
  // not. A 401 here just means the endpoint wanted the key, which is fine.
  let reachable = false;
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15000),
    });
    reachable = res.status > 0;
  } catch {
    reachable = false;
  }
  console.log(`${tick(reachable)} project reachable`);
  if (!reachable) {
    todo.push(`Could not reach ${url}. Check the project is not paused.`);
    report(url);
    return;
  }

  // --- 3. has the migration been run? -------------------------------------
  const tables = ['profiles', 'friendships', 'blocks', 'live_presence', 'live_fixes'];
  const missing: string[] = [];
  for (const table of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 404) missing.push(table);
    } catch {
      missing.push(table);
    }
  }
  const migrated = missing.length === 0;
  console.log(
    `${tick(migrated)} migration applied        ${migrated ? `all ${tables.length} tables present` : `missing: ${missing.join(', ')}`}`,
  );
  if (!migrated) {
    todo.push(
      'Run the migration. Open\n' +
        `        https://supabase.com/dashboard/project/${ref}/sql/new\n` +
        '      paste the contents of supabase/migrations/20260101000000_init.sql, and press Run.',
    );
  }

  // --- 4. are the policies actually in force? -----------------------------
  if (migrated) {
    try {
      const res = await fetch(`${url}/rest/v1/live_fixes?select=user_id`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const rows: unknown = await res.json();
      const locked = Array.isArray(rows) && rows.length === 0;
      console.log(
        `${tick(locked)} RLS closed to strangers  ${locked ? 'live_fixes discloses nothing without a session' : 'IT RETURNED ROWS'}`,
      );
      if (!locked) {
        todo.push(
          'live_fixes is readable without signing in. The policies did not apply — re-run the migration and check for errors.',
        );
      }
    } catch {
      console.log(`${tick(false)} RLS check could not run`);
    }
  }

  // --- 5. sign-in providers ------------------------------------------------
  let google = false;
  try {
    const res = await fetch(
      `${url}/auth/v1/authorize?provider=google&redirect_to=http://localhost:5173/map`,
      { headers: { apikey: key }, redirect: 'manual', signal: AbortSignal.timeout(15000) },
    );
    google = (res.headers.get('location') ?? '').includes('accounts.google.com');
  } catch {
    google = false;
  }
  console.log(`${tick(google)} Google sign-in enabled`);
  if (!google) {
    todo.push(
      'Enable Google sign-in. It is two halves — the full walkthrough is in the README under\n' +
        '      "Google sign-in", but in short:\n' +
        `        a) Google Cloud Console, OAuth client (Web application).\n` +
        `           Authorised redirect URI:  ${url}/auth/v1/callback\n` +
        `        b) https://supabase.com/dashboard/project/${ref}/auth/providers\n` +
        '           turn Google on and paste the client ID and secret.',
    );
    todo.push(
      'Let the app back in after sign-in:\n' +
        `        https://supabase.com/dashboard/project/${ref}/auth/url-configuration\n` +
        '      Site URL: http://localhost:5173\n' +
        '      Redirect URLs: http://localhost:5173/**  (add your deployed URL too, when you have one)',
    );
  }

  // --- 6. committed map data ----------------------------------------------
  const geo = existsSync(resolve(ROOT, 'src/data/campus.geojson'));
  const tiles = existsSync(resolve(ROOT, 'public/tiles/manifest.json'));
  console.log(`${tick(geo)} campus geometry committed`);
  if (!geo) todo.push('Run `npm run fetch:campus`.');
  console.log(`${tick(tiles)} basemap tiles committed`);
  if (!tiles) todo.push('Run `npm run fetch:tiles`, then `npm run wash:tiles`.');

  report(url);
}

main().catch((err: unknown) => {
  console.error('doctor failed:', err);
  process.exit(1);
});
