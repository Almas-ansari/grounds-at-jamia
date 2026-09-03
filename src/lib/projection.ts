/**
 * Equirectangular projection over a fixed campus bounding box.
 *
 * The campus is ~1 km across, so a plate-carrée projection with a single
 * cos(latitude) correction is accurate to well under a metre here — far more
 * precision than a hand-drawn parchment needs, and it keeps `project` and
 * `unproject` exact inverses of one another.
 *
 * The bounding box is the render window computed by scripts/fetch-campus.ts
 * from the real OSM geometry: the union of the amenity=university polygon and
 * every JMI-named feature, padded by 90 m. It is frozen here so the SVG
 * viewBox never shifts under the artwork.
 */
import { campus } from '../data/campus';

export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const renderBbox = campus.properties.renderBbox;

export const WEST = renderBbox[0];
export const SOUTH = renderBbox[1];
export const EAST = renderBbox[2];
export const NORTH = renderBbox[3];

/** The full data extent from OSM (the administrative boundary). */
export const DATA_BBOX = campus.bbox;

/** SVG user units across the map. Chosen so 1 unit ≈ 0.6 m on the ground. */
export const WIDTH = 1600;

const LNG_SPAN = EAST - WEST;
const LAT_SPAN = NORTH - SOUTH;
const MID_LAT = (NORTH + SOUTH) / 2;
const MID_LAT_RAD = (MID_LAT * Math.PI) / 180;
const COS_MID_LAT = Math.cos(MID_LAT_RAD);

/** Keeps ground distances isotropic: one x unit covers the same metres as one y unit. */
export const HEIGHT = WIDTH * (LAT_SPAN / (LNG_SPAN * COS_MID_LAT));

/** Metres per degree, good to ~0.1% over a campus-sized area. */
export const METRES_PER_DEG_LAT = 110574;
export const METRES_PER_DEG_LNG = 111320 * COS_MID_LAT;

/** Ground metres represented by one SVG user unit. */
export const METRES_PER_UNIT = (LNG_SPAN * METRES_PER_DEG_LNG) / WIDTH;

export function project(lat: number, lng: number): Point {
  return {
    x: ((lng - WEST) / LNG_SPAN) * WIDTH,
    y: ((NORTH - lat) / LAT_SPAN) * HEIGHT,
  };
}

export function unproject(x: number, y: number): LngLat {
  return {
    lng: WEST + (x / WIDTH) * LNG_SPAN,
    lat: NORTH - (y / HEIGHT) * LAT_SPAN,
  };
}

/** Great-circle distance is overkill at this scale; equirectangular is exact enough. */
export function distanceMetres(a: LngLat, b: LngLat): number {
  const dx = (a.lng - b.lng) * METRES_PER_DEG_LNG;
  const dy = (a.lat - b.lat) * METRES_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Compass bearing in degrees, 0 = north, clockwise. */
export function bearingDegrees(from: LngLat, to: LngLat): number {
  const dx = (to.lng - from.lng) * METRES_PER_DEG_LNG;
  const dy = (to.lat - from.lat) * METRES_PER_DEG_LAT;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export function isWithinCampus(lat: number, lng: number, marginMetres = 0): boolean {
  const dLng = marginMetres / METRES_PER_DEG_LNG;
  const dLat = marginMetres / METRES_PER_DEG_LAT;
  return lat >= SOUTH - dLat && lat <= NORTH + dLat && lng >= WEST - dLng && lng <= EAST + dLng;
}

/** Project a GeoJSON ring / line into an SVG path `d` string. */
export function pathFromCoordinates(coords: readonly (readonly number[])[], close: boolean): string {
  let d = '';
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    if (!c || c.length < 2) continue;
    const p = project(c[1]!, c[0]!);
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return close ? `${d}Z` : d;
}
