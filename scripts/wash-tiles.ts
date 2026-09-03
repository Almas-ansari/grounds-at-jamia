/**
 * Bake the parchment wash into the basemap tiles, once, at build time.
 *
 * The wash used to be a CSS filter on the tile pane. That works, but a filter
 * on a pane that scales and translates constantly is re-rasterised on every
 * frame of every gesture — which is most of what "the zoom is laggy" felt
 * like. Doing it here costs nothing at runtime at all.
 *
 * The tiles are 8-bit palette PNGs, so this never touches a pixel: it rewrites
 * the 256-entry PLTE chunk and fixes the CRC. A tile is a few kilobytes and the
 * whole set takes well under a second.
 *
 * Reads `.tiles-raw/`, writes `public/tiles/`. Raw tiles are kept out of git so
 * the wash can be re-run — change the ramp below and run it again, no
 * re-download.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, '../.tiles-raw');
const OUT = resolve(HERE, '../public/tiles');

/**
 * Greyscale, a gamma curve to pull the pale road casings down where they can
 * be seen on parchment, then a ramp from --ink at black to --parchment at
 * white. This is the same transform the SVG filter used to do per frame.
 */
const GAMMA = 1.45;
const RAMP = {
  r: { slope: 0.76, offset: 0.14 },
  g: { slope: 0.76, offset: 0.086 },
  b: { slope: 0.64, offset: 0.048 },
} as const;

function wash(r: number, g: number, b: number): [number, number, number] {
  // Rec. 709 luminance, matching feColorMatrix type="saturate" values="0".
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const v = Math.pow(l, GAMMA);
  const to = (c: { slope: number; offset: number }): number =>
    Math.max(0, Math.min(255, Math.round((c.slope * v + c.offset) * 255)));
  return [to(RAMP.r), to(RAMP.g), to(RAMP.b)];
}

/** Rewrite the palette of an 8-bit indexed PNG in place. */
function washPng(buffer: Buffer, file: string): Buffer {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  const colourType = buffer[25];
  if (colourType !== 3) throw new Error(`${file}: colour type ${colourType}, expected 3 (palette)`);

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;

    if (type === 'PLTE') {
      const out = Buffer.from(buffer);
      for (let i = 0; i < length; i += 3) {
        const p = dataStart + i;
        const [r, g, b] = wash(buffer[p]!, buffer[p + 1]!, buffer[p + 2]!);
        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
      }
      // The CRC covers the chunk type and its data.
      const crc = crc32(out.subarray(offset + 4, dataStart + length));
      out.writeUInt32BE(crc >>> 0, dataStart + length);
      return out;
    }

    if (type === 'IDAT') break; // PLTE always precedes IDAT
    offset = dataStart + length + 4;
  }
  throw new Error(`${file}: no PLTE chunk`);
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (path.endsWith('.png')) found.push(path);
  }
  return found;
}

function main(): void {
  if (!existsSync(RAW)) {
    console.error(
      `\n✗ No raw tiles at ${RAW}.\n  Run \`npm run fetch:tiles\` first — it downloads there and calls this script.\n`,
    );
    process.exit(1);
  }

  const files = walk(RAW);
  console.log(`Washing ${files.length} tiles into the parchment palette`);

  let bytes = 0;
  for (const file of files) {
    const target = join(OUT, relative(RAW, file));
    mkdirSync(dirname(target), { recursive: true });
    const washed = washPng(readFileSync(file), file);
    writeFileSync(target, washed);
    bytes += washed.byteLength;
  }

  const manifestPath = join(RAW, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.washed = true;
    manifest.washedAt = new Date().toISOString();
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }

  console.log(`✓ ${files.length} tiles, ${(bytes / 1e6).toFixed(1)} MB → public/tiles/`);
  console.log('  the palette is baked, so the app needs no runtime filter at all.');
  const sample = files[0];
  if (sample) {
    const before = readFileSync(sample);
    console.log(`  (unchanged in size: ${statSync(sample).size} → ${washPng(before, sample).byteLength} bytes)`);
  }
}

main();
