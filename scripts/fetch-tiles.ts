/**
 * Download the campus basemap once, at build time, and commit it.
 *
 * The app ships its own tiles from `public/tiles/`. There is no runtime tile
 * provider: nothing is fetched from anybody's server while somebody is using
 * the map, which is what makes the PWA work offline and means no third party
 * gets a log of where our readers are panning.
 *
 * The source is the standard OpenStreetMap raster style, which is the only
 * key-free basemap with real detail over this campus — it names the teachers'
 * quarters and the polytechnic ground, which is exactly the accuracy the
 * hand-drawn layer could not reach on its own. A gamma-and-tint filter washes
 * it into the parchment palette in the browser (see `mm-tile-wash`).
 *
 *   npm run fetch:tiles
 *
 * The OSM tile usage policy treats more than 250 tiles as bulk downloading, so
 * this stops at zoom 18 and stays well under that; Leaflet upscales the deepest
 * tiles for the last couple of zoom levels. Requests identify themselves and
 * run two at a time.
 *
 * Attribution — required, and shown on the map and in the About panel:
 *   © OpenStreetMap contributors
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/tiles');
const CAMPUS = resolve(HERE, '../src/data/campus.geojson');

/** z15 frames the whole estate; z18 is close enough to pick out a doorway. */
const MIN_Z = 15;
const MAX_Z = 18;
/** Two at a time, with a pause between, as the tile usage policy asks. */
const CONCURRENCY = 2;
const PAUSE_MS = 120;
/** The policy's own definition of bulk downloading. Staying under it is the point. */
const TILE_CAP = 250;

const template = (z: number, x: number, y: number): string =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const lngToX = (lng: number, z: number): number => Math.floor(((lng + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

interface Tile {
  z: number;
  x: number;
  y: number;
}

async function download(tile: Tile, attempt = 0): Promise<number> {
  const path = resolve(OUT_DIR, `${tile.z}/${tile.x}/${tile.y}.png`);
  if (existsSync(path) && statSync(path).size > 0) return statSync(path).size;

  try {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const res = await fetch(template(tile.z, tile.x, tile.y), {
      headers: {
        // The policy requires an identifiable agent.
        'User-Agent':
          'grounds-at-jamia/1.0 (one-off campus basemap build script; https://github.com/)',
        Accept: 'image/png,image/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return bytes.byteLength;
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return download(tile, attempt + 1);
    }
    throw new Error(`${tile.z}/${tile.x}/${tile.y}: ${String(err)}`);
  }
}

async function main(): Promise<void> {
  const campus = JSON.parse(
    (await import('node:fs')).readFileSync(CAMPUS, 'utf8'),
  ) as { properties: { renderBbox: [number, number, number, number] } };

  // A little wider than the render window, so panning to the very edge of the
  // sheet never reveals a blank square.
  const [west, south, east, north] = campus.properties.renderBbox;
  const pad = 0.0018;
  const bbox = {
    west: west - pad,
    south: south - pad,
    east: east + pad,
    north: north + pad,
  };

  console.log('Campus basemap — one-off tile fetch');
  console.log(`  bbox   ${bbox.south.toFixed(5)},${bbox.west.toFixed(5)} → ${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`);
  console.log(`  zooms  ${MIN_Z}–${MAX_Z}`);
  console.log('  source OpenStreetMap standard raster\n');

  const tiles: Tile[] = [];
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    const x0 = lngToX(bbox.west, z);
    const x1 = lngToX(bbox.east, z);
    const y0 = latToY(bbox.north, z);
    const y1 = latToY(bbox.south, z);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    console.log(`  z${z}: x ${x0}–${x1}, y ${y0}–${y1}  (${count} tiles)`);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  }

  if (tiles.length > TILE_CAP) {
    throw new Error(
      `${tiles.length} tiles exceeds the ${TILE_CAP} cap, which is where the OSM tile usage ` +
        'policy considers a download to be bulk. Narrow the bbox or the zoom range.',
    );
  }
  console.log(`\n  ${tiles.length} tiles to fetch\n`);

  let done = 0;
  let bytes = 0;
  const queue = [...tiles];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const tile = queue.shift();
      if (!tile) return;
      bytes += await download(tile);
      done += 1;
      if (done % 20 === 0 || done === tiles.length) {
        process.stdout.write(`\r  ${done}/${tiles.length}  ${(bytes / 1e6).toFixed(1)} MB`);
      }
    }
  });
  await Promise.all(workers);

  const manifest = {
    source: 'OpenStreetMap standard raster',
    attribution: '© OpenStreetMap contributors',
    fetchedAt: new Date().toISOString(),
    minZoom: MIN_Z,
    maxZoom: MAX_Z,
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    tiles: tiles.length,
    bytes,
  };
  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\n\n✓ ${tiles.length} tiles, ${(bytes / 1e6).toFixed(1)} MB → public/tiles/`);
  console.log('  wrote public/tiles/manifest.json');
  console.log('  the app serves these itself; no tile provider is contacted at runtime.');
}

main().catch((err: unknown) => {
  console.error('\n✗ fetch-tiles failed:', err);
  process.exit(1);
});
