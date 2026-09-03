/**
 * Build-time fetch of the real Jamia Millia Islamia campus geometry from OSM.
 *
 * Run once with `npm run fetch:campus`. The result is committed to
 * src/data/campus.geojson and the app NEVER calls Overpass at runtime.
 *
 * Strategy:
 *   1. Search by name/amenity around the Jamia Nagar seed point rather than
 *      trusting a hardcoded bbox. Pick the largest matching university area.
 *   2. Pull its full geometry, derive the bounds, sanity-check the span.
 *   3. Re-query every layer we care about inside those bounds.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/data/campus.geojson');

/** Jamia Nagar, Okhla, New Delhi 110025 — the search seed, not a bbox. */
const SEED = { lat: 28.5615, lng: 77.28 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

type LonLat = [number, number];
type OsmTags = Record<string, string>;
interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: OsmTags }
interface OsmGeomPt { lat: number; lon: number }
interface OsmWay { type: 'way'; id: number; tags?: OsmTags; geometry?: OsmGeomPt[]; bounds?: OsmBounds }
interface OsmRelMember { type: 'node' | 'way' | 'relation'; ref: number; role: string; geometry?: OsmGeomPt[] }
interface OsmRelation { type: 'relation'; id: number; tags?: OsmTags; members?: OsmRelMember[]; bounds?: OsmBounds }
interface OsmBounds { minlat: number; minlon: number; maxlat: number; maxlon: number }
type OsmElement = OsmNode | OsmWay | OsmRelation;

async function overpass(query: string, label: string): Promise<OsmElement[]> {
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        process.stdout.write(`  [${label}] ${new URL(endpoint).host} attempt ${attempt + 1}\u2026 `);
        const res = await fetch(endpoint, {
          method: 'POST',
          // Overpass instances reject text/plain bodies with 406; the form
          // encoding is the documented interface.
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Overpass answers 406 without an explicit UA + Accept pair.
            'User-Agent': 'marauders-map-jamia/1.0 (one-off campus geometry build script)',
            Accept: 'application/json',
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!text.trimStart().startsWith('{')) {
          const msg = /<strong[^>]*>Error<\/strong>:?\s*([^<]*)/i.exec(text)?.[1] ?? text.slice(0, 120);
          throw new Error(`server error: ${msg.trim()}`);
        }
        const json = JSON.parse(text) as { elements?: OsmElement[] };
        const elements = json.elements ?? [];
        process.stdout.write(`${elements.length} elements\n`);
        return elements;
      } catch (err) {
        lastError = err;
        process.stdout.write(`failed (${String(err)})\n`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Overpass query "${label}" failed on every endpoint: ${String(lastError)}`);
}

/** Metres per degree at a given latitude, good enough for a 1 km campus. */
const M_PER_DEG_LAT = 110574;
const mPerDegLng = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);

function ringFromGeometry(geometry: OsmGeomPt[]): LonLat[] {
  return geometry.map((p) => [p.lon, p.lat] as LonLat);
}

function closeRing(ring: LonLat[]): LonLat[] {
  if (ring.length < 3) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, first];
  return ring;
}

/** Stitch relation member ways into closed rings (multipolygon assembly). */
function assembleRings(members: OsmRelMember[], role: string): LonLat[][] {
  const segments = members
    .filter((m) => m.type === 'way' && m.role === role && m.geometry && m.geometry.length > 1)
    .map((m) => ringFromGeometry(m.geometry!));
  const rings: LonLat[][] = [];
  const pool = [...segments];
  while (pool.length > 0) {
    let current = pool.shift()!;
    let joined = true;
    while (joined) {
      joined = false;
      const head = current[0]!;
      const tail = current[current.length - 1]!;
      if (head[0] === tail[0] && head[1] === tail[1]) break;
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i]!;
        const sHead = seg[0]!;
        const sTail = seg[seg.length - 1]!;
        if (sHead[0] === tail[0] && sHead[1] === tail[1]) {
          current = [...current, ...seg.slice(1)];
          pool.splice(i, 1); joined = true; break;
        }
        if (sTail[0] === tail[0] && sTail[1] === tail[1]) {
          current = [...current, ...[...seg].reverse().slice(1)];
          pool.splice(i, 1); joined = true; break;
        }
        if (sTail[0] === head[0] && sTail[1] === head[1]) {
          current = [...seg, ...current.slice(1)];
          pool.splice(i, 1); joined = true; break;
        }
        if (sHead[0] === head[0] && sHead[1] === head[1]) {
          current = [...[...seg].reverse(), ...current.slice(1)];
          pool.splice(i, 1); joined = true; break;
        }
      }
    }
    if (current.length >= 4) rings.push(closeRing(current));
  }
  return rings;
}

function ringAreaM2(ring: LonLat[], midLat: number): number {
  const kx = mPerDegLng(midLat);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    sum += (a[0] * kx) * (b[1] * M_PER_DEG_LAT) - (b[0] * kx) * (a[1] * M_PER_DEG_LAT);
  }
  return Math.abs(sum) / 2;
}

type Layer =
  | 'boundary' | 'campus_core' | 'building' | 'footway' | 'road'
  | 'pitch' | 'green' | 'water' | 'poi';

/** Tags worth shipping to the browser. Everything else is dropped so the
 *  committed GeoJSON stays small. */
const KEEP_TAGS = new Set([
  'name', 'name:en', 'amenity', 'building', 'building:levels', 'highway',
  'leisure', 'landuse', 'natural', 'sport', 'religion', 'barrier', 'surface',
  'access', 'operator', 'tourism', 'shop', 'office', 'man_made', 'water',
]);
const trimTags = (tags: OsmTags): OsmTags =>
  Object.fromEntries(Object.entries(tags).filter(([k]) => KEEP_TAGS.has(k)));

interface Feature {
  type: 'Feature';
  id: string;
  properties: { layer: Layer; name?: string; osmId: string; tags: OsmTags };
  geometry:
    | { type: 'Polygon'; coordinates: LonLat[][] }
    | { type: 'LineString'; coordinates: LonLat[] }
    | { type: 'Point'; coordinates: LonLat };
}

function classify(tags: OsmTags, isClosed: boolean): Layer | null {
  // The academic core: OSM maps it as a closed amenity=university way that sits
  // inside the much larger administrative boundary relation.
  if (isClosed && (tags.amenity === 'university' || tags.amenity === 'college')) return 'campus_core';
  if (tags.building) return 'building';
  const hw = tags.highway;
  if (hw) {
    if (['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track'].includes(hw)) return 'footway';
    if (['service', 'residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street'].includes(hw)) return 'road';
    return null;
  }
  if (tags.leisure && ['pitch', 'park', 'garden', 'sports_centre', 'playground', 'stadium', 'track'].includes(tags.leisure)) return 'pitch';
  if (tags.natural === 'tree_row' || tags.natural === 'wood') return 'green';
  if (tags.landuse && ['grass', 'forest', 'recreation_ground', 'village_green', 'meadow'].includes(tags.landuse)) return 'green';
  if (tags.natural === 'water' || tags.water) return 'water';
  if (!isClosed && (tags.barrier || tags.waterway)) return null;
  if (tags.amenity || tags.name) return 'poi';
  return null;
}

async function main(): Promise<void> {
  console.log('Jamia Millia Islamia — campus geometry fetch');
  console.log(`Seed: ${SEED.lat}, ${SEED.lng} (Jamia Nagar, Okhla, New Delhi 110025)\n`);

  // ---- 1. Find the campus by name, expanding the search radius until found ----
  console.log('1. Locating the campus by name in OSM…');
  let campusEl: OsmElement | undefined;
  for (const radius of [1500, 3000, 6000]) {
    const found = await overpass(
      `[out:json][timeout:90];
       (
         way["amenity"~"^(university|college)$"](around:${radius},${SEED.lat},${SEED.lng});
         relation["amenity"~"^(university|college)$"](around:${radius},${SEED.lat},${SEED.lng});
         relation["boundary"="administrative"]["name"~"Jamia Millia",i](around:${radius},${SEED.lat},${SEED.lng});
       );
       out bb tags;`,
      `search r=${radius}m`,
    );
    const named = found.filter((e) => /jamia\s+millia/i.test(e.tags?.name ?? '') || /jamia\s+millia/i.test(e.tags?.['name:en'] ?? ''));
    if (named.length > 0) {
      // Prefer the largest bbox: the administrative boundary covers the whole
      // campus, the plain way covers only the academic core.
      named.sort((a, b) => {
        const ab = (a as OsmWay).bounds, bb = (b as OsmWay).bounds;
        const area = (x?: OsmBounds) => (x ? (x.maxlat - x.minlat) * (x.maxlon - x.minlon) : 0);
        return area(bb) - area(ab);
      });
      campusEl = named[0];
      console.log(`   matched ${named.length}: ${named.map((e) => `${e.type}/${e.id}`).join(', ')}`);
      console.log(`   using ${campusEl!.type}/${campusEl!.id} "${campusEl!.tags?.name}"\n`);
      break;
    }
  }
  if (!campusEl) throw new Error('Could not find Jamia Millia Islamia in OSM near the seed point.');

  // ---- 2. Full geometry of the campus boundary ----
  console.log('2. Fetching campus boundary geometry…');
  const boundaryQuery =
    campusEl.type === 'relation'
      ? `[out:json][timeout:120];
         relation(${campusEl.id});
         way(r);
         out geom;`
      : `[out:json][timeout:120];
         way(${campusEl.id});
         out geom;`;
  const boundaryEls = await overpass(boundaryQuery, 'boundary geom');
  const boundaryFeatures: Feature[] = [];
  const boundaryWays: OsmRelMember[] = boundaryEls
    .filter((e): e is OsmWay => e.type === 'way' && !!e.geometry)
    .map((w) => ({ type: 'way' as const, ref: w.id, role: 'outer', geometry: w.geometry }));
  const boundaryRings: LonLat[][] = assembleRings(boundaryWays, 'outer');
  if (boundaryRings.length === 0) throw new Error('Campus boundary has no usable geometry.');

  // ---- 3. Bounds + sanity check ----
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const ring of boundaryRings) {
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  const midLat = (north + south) / 2;
  const widthM = (east - west) * mPerDegLng(midLat);
  const heightM = (north - south) * M_PER_DEG_LAT;
  console.log('\n3. Campus bounds derived from OSM geometry:');
  console.log(`   west  ${west.toFixed(7)}   east  ${east.toFixed(7)}`);
  console.log(`   south ${south.toFixed(7)}   north ${north.toFixed(7)}`);
  console.log(`   span  ${widthM.toFixed(0)} m E-W  ×  ${heightM.toFixed(0)} m N-S`);
  if (widthM < 500 || widthM > 3000 || heightM < 500 || heightM > 3000) {
    throw new Error(`Bounds look wrong (${widthM.toFixed(0)}×${heightM.toFixed(0)} m); expected roughly 1000–1500 m across.`);
  }
  console.log('   ✓ bounds are sane (roughly 1–1.5 km across)\n');

  boundaryRings.sort((a, b) => ringAreaM2(b, midLat) - ringAreaM2(a, midLat));
  boundaryFeatures.push({
    type: 'Feature',
    id: `boundary/${campusEl.id}`,
    properties: { layer: 'boundary', name: campusEl.tags?.name ?? 'Jamia Millia Islamia', osmId: `${campusEl.type}/${campusEl.id}`, tags: trimTags(campusEl.tags ?? {}) },
    geometry: { type: 'Polygon', coordinates: [boundaryRings[0]!] },
  });

  // ---- 4. All layers inside the bounds (with a small margin) ----
  const pad = 0.0006; // ~65 m
  const bbox = `${(south - pad).toFixed(7)},${(west - pad).toFixed(7)},${(north + pad).toFixed(7)},${(east + pad).toFixed(7)}`;
  console.log(`4. Fetching campus layers within bbox ${bbox}…`);
  const els = await overpass(
    `[out:json][timeout:180][bbox:${bbox}];
     (
       way["building"];
       relation["building"];
       way["highway"];
       way["leisure"];
       relation["leisure"];
       way["landuse"];
       way["natural"];
       relation["natural"];
       way["amenity"];
       node["amenity"];
       node["name"];
     );
     out geom tags;`,
    'layers',
  );

  const features: Feature[] = [...boundaryFeatures];
  const seen = new Set<string>();
  let counts: Record<string, number> = {};

  for (const el of els) {
    const tags = el.tags ?? {};
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;

    if (el.type === 'node') {
      const layer = classify(tags, false);
      if (layer !== 'poi') continue;
      if (!tags.name && !tags.amenity) continue;
      seen.add(key);
      features.push({
        type: 'Feature', id: key,
        properties: { layer: 'poi', ...(tags.name ? { name: tags.name } : {}), osmId: key, tags: trimTags(tags) },
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
      });
      counts.poi = (counts.poi ?? 0) + 1;
      continue;
    }

    let rings: LonLat[][] = [];
    let line: LonLat[] | null = null;
    if (el.type === 'way' && el.geometry) {
      const coords = ringFromGeometry(el.geometry);
      const first = coords[0], last = coords[coords.length - 1];
      const isClosed = coords.length > 3 && !!first && !!last && first[0] === last[0] && first[1] === last[1];
      if (isClosed) rings = [coords]; else line = coords;
    } else if (el.type === 'relation' && el.members) {
      rings = assembleRings(el.members, 'outer');
    }

    const layer = classify(tags, rings.length > 0);
    if (!layer) continue;

    if (rings.length > 0) {
      // Polygon layers only; a closed footway ring is still drawn as a line.
      if (layer === 'footway' || layer === 'road') {
        seen.add(key);
        features.push({
          type: 'Feature', id: key,
          properties: { layer, ...(tags.name ? { name: tags.name } : {}), osmId: key, tags: trimTags(tags) },
          geometry: { type: 'LineString', coordinates: rings[0]! },
        });
      } else {
        seen.add(key);
        features.push({
          type: 'Feature', id: key,
          properties: { layer, ...(tags.name ? { name: tags.name } : {}), osmId: key, tags: trimTags(tags) },
          geometry: { type: 'Polygon', coordinates: [rings[0]!] },
        });
      }
      counts[layer] = (counts[layer] ?? 0) + 1;
    } else if (line && line.length > 1) {
      if (layer === 'poi') continue;
      seen.add(key);
      features.push({
        type: 'Feature', id: key,
        properties: { layer, ...(tags.name ? { name: tags.name } : {}), osmId: key, tags: trimTags(tags) },
        geometry: { type: 'LineString', coordinates: line },
      });
      counts[layer] = (counts[layer] ?? 0) + 1;
    }
  }

  console.log('\n5. Extracted layers:');
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(10)} ${v}`);
  }
  console.log(`   ${'boundary'.padEnd(10)} 1`);
  console.log(`   ${'TOTAL'.padEnd(10)} ${features.length}`);

  // ---- 5. The render window ----------------------------------------------
  // `bbox` above is the administrative boundary, which reaches well south into
  // Okhla Vihar. The map should be framed on the university's own estate: the
  // amenity=university polygon plus every JMI-named feature (the Engineering
  // and Architecture faculties sit outside the core polygon, south of Maulana
  // Mohamed Ali Jauhar Marg). Union those, pad, and square up to >= 900 m.
  const isJmi = (f: Feature): boolean =>
    /jamia|jmi|\bfet\b/i.test(f.properties.name ?? '') ||
    (f.properties.layer === 'campus_core' && /jamia/i.test(f.properties.name ?? ''));
  let rw = Infinity, re = -Infinity, rs = Infinity, rn = -Infinity;
  const swallow = ([lng, lat]: LonLat): void => {
    if (lng < rw) rw = lng; if (lng > re) re = lng;
    if (lat < rs) rs = lat; if (lat > rn) rn = lat;
  };
  for (const f of features) {
    if (!isJmi(f)) continue;
    if (f.geometry.type === 'Point') swallow(f.geometry.coordinates);
    else if (f.geometry.type === 'LineString') f.geometry.coordinates.forEach(swallow);
    else f.geometry.coordinates[0]!.forEach(swallow);
  }
  const rMid = (rn + rs) / 2;
  const padLng = 90 / mPerDegLng(rMid);
  const padLat = 90 / M_PER_DEG_LAT;
  rw -= padLng; re += padLng; rs -= padLat; rn += padLat;
  const growTo = (min: number, lo: number, hi: number, perDeg: number): [number, number] => {
    const spanM = (hi - lo) * perDeg;
    if (spanM >= min) return [lo, hi];
    const half = (min - spanM) / 2 / perDeg;
    return [lo - half, hi + half];
  };
  [rw, re] = growTo(900, rw, re, mPerDegLng(rMid));
  [rs, rn] = growTo(900, rs, rn, M_PER_DEG_LAT);
  const renderW = (re - rw) * mPerDegLng(rMid);
  const renderH = (rn - rs) * M_PER_DEG_LAT;
  console.log('\n6. Render window (the university estate, used by projection.ts):');
  console.log(`   west  ${rw.toFixed(7)}   east  ${re.toFixed(7)}`);
  console.log(`   south ${rs.toFixed(7)}   north ${rn.toFixed(7)}`);
  console.log(`   span  ${renderW.toFixed(0)} m E-W  \u00d7  ${renderH.toFixed(0)} m N-S`);
  if (renderW < 700 || renderW > 2000 || renderH < 700 || renderH > 2000) {
    throw new Error(`Render window looks wrong (${renderW.toFixed(0)}\u00d7${renderH.toFixed(0)} m).`);
  }
  console.log('   \u2713 render window is sane');

  const collection = {
    type: 'FeatureCollection' as const,
    // Frozen at fetch time and consumed by src/lib/projection.ts.
    bbox: [west, south, east, north] as [number, number, number, number],
    properties: {
      source: 'OpenStreetMap contributors, ODbL 1.0',
      fetchedAt: new Date().toISOString(),
      campusOsmId: `${campusEl.type}/${campusEl.id}`,
      spanMetres: { ew: Math.round(widthM), ns: Math.round(heightM) },
      renderBbox: [rw, rs, re, rn] as [number, number, number, number],
      renderSpanMetres: { ew: Math.round(renderW), ns: Math.round(renderH) },
    },
    features,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(collection) + '\n', 'utf8');
  console.log(`\n✓ wrote ${OUT}`);
  console.log('  Copy the bbox into src/lib/projection.ts if it ever changes:');
  console.log(`  west=${west} south=${south} east=${east} north=${north}`);
}

main().catch((err: unknown) => {
  console.error('\n✗ fetch-campus failed:', err);
  process.exit(1);
});
