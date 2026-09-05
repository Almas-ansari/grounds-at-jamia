/**
 * Fill in the buildings OpenStreetMap has not got round to yet.
 *
 *   npm run fetch:buildings
 *
 * OSM has 165 buildings on this campus and a good many of the real ones are
 * simply absent. Microsoft's Global ML Building Footprints is a machine-derived
 * set of outlines covering India, released under **ODbL — the same licence as
 * OpenStreetMap** — which makes it the one source that can legally fill those
 * gaps here. (Tracing a commercial map would not be: it is a derivative work
 * however few times you copy it, and it would make the result impossible to
 * contribute back to OSM.)
 *
 * These are machine-derived, so they are less exact than a hand-drawn OSM
 * building — a little blobby, and now and then two neighbours merged into one.
 * That is why anything OSM already knows about wins: a footprint is kept only
 * where OSM has nothing, so the surveyed data is never overdrawn by a guess.
 *
 * Attribution, required and rendered in the map margin:
 *   Building footprints © Microsoft, ODbL
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/data/ml-buildings.geojson');
const CAMPUS = resolve(HERE, '../src/data/campus.geojson');
const CACHE = resolve(HERE, '../.tiles-raw/ml-buildings.geojsonl.gz');

const INDEX = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';
/** The level-9 tile covering Jamia Nagar. */
const QUADKEY = '123121303';

type Ring = [number, number][];

function bboxOf(ring: Ring): { w: number; s: number; e: number; n: number } {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return { w, s, e, n };
}

const centroidOf = (ring: Ring): [number, number] => {
  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
};

function inRing(pt: [number, number], ring: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1]! > pt[1] !== b[1]! > pt[1]) {
      if (pt[0] < ((b[0]! - a[0]!) * (pt[1] - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
    }
  }
  return inside;
}

async function download(url: string): Promise<void> {
  if (existsSync(CACHE) && statSync(CACHE).size > 1_000_000) {
    console.log(`  using the cached download (${(statSync(CACHE).size / 1e6).toFixed(0)} MB)`);
    return;
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  console.log('  downloading the regional footprint file (about 125 MB, once)…');
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let seen = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    seen += chunk.length;
    if (total) process.stdout.write(`\r  ${((seen / total) * 100).toFixed(0)}%   `);
  });
  await pipeline(body, createWriteStream(CACHE));
  process.stdout.write('\r  downloaded            \n');
}

async function main(): Promise<void> {
  console.log('Filling the gaps OpenStreetMap has not surveyed\n');

  // --- where the campus is -------------------------------------------------
  const campus = JSON.parse(readFileSync(CAMPUS, 'utf8')) as {
    properties: { renderBbox: [number, number, number, number] };
    features: {
      properties: { layer: string };
      geometry: { type: string; coordinates: unknown };
    }[];
  };
  const [west, south, east, north] = campus.properties.renderBbox;
  const pad = 0.0012;
  const box = { w: west - pad, s: south - pad, e: east + pad, n: north + pad };
  console.log(`  window ${box.s.toFixed(4)},${box.w.toFixed(4)} → ${box.n.toFixed(4)},${box.e.toFixed(4)}`);

  const osmBuildings: Ring[] = campus.features
    .filter((f) => f.properties.layer === 'building' && f.geometry.type === 'Polygon')
    .map((f) => (f.geometry.coordinates as Ring[])[0]!)
    .filter(Boolean);
  console.log(`  OSM already has ${osmBuildings.length} buildings here\n`);

  // --- fetch ---------------------------------------------------------------
  const index = await (await fetch(INDEX)).text();
  const row = index.split('\n').find((line) => line.includes(`,${QUADKEY},`));
  if (!row) throw new Error(`quadkey ${QUADKEY} is not in the index`);
  const url = row.split(',')[2];
  if (!url) throw new Error('malformed index row');
  await download(url);

  // --- keep only what is on campus and not already known -------------------
  console.log('\n  scanning…');
  const kept: { type: 'Feature'; properties: Record<string, number>; geometry: { type: 'Polygon'; coordinates: Ring[] } }[] = [];
  let scanned = 0;
  let inWindow = 0;

  const lines = createInterface({
    input: createReadStream(CACHE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    scanned += 1;
    if (scanned % 250_000 === 0) process.stdout.write(`\r  ${(scanned / 1000).toFixed(0)}k lines, ${kept.length} kept  `);
    // A cheap substring test before the expensive parse: the campus is the only
    // place in this region at 77.2x / 28.5x.
    if (!line.includes('[77.2') || !line.includes('28.5')) continue;

    let feature: { properties?: Record<string, number>; geometry?: { coordinates?: Ring[] } };
    try {
      feature = JSON.parse(line) as typeof feature;
    } catch {
      continue;
    }
    const ring = feature.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) continue;

    const b = bboxOf(ring);
    if (b.e < box.w || b.w > box.e || b.n < box.s || b.s > box.n) continue;
    inWindow += 1;

    // Anything OSM has surveyed wins, and "already known" is tested three ways
    // because one is not enough. A machine footprint can be offset from the
    // surveyed one, or merge two neighbours into a single blob — in both cases
    // its centre falls outside the OSM polygon while plainly being the same
    // building. Drawing it would double the building on screen.
    const centre = centroidOf(ring);
    const mine = bboxOf(ring);
    const duplicate = osmBuildings.some((osm) => {
      if (inRing(centre, osm)) return true;
      const theirs = bboxOf(osm as Ring);
      if (inRing(centroidOf(osm as Ring), ring)) return true;
      // Bounding boxes that substantially overlap are the same building.
      const ox = Math.min(mine.e, theirs.e) - Math.max(mine.w, theirs.w);
      const oy = Math.min(mine.n, theirs.n) - Math.max(mine.s, theirs.s);
      if (ox <= 0 || oy <= 0) return false;
      const overlap = ox * oy;
      const smaller = Math.min(
        (mine.e - mine.w) * (mine.n - mine.s),
        (theirs.e - theirs.w) * (theirs.n - theirs.s),
      );
      return smaller > 0 && overlap / smaller > 0.3;
    });
    if (duplicate) continue;

    kept.push({
      type: 'Feature',
      properties: {
        confidence: Number((feature.properties?.['confidence'] ?? 0).toFixed(3)),
      },
      geometry: {
        type: 'Polygon',
        coordinates: [ring.map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))] as [number, number])],
      },
    });
  }

  process.stdout.write('\r                                        \r');
  console.log(`  scanned ${(scanned / 1000).toFixed(0)}k footprints`);
  console.log(`  ${inWindow} fall on the campus window`);
  console.log(`  ${inWindow - kept.length} of those OSM already knows about — dropped`);
  console.log(`  ${kept.length} genuinely new buildings kept`);

  writeFileSync(
    OUT,
    JSON.stringify({
      type: 'FeatureCollection',
      properties: {
        source: 'Microsoft Global ML Building Footprints',
        licence: 'ODbL 1.0',
        attribution: 'Building footprints © Microsoft, ODbL',
        quadkey: QUADKEY,
        fetchedAt: new Date().toISOString(),
        note: 'Machine-derived. Kept only where OpenStreetMap has no building.',
      },
      features: kept,
    }) + '\n',
  );
  console.log(`\n✓ wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((err: unknown) => {
  console.error('\n✗ fetch-buildings failed:', err);
  process.exit(1);
});
