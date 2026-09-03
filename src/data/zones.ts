/**
 * Named campus zones — the places the map is willing to speak about.
 *
 * Hand-curated. Where OSM has a footprint for a place, the zone borrows that
 * polygon by its OSM id so the shape on the parchment is the real building.
 * Where OSM has nothing (JMI is only partly surveyed), the polygon is drawn
 * here by hand from the surrounding geometry and flagged `approximate` so it
 * can be corrected later without touching any other code.
 *
 * Positions were checked against the Overpass extract in campus.geojson:
 * see the `anchor` note on each zone for what pinned it.
 */
import { campus, type Position } from './campus';
import { METRES_PER_DEG_LAT, METRES_PER_DEG_LNG, type LngLat } from '../lib/projection';

export type ZoneKind =
  | 'faculty'
  | 'library'
  | 'hall'
  | 'gallery'
  | 'ground'
  | 'refectory'
  | 'masjid'
  | 'infirmary'
  | 'residence'
  | 'gate';

export interface Zone {
  readonly id: string;
  /** The label the map itself uses. */
  readonly name: string;
  readonly kind: ZoneKind;
  /** 3 = faculty or library (densest ink), 2 = notable, 1 = incidental. */
  readonly importance: 1 | 2 | 3;
  /** True when the outline here is drawn by hand rather than taken from OSM. */
  readonly approximate: boolean;
  readonly polygon: readonly Position[];
  readonly centroid: LngLat;
}

interface ZoneSeed {
  id: string;
  name: string;
  kind: ZoneKind;
  importance: 1 | 2 | 3;
  /** OSM way id whose footprint this zone borrows. */
  osmId?: string;
  /** Hand-drawn fallback: centre plus an oriented box in metres. */
  box?: { lat: number; lng: number; w: number; h: number; rotate?: number };
  /** Set when the OSM polygon is a near neighbour rather than a named match. */
  approximate: boolean;
  /** What in the OSM extract pinned this location. */
  anchor: string;
}

/** A hand-drawn rectangle, in the campus grid's own orientation. */
function box(lat: number, lng: number, w: number, h: number, rotate = 0): Position[] {
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: readonly [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const ring = corners.map(([dx, dy]): Position => {
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return [lng + rx / METRES_PER_DEG_LNG, lat + ry / METRES_PER_DEG_LAT];
  });
  return [...ring, ring[0]!];
}

const polygonByOsmId = new Map<string, readonly Position[]>();
for (const f of campus.features) {
  if (f.geometry.type === 'Polygon' && f.geometry.coordinates[0]) {
    polygonByOsmId.set(f.properties.osmId, f.geometry.coordinates[0]);
  }
}

/** Area-weighted centroid of a closed ring, in lng/lat. */
export function ringCentroid(ring: readonly Position[]): LngLat {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
    }
    return { lng: sx / ring.length, lat: sy / ring.length };
  }
  return { lng: cx / (3 * twiceArea), lat: cy / (3 * twiceArea) };
}

const SEEDS: readonly ZoneSeed[] = [
  {
    id: 'zakir-husain-library',
    name: 'Dr. Zakir Husain Library',
    kind: 'library',
    importance: 3,
    box: { lat: 28.56259, lng: 77.28151, w: 62, h: 44, rotate: -6 },
    approximate: true,
    anchor:
      'node/11235310919 "Zakir Hussain Library (JMI)". The block this used to borrow, way/1218203272, ' +
      'turns out to hold node/11269141397 "Reading Hall, JMI" — it is now its own zone.',
  },
  {
    id: 'engineering',
    name: 'Faculty of Engineering and Technology',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/252331694',
    approximate: true,
    anchor: 'contains node/2583932285 "FET AUDITORIUM"; block south of Jauhar Marg',
  },
  {
    id: 'natural-sciences',
    name: 'Faculty of Natural Sciences',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/351388585',
    approximate: true,
    anchor: 'unnamed 1150 m\u00b2 block in the north-west academic row; the hand-drawn box it replaced fell on open ground in satellite imagery',
  },
  {
    id: 'humanities',
    name: 'Faculty of Humanities and Languages',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/1218204906',
    approximate: false,
    anchor: 'way/1218204906 "Department Of English"',
  },
  {
    id: 'social-sciences',
    name: 'Faculty of Social Sciences',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/351388619',
    approximate: false,
    anchor: 'way/351388619 "Department of Economics"',
  },
  {
    id: 'law',
    name: 'Faculty of Law',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/1218697519',
    approximate: true,
    anchor: 'unnamed 872 m² block beside way/1218697520 "Department of Geography"',
  },
  {
    id: 'architecture',
    name: 'Faculty of Architecture and Ekistics',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/1463684036',
    approximate: false,
    anchor: 'way/1463684036 "Faculty of Architecture & Ekistics, JMI"',
  },
  {
    id: 'mcrc',
    name: 'AJK Mass Communication Research Centre',
    kind: 'faculty',
    importance: 3,
    osmId: 'way/351388758',
    approximate: true,
    anchor: 'unnamed 920 m² block on the eastern academic edge',
  },
  {
    id: 'ansari-auditorium',
    name: 'Ansari Auditorium',
    kind: 'hall',
    importance: 2,
    osmId: 'way/1218204907',
    approximate: false,
    anchor: 'contains node/11269141400 "MA Ansari Auditorium, JMI"',
  },
  {
    id: 'dayar-e-mir-taqi-mir',
    name: 'Dayar-e-Mir Taqi Mir',
    kind: 'hall',
    importance: 2,
    box: { lat: 28.56432, lng: 77.28268, w: 92, h: 58, rotate: 4 },
    approximate: true,
    anchor: 'north-eastern quarter, beyond the residence blocks',
  },
  {
    id: 'mf-husain-gallery',
    name: 'M.F. Husain Art Gallery',
    kind: 'gallery',
    importance: 2,
    osmId: 'way/351388780',
    approximate: true,
    anchor: 'unnamed 373 m² pavilion east of the library court',
  },
  {
    id: 'sports-complex',
    name: 'Jamia Sports Complex',
    kind: 'ground',
    importance: 2,
    osmId: 'way/252333089',
    approximate: false,
    anchor: 'way/252333089 "JMI University Sports Complex"',
  },
  {
    id: 'bhopal-ground',
    name: 'Bhopal Ground',
    kind: 'ground',
    importance: 1,
    box: { lat: 28.56304, lng: 77.28095, w: 118, h: 86, rotate: -4 },
    approximate: true,
    anchor:
      'node/11235290610 "polytechnic ground" — the open ground in the middle of the estate. ' +
      'It previously borrowed a pitch inside way/252333089, which stacked two zones on one field.',
  },
  {
    id: 'central-canteen',
    name: 'Central Canteen',
    kind: 'refectory',
    importance: 2,
    osmId: 'way/351388760',
    approximate: true,
    anchor: 'node/11269141398 "Dastarkhan Canteen" 31 m away',
  },
  {
    id: 'university-masjid',
    name: 'University Masjid',
    kind: 'masjid',
    importance: 2,
    box: { lat: 28.56253, lng: 77.28273, w: 46, h: 34, rotate: -6 },
    approximate: true,
    anchor: 'node/367276753 "Jamia Masjid"; no footprint surveyed',
  },
  {
    id: 'polyclinic',
    name: 'University Polyclinic',
    kind: 'infirmary',
    importance: 2,
    osmId: 'way/352801231',
    approximate: true,
    anchor: 'unnamed block on the eastern service lane',
  },
  {
    id: 'boys-hostels',
    name: 'Boys Hostels',
    kind: 'residence',
    importance: 2,
    box: { lat: 28.56562, lng: 77.28120, w: 156, h: 118, rotate: 0 },
    approximate: true,
    anchor:
      'node/11262433605 "New Boys Hostel, JMI". Pulled north and tightened: the earlier box reached ' +
      'far enough south to swallow way/252335533 "JMI, Teachers quarters, C Block".',
  },
  {
    id: 'girls-hostels',
    name: 'Girls Hostels',
    kind: 'residence',
    importance: 2,
    box: { lat: 28.55988, lng: 77.28438, w: 132, h: 96, rotate: 10 },
    approximate: true,
    anchor: 'south-eastern residence quarter; no footprints surveyed',
  },
  {
    id: 'reading-hall',
    name: 'Reading Hall',
    kind: 'library',
    importance: 2,
    osmId: 'way/1218203272',
    approximate: false,
    anchor: 'contains node/11269141397 "Reading Hall, JMI"',
  },
  {
    id: 'fet-library',
    name: 'FET Library',
    kind: 'library',
    importance: 2,
    osmId: 'way/252332070',
    approximate: false,
    anchor: 'way/252332070 "JMI , FET LIBRARY"',
  },
  {
    id: 'jamia-college',
    name: 'Jamia College',
    kind: 'faculty',
    importance: 2,
    box: { lat: 28.56094, lng: 77.28008, w: 58, h: 42 },
    approximate: true,
    anchor: 'node/6475194135 "Jamia College"; OSM has no footprint',
  },
  {
    id: 'gulistan-e-ghalib',
    name: 'Gulistan-e-Ghalib',
    kind: 'ground',
    importance: 2,
    osmId: 'way/634162024',
    approximate: false,
    anchor: 'way/634162024 "Gulistan-e-Ghalib"',
  },
  {
    id: 'mughal-garden',
    name: 'Mughal Garden',
    kind: 'ground',
    importance: 1,
    box: { lat: 28.56247, lng: 77.28432, w: 74, h: 52, rotate: 6 },
    approximate: true,
    anchor: 'node/11274654304 "Mughal garden"; OSM has no footprint',
  },
  {
    id: 'basketball-court',
    name: 'Basketball Court',
    kind: 'ground',
    importance: 1,
    osmId: 'way/690251639',
    approximate: false,
    anchor: 'way/690251639 "JMI University Basketball Court"',
  },
  {
    id: 'school-ground',
    name: 'Jamia School Ground',
    kind: 'ground',
    importance: 1,
    box: { lat: 28.56381, lng: 77.28354, w: 128, h: 94, rotate: -3 },
    approximate: true,
    anchor: 'node/11274654303 "Jamia Milia Islamia School ground"; OSM has no footprint',
  },
  {
    id: 'teachers-quarters',
    name: 'Teachers’ Quarters, C Block',
    kind: 'residence',
    importance: 1,
    osmId: 'way/252335533',
    approximate: false,
    anchor: 'way/252335533 "JMI, Teachers quarters, C Block"',
  },
  {
    id: 'engineering-canteen',
    name: 'Engineering Canteen',
    kind: 'refectory',
    importance: 1,
    box: { lat: 28.55978, lng: 77.27827, w: 34, h: 26 },
    approximate: true,
    anchor: 'node/11235332747 "Engineering Canteen"; OSM has no footprint',
  },
  {
    id: 'gate-7',
    name: 'Gate No. 7',
    kind: 'gate',
    importance: 1,
    box: { lat: 28.56118, lng: 77.28072, w: 26, h: 20 },
    approximate: true,
    anchor: 'southern campus edge on Maulana Mohamed Ali Jauhar Marg (way/176159963)',
  },
  {
    id: 'gate-13',
    name: 'Gate No. 13',
    kind: 'gate',
    importance: 1,
    box: { lat: 28.55972, lng: 77.28002, w: 26, h: 20 },
    approximate: true,
    anchor: 'engineering block approach, north of the Architecture faculty',
  },
  {
    id: 'gate-20',
    name: 'Gate No. 20',
    kind: 'gate',
    importance: 1,
    box: { lat: 28.56439, lng: 77.28110, w: 26, h: 20 },
    approximate: true,
    anchor: 'northern campus approach road; the earlier position sat inside the Batla House housing north of the estate',
  },
] as const;

export const zones: readonly Zone[] = SEEDS.map((seed): Zone => {
  const fromOsm = seed.osmId ? polygonByOsmId.get(seed.osmId) : undefined;
  const polygon =
    fromOsm ??
    (seed.box ? box(seed.box.lat, seed.box.lng, seed.box.w, seed.box.h, seed.box.rotate) : []);
  if (polygon.length < 4) {
    throw new Error(`Zone "${seed.id}" has no usable polygon (osmId ${seed.osmId ?? 'none'}).`);
  }
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    importance: seed.importance,
    // An OSM id that no longer resolves falls back to the hand-drawn box, and
    // is approximate whatever the seed claimed.
    approximate: seed.approximate || !fromOsm,
    polygon,
    centroid: ringCentroid(polygon),
  };
});

export const zoneById = new Map(zones.map((z) => [z.id, z]));

/** Presence rows use this when the subject has left the campus bounding box. */
export const OFF_CAMPUS_ZONE_ID = 'off-campus';

export function zoneName(zoneId: string | null | undefined): string | null {
  if (!zoneId) return null;
  if (zoneId === OFF_CAMPUS_ZONE_ID) return 'Beyond the grounds';
  return zoneById.get(zoneId)?.name ?? null;
}
