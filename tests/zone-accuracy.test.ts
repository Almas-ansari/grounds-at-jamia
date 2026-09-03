/**
 * Every zone this map is willing to name should actually be where OSM says it
 * is. This is the regression guard for that: it checks each binding against a
 * committed snapshot of every named feature on campus (src/data/osm-names.json,
 * from Overpass), so a well-meaning edit to zones.ts cannot silently move the
 * library across the road.
 *
 * Zones OSM does not name at all are exempt, but only if they admit it by
 * carrying `approximate: true`.
 */
import { describe, expect, it } from 'vitest';
import osmNames from '../src/data/osm-names.json';
import { zones } from '../src/data/zones';
import { distanceMetres } from '../src/lib/projection';

interface OsmName {
  readonly name: string;
  readonly osmId: string;
  readonly lat: number;
  readonly lng: number;
}

/** What OSM calls each zone. Matched case-insensitively as a substring. */
const OSM_NAME_OF: Record<string, readonly string[]> = {
  'zakir-husain-library': ['Zakir Hussain Library'],
  engineering: ['FET AUDITORIUM'],
  humanities: ['Department Of English'],
  'social-sciences': ['Department of Economics'],
  architecture: ['Faculty of Architecture'],
  'ansari-auditorium': ['MA Ansari Auditorium'],
  'sports-complex': ['JMI University Sports Complex'],
  'bhopal-ground': ['polytechnic ground'],
  'central-canteen': ['Dastarkhan Canteen'],
  'university-masjid': ['Jamia Masjid'],
  'boys-hostels': ['New Boys Hostel'],
  'reading-hall': ['Reading Hall'],
  'fet-library': ['FET LIBRARY'],
  'jamia-college': ['Jamia College'],
  'gulistan-e-ghalib': ['Gulistan-e-Ghalib'],
  'mughal-garden': ['Mughal garden'],
  'basketball-court': ['JMI University Basketball Court'],
  'school-ground': ['Jamia Milia Islamia School ground'],
  'teachers-quarters': ['Teachers quarters'],
  'engineering-canteen': ['Engineering Canteen'],
};

/**
 * Places OSM simply does not name. Not a failure — a fact about the survey —
 * but each one has to own up to it in `zones.ts`.
 */
const UNNAMED_IN_OSM = [
  'natural-sciences',
  'mcrc',
  'dayar-e-mir-taqi-mir',
  'mf-husain-gallery',
  'polyclinic',
  'girls-hostels',
  'law',
  'gate-7',
  'gate-13',
  'gate-20',
];

/** A faculty occupies a block, so its centroid need not sit on the named node. */
const TOLERANCE_M = 60;

const names = osmNames as readonly OsmName[];

describe('zone placement against OSM', () => {
  it('has a committed snapshot of the campus names', () => {
    expect(names.length).toBeGreaterThan(50);
  });

  it('accounts for every zone, either by an OSM name or by admitting it is a guess', () => {
    for (const zone of zones) {
      const known = zone.id in OSM_NAME_OF || UNNAMED_IN_OSM.includes(zone.id);
      expect(known, `zone "${zone.id}" is neither bound to an OSM name nor listed as unnamed`).toBe(true);
    }
  });

  it('places every OSM-verifiable zone within tolerance of what OSM calls it', () => {
    for (const [zoneId, needles] of Object.entries(OSM_NAME_OF)) {
      const zone = zones.find((z) => z.id === zoneId);
      expect(zone, `zone "${zoneId}" has gone missing`).toBeDefined();

      const matches = names.filter((n) =>
        needles.some((needle) => n.name.toLowerCase().includes(needle.toLowerCase())),
      );
      expect(matches.length, `OSM no longer names anything matching "${needles.join('/')}"`).toBeGreaterThan(0);

      const nearest = Math.min(...matches.map((m) => distanceMetres(zone!.centroid, m)));
      expect(
        nearest,
        `zone "${zoneId}" sits ${Math.round(nearest)} m from OSM's "${matches[0]!.name}"`,
      ).toBeLessThanOrEqual(TOLERANCE_M);
    }
  });

  it('marks every unverifiable zone as approximate', () => {
    for (const id of UNNAMED_IN_OSM) {
      const zone = zones.find((z) => z.id === id);
      expect(zone, `zone "${id}" has gone missing`).toBeDefined();
      expect(zone!.approximate, `zone "${id}" claims to be surveyed, but OSM does not name it`).toBe(true);
    }
  });
});
