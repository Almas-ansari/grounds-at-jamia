/**
 * Location intake: smoothing, zone resolution, and the decision of whether a
 * fix is worth publishing at all.
 *
 * Everything above `startWatching` is pure and unit-tested. The watcher itself
 * is the only part that touches browser APIs.
 */
import {
  OFF_CAMPUS_ZONE_ID,
  zones,
  type Zone,
} from '../data/zones';
import {
  METRES_PER_DEG_LAT,
  METRES_PER_DEG_LNG,
  bearingDegrees,
  distanceMetres,
  isWithinCampus,
  type LngLat,
} from './projection';

/** Fixes worse than this are noise, not location. */
export const ACCURACY_LIMIT_M = 60;
/** Exponential smoothing weight for each new fix. Lower = calmer dot. */
export const SMOOTHING_ALPHA = 0.35;
/** Movement that counts as having gone somewhere. */
export const PUBLISH_DISTANCE_M = 8;
/** Heartbeat, so a 90 s TTL never expires someone sitting still in the library. */
export const PUBLISH_HEARTBEAT_MS = 45_000;
/** Snap to a zone you are merely standing outside of. */
export const ZONE_SNAP_M = 40;
/** Public mode shows a building, not a person: scatter within the footprint. */
export const PUBLIC_JITTER_M = 18;

export interface Fix extends LngLat {
  readonly accuracy: number;
  readonly bearing: number | null;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Zone resolution
// ---------------------------------------------------------------------------

/** Ray casting on a closed ring in lng/lat. */
export function pointInRing(point: LngLat, ring: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const [ax, ay] = [a[0]!, a[1]!];
    const [bx, by] = [b[0]!, b[1]!];
    const straddles = ay > point.lat !== by > point.lat;
    if (straddles && point.lng < ((bx - ax) * (point.lat - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to a polygon edge, in metres. 0 if inside. */
export function distanceToPolygonMetres(point: LngLat, ring: readonly (readonly number[])[]): number {
  if (pointInRing(point, ring)) return 0;
  const px = point.lng * METRES_PER_DEG_LNG;
  const py = point.lat * METRES_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const ax = a[0]! * METRES_PER_DEG_LNG;
    const ay = a[1]! * METRES_PER_DEG_LAT;
    const bx = b[0]! * METRES_PER_DEG_LNG;
    const by = b[1]! * METRES_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * The zone a point belongs to: whichever polygon contains it (smallest wins,
 * so a room inside a quad beats the quad), otherwise the nearest zone within
 * ZONE_SNAP_M, otherwise nothing.
 */
export function resolveZone(point: LngLat, candidates: readonly Zone[] = zones): Zone | null {
  let containing: Zone | null = null;
  let containingSize = Infinity;
  let nearest: Zone | null = null;
  let nearestDistance = Infinity;

  for (const zone of candidates) {
    const d = distanceToPolygonMetres(point, zone.polygon);
    if (d === 0) {
      const size = ringSpanMetres(zone.polygon);
      if (size < containingSize) {
        containingSize = size;
        containing = zone;
      }
    } else if (d < nearestDistance) {
      nearestDistance = d;
      nearest = zone;
    }
  }

  if (containing) return containing;
  if (nearest && nearestDistance <= ZONE_SNAP_M) return nearest;
  return null;
}

function ringSpanMetres(ring: readonly (readonly number[])[]): number {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const p of ring) {
    const [lng, lat] = [p[0]!, p[1]!];
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return Math.hypot((e - w) * METRES_PER_DEG_LNG, (n - s) * METRES_PER_DEG_LAT);
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Exponential smoothing, so a stationary phone stops twitching. A fix that
 * jumps further than its own accuracy circle is treated as a genuine move and
 * adopted outright, otherwise a real walk would lag behind by seconds.
 */
export function smoothFix(previous: Fix | null, next: Fix, alpha = SMOOTHING_ALPHA): Fix {
  if (!previous) return next;
  const jump = distanceMetres(previous, next);
  if (jump > Math.max(next.accuracy, 25)) return next;
  const lat = previous.lat + alpha * (next.lat - previous.lat);
  const lng = previous.lng + alpha * (next.lng - previous.lng);
  const smoothed: Fix = {
    lat,
    lng,
    accuracy: next.accuracy,
    bearing: next.bearing ?? (jump > 2 ? bearingDegrees(previous, next) : previous.bearing),
    timestamp: next.timestamp,
  };
  return smoothed;
}

// ---------------------------------------------------------------------------
// Publish throttling
// ---------------------------------------------------------------------------

export interface PublishState {
  readonly point: LngLat;
  readonly zoneId: string | null;
  readonly at: number;
}

export type PublishReason = 'first' | 'moved' | 'zone-changed' | 'heartbeat';

export interface PublishDecision {
  readonly publish: boolean;
  readonly reason: PublishReason | 'unchanged';
}

/**
 * Publish only when something meaningful changed. Anything else is chatter
 * that costs the user battery and buys nobody anything.
 */
export function shouldPublish(
  last: PublishState | null,
  candidate: PublishState,
  options: { distanceM?: number; heartbeatMs?: number } = {},
): PublishDecision {
  const distanceM = options.distanceM ?? PUBLISH_DISTANCE_M;
  const heartbeatMs = options.heartbeatMs ?? PUBLISH_HEARTBEAT_MS;

  if (!last) return { publish: true, reason: 'first' };
  if (last.zoneId !== candidate.zoneId) return { publish: true, reason: 'zone-changed' };
  if (distanceMetres(last.point, candidate.point) > distanceM) {
    return { publish: true, reason: 'moved' };
  }
  if (candidate.at - last.at >= heartbeatMs) return { publish: true, reason: 'heartbeat' };
  return { publish: false, reason: 'unchanged' };
}

// ---------------------------------------------------------------------------
// Public-mode display position
// ---------------------------------------------------------------------------

/**
 * Public mode never puts real coordinates anywhere a non-friend can read, so
 * the map draws a scatter around the zone centroid instead. Deterministic per
 * user so the print does not skitter about between renders, and computed in
 * the browser from data everyone is already entitled to see.
 */
export function jitteredZonePoint(zone: Zone, seed: string): LngLat {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  const radius = (((h >>> 8) >>> 0) % 1000) / 1000 * PUBLIC_JITTER_M;
  return {
    lat: zone.centroid.lat + (radius * Math.cos(angle)) / METRES_PER_DEG_LAT,
    lng: zone.centroid.lng + (radius * Math.sin(angle)) / METRES_PER_DEG_LNG,
  };
}

// ---------------------------------------------------------------------------
// The watcher
// ---------------------------------------------------------------------------

export type GeoErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface GeoError {
  readonly kind: GeoErrorKind;
  readonly message: string;
  /** Platform-specific steps back to a working state. */
  readonly recovery: readonly string[];
}

const IOS_STEPS = [
  'Settings → Privacy & Security → Location Services → Safari Websites → While Using the App.',
  'Back in Safari: tap “aA” in the address bar → Website Settings → Location → Allow.',
];
const ANDROID_STEPS = [
  'Chrome: tap the lock or ⓘ beside the address → Permissions → Location → Allow.',
  'If it is greyed out: Settings → Apps → Chrome → Permissions → Location → Allow only while using the app.',
];
const DESKTOP_STEPS = [
  'Click the lock or ⓘ beside the address bar → Location → Allow, then reload.',
];

/**
 * Which set of instructions is worth showing. Telling an Android user how to
 * change a setting in iOS Safari is noise, and a wall of noise is what people
 * skip past.
 */
function platformSteps(): readonly string[] {
  if (typeof navigator === 'undefined') return DESKTOP_STEPS;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return IOS_STEPS;
  if (/Android/i.test(ua)) return ANDROID_STEPS;
  return DESKTOP_STEPS;
}

export function describeGeoError(err: GeolocationPositionError | null): GeoError {
  if (!err) {
    return {
      kind: 'unsupported',
      message: 'This browser will not report a location at all.',
      recovery: ['Open the map in Safari or Chrome on a device with location services.'],
    };
  }
  switch (err.code) {
    case 1:
      return {
        kind: 'denied',
        message: 'Location permission was refused, so the map cannot place you.',
        recovery: [...platformSteps(), 'Reload this page once you have allowed it.'],
      };
    case 2:
      return {
        kind: 'unavailable',
        message: 'Your device could not get a fix. Indoors and underground are the usual culprits.',
        recovery: ['Step near a window or into the open and wait a few seconds.'],
      };
    default:
      return {
        kind: 'timeout',
        message: 'Your device took too long to answer.',
        recovery: ['Check that location services are switched on, then try again.'],
      };
  }
}

export interface WatchHandlers {
  onFix: (fix: Fix, zone: Zone | null, offCampus: boolean) => void;
  onError: (error: GeoError) => void;
}

export interface Watcher {
  stop: () => void;
}

export function startWatching(handlers: WatchHandlers): Watcher {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    handlers.onError(describeGeoError(null));
    return { stop: () => undefined };
  }

  let smoothed: Fix | null = null;

  const id = navigator.geolocation.watchPosition(
    (position) => {
      const { coords } = position;
      if (coords.accuracy > ACCURACY_LIMIT_M) return;

      const raw: Fix = {
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
        bearing: Number.isFinite(coords.heading) ? coords.heading : null,
        timestamp: position.timestamp,
      };
      smoothed = smoothFix(smoothed, raw);

      // Outside the campus box we stop reporting coordinates entirely — not
      // "round them off", not "publish at lower precision". Nothing leaves.
      const offCampus = !isWithinCampus(smoothed.lat, smoothed.lng, 60);
      handlers.onFix(smoothed, offCampus ? null : resolveZone(smoothed), offCampus);
    },
    (err) => handlers.onError(describeGeoError(err)),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );

  return { stop: () => navigator.geolocation.clearWatch(id) };
}

export { OFF_CAMPUS_ZONE_ID };
