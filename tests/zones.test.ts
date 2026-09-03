import { describe, expect, it } from 'vitest';
import {
  ZONE_SNAP_M,
  distanceToPolygonMetres,
  jitteredZonePoint,
  pointInRing,
  resolveZone,
} from '../src/lib/geo';
import { zoneById, zones } from '../src/data/zones';
import { PUBLIC_JITTER_M } from '../src/lib/geo';
import { METRES_PER_DEG_LAT, METRES_PER_DEG_LNG, distanceMetres } from '../src/lib/projection';

describe('zone data', () => {
  it('includes every seeded zone, each with a closed polygon', () => {
    const expected = [
      'zakir-husain-library',
      'engineering',
      'natural-sciences',
      'humanities',
      'social-sciences',
      'law',
      'architecture',
      'mcrc',
      'ansari-auditorium',
      'dayar-e-mir-taqi-mir',
      'mf-husain-gallery',
      'sports-complex',
      'bhopal-ground',
      'central-canteen',
      'university-masjid',
      'polyclinic',
      'boys-hostels',
      'girls-hostels',
      'gate-7',
      'gate-13',
      'gate-20',
      // Added once the full OSM name list showed these were surveyed and named.
      'reading-hall',
      'fet-library',
      'jamia-college',
      'gulistan-e-ghalib',
      'mughal-garden',
      'basketball-court',
      'school-ground',
      'teachers-quarters',
      'engineering-canteen',
    ];
    for (const id of expected) expect(zoneById.has(id)).toBe(true);
    expect(zones).toHaveLength(expected.length);

    for (const zone of zones) {
      expect(zone.polygon.length).toBeGreaterThanOrEqual(4);
      const first = zone.polygon[0]!;
      const last = zone.polygon[zone.polygon.length - 1]!;
      expect(first[0]).toBeCloseTo(last[0], 9);
      expect(first[1]).toBeCloseTo(last[1], 9);
    }
  });

  it('places every centroid inside the campus bounding box', () => {
    for (const zone of zones) {
      expect(zone.centroid.lat).toBeGreaterThan(28.55);
      expect(zone.centroid.lat).toBeLessThan(28.57);
      expect(zone.centroid.lng).toBeGreaterThan(77.27);
      expect(zone.centroid.lng).toBeLessThan(77.29);
    }
  });
});

describe('point in polygon', () => {
  const square: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];

  it('recognises inside, outside and the far side of an edge', () => {
    expect(pointInRing({ lng: 1, lat: 1 }, square)).toBe(true);
    expect(pointInRing({ lng: 3, lat: 1 }, square)).toBe(false);
    expect(pointInRing({ lng: -1, lat: 1 }, square)).toBe(false);
    expect(pointInRing({ lng: 1, lat: 3 }, square)).toBe(false);
  });

  it('measures distance to a polygon, and zero inside it', () => {
    const zone = zoneById.get('architecture')!;
    expect(distanceToPolygonMetres(zone.centroid, zone.polygon)).toBe(0);
    const far = { lat: zone.centroid.lat + 0.01, lng: zone.centroid.lng };
    expect(distanceToPolygonMetres(far, zone.polygon)).toBeGreaterThan(900);
  });
});

describe('resolveZone', () => {
  it('resolves a point inside a zone to that zone', () => {
    // Not sports-complex: Bhopal Ground nests inside it, and the smaller
    // polygon is meant to win. That case is asserted separately below.
    for (const id of ['architecture', 'humanities', 'social-sciences', 'central-canteen']) {
      const zone = zoneById.get(id)!;
      expect(resolveZone(zone.centroid)?.id).toBe(id);
    }
  });

  it('prefers the smallest containing zone when polygons nest', () => {
    // Bhopal Ground sits inside the much larger sports enclosure.
    const inner = zoneById.get('bhopal-ground')!;
    expect(resolveZone(inner.centroid)?.id).toBe('bhopal-ground');
  });

  it('snaps to a nearby zone when standing just outside one', () => {
    const zone = zoneById.get('humanities')!;
    // 25 m north of the centroid — outside the small footprint, within the snap.
    const near = { lat: zone.centroid.lat + 25 / METRES_PER_DEG_LAT, lng: zone.centroid.lng };
    const resolved = resolveZone(near);
    expect(resolved).not.toBeNull();
    expect(distanceToPolygonMetres(near, resolved!.polygon)).toBeLessThanOrEqual(ZONE_SNAP_M);
  });

  it('reports nothing when the nearest zone is out of reach', () => {
    // The middle of the Yamuna, well east of every zone.
    expect(resolveZone({ lat: 28.5646, lng: 77.3400 })).toBeNull();
  });
});

describe('public-mode jitter', () => {
  it('stays inside the advertised radius and is stable per user', () => {
    const zone = zoneById.get('central-canteen')!;
    const a = jitteredZonePoint(zone, 'user-a');
    const b = jitteredZonePoint(zone, 'user-b');
    expect(jitteredZonePoint(zone, 'user-a')).toEqual(a);
    expect(a).not.toEqual(b);
    for (const point of [a, b]) {
      expect(distanceMetres(point, zone.centroid)).toBeLessThanOrEqual(PUBLIC_JITTER_M + 0.001);
    }
  });

  it('never returns the exact centroid for a typical uuid', () => {
    const zone = zoneById.get('engineering')!;
    const point = jitteredZonePoint(zone, '11111111-1111-1111-1111-111111111111');
    expect(Math.abs(point.lng - zone.centroid.lng) * METRES_PER_DEG_LNG).toBeGreaterThan(0);
  });
});
