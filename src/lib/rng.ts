/**
 * Seeded pseudo-randomness.
 *
 * Every wobble in the ink is random-looking but deterministic: the same
 * building must be drawn with the same crooked stroke on every reload, or the
 * map stops feeling like an object and starts feeling like a render.
 */

/** FNV-1a. Fast, and good enough to decorrelate adjacent OSM ids. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and stable across engines. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable value in [min, max) derived from a string key. */
export function seededRange(key: string, min: number, max: number): number {
  return min + seededRandom(hashString(key))() * (max - min);
}

/** A stable pick from a list. */
export function seededPick<T>(key: string, items: readonly T[]): T {
  if (items.length === 0) throw new Error('seededPick called with an empty list');
  return items[Math.floor(seededRange(key, 0, items.length)) % items.length]!;
}
