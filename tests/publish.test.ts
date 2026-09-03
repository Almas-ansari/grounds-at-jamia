import { describe, expect, it } from 'vitest';
import {
  ACCURACY_LIMIT_M,
  PUBLISH_DISTANCE_M,
  PUBLISH_HEARTBEAT_MS,
  shouldPublish,
  smoothFix,
  type Fix,
  type PublishState,
} from '../src/lib/geo';
import { METRES_PER_DEG_LAT, distanceMetres } from '../src/lib/projection';

const BASE = { lat: 28.5625, lng: 77.2815 };
const north = (metres: number): { lat: number; lng: number } => ({
  lat: BASE.lat + metres / METRES_PER_DEG_LAT,
  lng: BASE.lng,
});

const state = (point: { lat: number; lng: number }, zoneId: string | null, at: number): PublishState => ({
  point,
  zoneId,
  at,
});

describe('publish throttling', () => {
  it('always publishes the first fix', () => {
    expect(shouldPublish(null, state(BASE, 'library', 0))).toEqual({ publish: true, reason: 'first' });
  });

  it('stays quiet while nothing meaningful has changed', () => {
    const last = state(BASE, 'library', 0);
    const barelyMoved = state(north(PUBLISH_DISTANCE_M - 2), 'library', 5_000);
    expect(shouldPublish(last, barelyMoved).publish).toBe(false);
  });

  it('publishes once the subject has actually gone somewhere', () => {
    const last = state(BASE, 'library', 0);
    const moved = state(north(PUBLISH_DISTANCE_M + 2), 'library', 5_000);
    expect(shouldPublish(last, moved)).toEqual({ publish: true, reason: 'moved' });
  });

  it('publishes the moment the zone changes, however small the step', () => {
    const last = state(BASE, 'library', 0);
    const sameSpotNewZone = state(north(0.4), 'central-canteen', 900);
    expect(shouldPublish(last, sameSpotNewZone)).toEqual({ publish: true, reason: 'zone-changed' });
  });

  it('publishes a heartbeat so the TTL cannot expire a stationary user', () => {
    const last = state(BASE, 'library', 0);
    const stillThere = state(BASE, 'library', PUBLISH_HEARTBEAT_MS);
    expect(shouldPublish(last, stillThere)).toEqual({ publish: true, reason: 'heartbeat' });

    const notYet = state(BASE, 'library', PUBLISH_HEARTBEAT_MS - 1);
    expect(shouldPublish(last, notYet).publish).toBe(false);
  });

  it('heartbeats well inside the 90 second server TTL', () => {
    expect(PUBLISH_HEARTBEAT_MS).toBeLessThan(90_000 / 1.5);
  });

  it('honours overridden thresholds', () => {
    const last = state(BASE, 'library', 0);
    const moved = state(north(4), 'library', 1_000);
    expect(shouldPublish(last, moved, { distanceM: 2 }).reason).toBe('moved');
    expect(shouldPublish(last, moved, { distanceM: 20 }).publish).toBe(false);
  });
});

describe('smoothing', () => {
  const fix = (point: { lat: number; lng: number }, accuracy = 10, t = 0): Fix => ({
    ...point,
    accuracy,
    bearing: null,
    timestamp: t,
  });

  it('adopts the first fix outright', () => {
    const first = fix(BASE);
    expect(smoothFix(null, first)).toBe(first);
  });

  it('damps a small jitter rather than following it', () => {
    const previous = fix(BASE);
    const jittered = fix(north(6), 10, 1_000);
    const smoothed = smoothFix(previous, jittered);
    const movedBy = distanceMetres(previous, smoothed);
    expect(movedBy).toBeGreaterThan(0);
    expect(movedBy).toBeLessThan(6);
    expect(movedBy).toBeCloseTo(6 * 0.35, 1);
  });

  it('adopts a genuine move outright rather than lagging behind it', () => {
    const previous = fix(BASE);
    const walked = fix(north(60), 10, 1_000);
    const smoothed = smoothFix(previous, walked);
    expect(distanceMetres(smoothed, walked)).toBeLessThan(0.001);
  });

  it('derives a bearing when the device does not report one', () => {
    const previous = fix(BASE);
    const moved = fix(north(5), 12, 1_000);
    expect(smoothFix(previous, moved).bearing).toBeCloseTo(0, 1);
  });

  it('agrees with the accuracy limit the watcher enforces', () => {
    expect(ACCURACY_LIMIT_M).toBe(60);
  });
});
