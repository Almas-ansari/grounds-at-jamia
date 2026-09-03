import { describe, expect, it } from 'vitest';
import {
  EAST,
  HEIGHT,
  METRES_PER_DEG_LAT,
  METRES_PER_DEG_LNG,
  METRES_PER_UNIT,
  NORTH,
  SOUTH,
  WEST,
  WIDTH,
  bearingDegrees,
  distanceMetres,
  isWithinCampus,
  project,
  unproject,
} from '../src/lib/projection';

describe('projection', () => {
  it('maps the bounding box corners onto the viewBox corners', () => {
    const nw = project(NORTH, WEST);
    const se = project(SOUTH, EAST);
    expect(nw.x).toBeCloseTo(0, 6);
    expect(nw.y).toBeCloseTo(0, 6);
    expect(se.x).toBeCloseTo(WIDTH, 6);
    expect(se.y).toBeCloseTo(HEIGHT, 6);
  });

  it('keeps the aspect ratio true so ground distance is isotropic', () => {
    // 200 m due east and 200 m due north from the campus centre must cover the
    // same number of SVG units, or every building comes out sheared.
    const lat = (NORTH + SOUTH) / 2;
    const lng = (EAST + WEST) / 2;
    const origin = project(lat, lng);
    const east = project(lat, lng + 200 / METRES_PER_DEG_LNG);
    const north = project(lat + 200 / METRES_PER_DEG_LAT, lng);
    const dxUnits = east.x - origin.x;
    const dyUnits = origin.y - north.y;
    expect(Math.abs(dxUnits - dyUnits) / dxUnits).toBeLessThan(0.01);
  });

  it('maps a known campus distance to the expected pixel span within 1 percent', () => {
    // Two real surveyed points from the OSM extract:
    //   node/2583932285 "FET AUDITORIUM"        28.5598005, 77.2796394
    //   node/11262433605 "New Boys Hostel, JMI" 28.5657900, 77.2812600
    const a = { lat: 28.5598005, lng: 77.2796394 };
    const b = { lat: 28.5657_9, lng: 77.28126 };

    const groundMetres = distanceMetres(a, b);
    expect(groundMetres).toBeGreaterThan(600);
    expect(groundMetres).toBeLessThan(700);

    const pa = project(a.lat, a.lng);
    const pb = project(b.lat, b.lng);
    const pixelSpan = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const expectedSpan = groundMetres / METRES_PER_UNIT;

    expect(Math.abs(pixelSpan - expectedSpan) / expectedSpan).toBeLessThan(0.01);
  });

  it('round-trips through unproject', () => {
    for (const [lat, lng] of [
      [28.5625, 77.2815],
      [28.5599, 77.2796],
      [SOUTH, WEST],
      [NORTH, EAST],
    ] as const) {
      const p = project(lat, lng);
      const back = unproject(p.x, p.y);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });

  it('reports bearings as compass degrees', () => {
    const c = { lat: 28.562, lng: 77.282 };
    expect(bearingDegrees(c, { lat: c.lat + 0.001, lng: c.lng })).toBeCloseTo(0, 5);
    expect(bearingDegrees(c, { lat: c.lat, lng: c.lng + 0.001 })).toBeCloseTo(90, 5);
    expect(bearingDegrees(c, { lat: c.lat - 0.001, lng: c.lng })).toBeCloseTo(180, 5);
  });

  it('knows the campus bounds', () => {
    expect(isWithinCampus(28.5625, 77.2815)).toBe(true);
    expect(isWithinCampus(28.5, 77.2)).toBe(false);
    expect(isWithinCampus(NORTH + 0.0002, WEST)).toBe(false);
    expect(isWithinCampus(NORTH + 0.0002, WEST, 60)).toBe(true);
  });
});
