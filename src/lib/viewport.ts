/**
 * The current map scale, shared outside React.
 *
 * Footprints need to know how far in the map is zoomed — both to draw
 * themselves smaller and to lay a tighter stride — but reading that through
 * React state would put a render on every frame of a gesture. MapCanvas writes
 * here imperatively instead, and the trail engine reads it when it places a
 * print.
 */
let currentZoom = 1;

export function setMapZoom(zoom: number): void {
  currentZoom = zoom;
}

export function getMapZoom(): number {
  return currentZoom;
}

/**
 * Glyph units → map units, at a given zoom.
 *
 * Zoomed out, a footprint has to be a symbol: legible at a thousand metres
 * across a phone screen, and therefore far larger than a real foot. Zoomed in,
 * it should shrink towards the truth — small, and placed precisely where the
 * person actually is. The exponent is what governs how fast it converges.
 */
export const FOOT_BASE_SCALE = 2.5;
const CONVERGENCE = 0.72;

export function footScaleFor(zoom: number): number {
  return FOOT_BASE_SCALE / Math.pow(Math.max(1, zoom), CONVERGENCE);
}
