/**
 * Six invented people who walk the campus, so the map can be built and
 * demonstrated by one person with one phone.
 *
 *   npm run seed:phantoms
 *
 * They walk the real footpath and road network at 1.3 m/s between real zones,
 * publish through the same two tables the app uses, and obey the same TTL —
 * this writes no row the application could not have written itself.
 *
 * It refuses to run against anything that looks like production. It needs the
 * service role key, because it creates auth users; that key must never reach a
 * browser bundle, which is why this is a node script and not a page.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import './env';

import {
  advanceAlongRoute,
  buildWalkGraph,
  routeLengthMetres,
  type WalkFeature,
} from '../src/lib/walkgraph';
import { zones, type Zone } from '../src/data/zones';
import { EAST, NORTH, SOUTH, WEST, bearingDegrees, type LngLat } from '../src/lib/projection';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PRODUCTION_REF = (process.env.PRODUCTION_SUPABASE_REF ?? '').trim();

const WALK_SPEED_MS = 1.3;
const TICK_SECONDS = 3;
const PHANTOM_COUNT = 6;

const PHANTOMS = [
  { name: 'Rukhsana Iqbal', handle: 'phantom_rukhsana', faculty: 'Social Sciences' },
  { name: 'Imtiaz Sheikh', handle: 'phantom_imtiaz', faculty: 'Engineering and Technology' },
  { name: 'Parveen Rahman', handle: 'phantom_parveen', faculty: 'Humanities and Languages' },
  { name: 'Yusuf Ali', handle: 'phantom_yusuf', faculty: 'Law' },
  { name: 'Shabana Qureshi', handle: 'phantom_shabana', faculty: 'Architecture and Ekistics' },
  { name: 'Zaheer Abbas', handle: 'phantom_zaheer', faculty: 'Natural Sciences' },
] as const;

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------
function refuseProduction(): void {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy .env.example to .env.local first.',
    );
  }

  const ref = new URL(SUPABASE_URL).hostname.split('.')[0] ?? '';

  if (PRODUCTION_REF && ref === PRODUCTION_REF) {
    fail(`SUPABASE_URL points at PRODUCTION_SUPABASE_REF (${PRODUCTION_REF}). Refusing to seed.`);
  }
  if (/\b(prod|production|live)\b/i.test(SUPABASE_URL)) {
    fail(`SUPABASE_URL looks like production (${SUPABASE_URL}). Refusing to seed.`);
  }
  if (!PRODUCTION_REF && process.env.SEED_I_KNOW_WHAT_I_AM_DOING !== 'yes') {
    fail(
      'PRODUCTION_SUPABASE_REF is not set, so this script cannot tell whether it is safe.\n' +
        '  Set PRODUCTION_SUPABASE_REF to your production project ref, or, if this project has no\n' +
        '  production at all, re-run with SEED_I_KNOW_WHAT_I_AM_DOING=yes.',
    );
  }
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Walkers
// ---------------------------------------------------------------------------
interface Phantom {
  userId: string;
  name: string;
  route: LngLat[];
  routeLength: number;
  distance: number;
  dwell: number;
  target: Zone;
  point: LngLat;
  bearing: number;
}

async function ensurePhantom(
  admin: SupabaseClient,
  spec: (typeof PHANTOMS)[number],
): Promise<string> {
  const email = `${spec.handle}@phantom.invalid`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: spec.name },
  });

  let userId = created?.user?.id ?? null;
  if (!userId) {
    if (!/already|registered|exists/i.test(error?.message ?? '')) {
      fail(`Could not create ${spec.handle}: ${error?.message ?? 'unknown error'}`);
    }
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list?.users.find((u) => u.email === email)?.id ?? null;
    if (!userId) fail(`${spec.handle} exists but could not be found.`);
  }

  // The auth trigger already made a profile; give it the phantom's own name.
  await admin
    .from('profiles')
    .upsert(
      { id: userId, display_name: spec.name, handle: spec.handle, faculty: spec.faculty },
      { onConflict: 'id' },
    );
  return userId;
}

async function main(): Promise<void> {
  refuseProduction();

  console.log('Seeding phantom wanderers');
  console.log(`  target: ${SUPABASE_URL}`);
  console.log('  they walk the real path network between real zones at 1.3 m/s\n');

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Node has no bundler, so the committed extract is read straight off disk.
  const geojson = JSON.parse(
    readFileSync(resolve(HERE, '../src/data/campus.geojson'), 'utf8'),
  ) as { features: WalkFeature[] };

  const graph = buildWalkGraph(geojson.features, { west: WEST, south: SOUTH, east: EAST, north: NORTH });
  console.log(`  walk network: ${graph.nodes.length} junctions\n`);

  const walkable = zones.filter((z) => z.kind !== 'gate');
  const pick = (not?: Zone): Zone => {
    const options = walkable.filter((z) => z.id !== not?.id);
    return options[Math.floor(Math.random() * options.length)] ?? walkable[0]!;
  };

  const phantoms: Phantom[] = [];
  for (let i = 0; i < PHANTOM_COUNT; i++) {
    const spec = PHANTOMS[i % PHANTOMS.length]!;
    const userId = await ensurePhantom(admin, spec);
    const from = pick();
    const to = pick(from);
    const route = graph.route(from.centroid, to.centroid);
    phantoms.push({
      userId,
      name: spec.name,
      route,
      routeLength: routeLengthMetres(route),
      distance: 0,
      dwell: Math.random() * 20,
      target: to,
      point: from.centroid,
      bearing: 0,
    });
    // Half go public (a zone only), half go friends-visible (real coordinates),
    // so both disclosure levels can be seen at once.
    const visibility = i % 2 === 0 ? 'friends' : 'public';
    await admin.from('live_presence').upsert(
      { user_id: userId, visibility, zone_id: from.id },
      { onConflict: 'user_id' },
    );
    console.log(`  ✓ ${spec.name.padEnd(18)} ${visibility.padEnd(8)} starting at ${from.name}`);
  }

  console.log('\n  walking… (ctrl-c to stop; rows expire on their own 90 s later)\n');

  const step = async (): Promise<void> => {
    for (const [index, phantom] of phantoms.entries()) {
      if (phantom.dwell > 0) {
        phantom.dwell -= TICK_SECONDS;
      } else {
        const previous = phantom.point;
        phantom.distance += WALK_SPEED_MS * TICK_SECONDS;
        const progress = advanceAlongRoute(phantom.route, phantom.distance);
        phantom.point = progress.point;
        phantom.bearing = bearingDegrees(previous, progress.point);
        if (progress.done || phantom.distance >= phantom.routeLength) {
          const next = pick(phantom.target);
          phantom.route = graph.route(phantom.point, next.centroid);
          phantom.routeLength = routeLengthMetres(phantom.route);
          phantom.distance = 0;
          phantom.target = next;
          phantom.dwell = 9 + Math.random() * 30;
        }
      }

      const visibility = index % 2 === 0 ? 'friends' : 'public';
      await admin
        .from('live_presence')
        .upsert({ user_id: phantom.userId, visibility, zone_id: phantom.target.id }, { onConflict: 'user_id' });

      if (visibility === 'friends') {
        await admin.from('live_fixes').upsert(
          {
            user_id: phantom.userId,
            lat: phantom.point.lat,
            lng: phantom.point.lng,
            accuracy_m: 8 + Math.random() * 10,
            bearing: phantom.bearing,
          },
          { onConflict: 'user_id' },
        );
      }
    }
    process.stdout.write('.');
  };

  await step();
  const timer = setInterval(() => {
    void step();
  }, TICK_SECONDS * 1000);

  const stop = async (): Promise<void> => {
    clearInterval(timer);
    console.log('\n\n  clearing phantom rows…');
    for (const phantom of phantoms) {
      await admin.from('live_fixes').delete().eq('user_id', phantom.userId);
      await admin.from('live_presence').update({ visibility: 'ghost' }).eq('user_id', phantom.userId);
    }
    console.log('  ✓ the grounds are quiet again');
    process.exit(0);
  };

  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((err: unknown) => {
  console.error('\n✗ seed:phantoms failed:', err);
  process.exit(1);
});
