/**
 * The extent of the university's own land.
 *
 * The map shows Jamia and nothing else: everything outside these outlines is
 * masked off, so the surrounding streets of Okhla and Batla House — which the
 * basemap naturally contains — never appear.
 *
 * Two parts, because the campus is in two pieces:
 *
 *   core   the academic core north of Maulana Mohamed Ali Jauhar Marg. Traced
 *          along the outer extent of OSM way/278041499, the surveyed
 *          amenity=university polygon. That polygon is not used verbatim
 *          because it excludes a residential enclave in the middle of the
 *          campus with a deep concave spur, which as a mask reads as a great
 *          wedge cut out of the grounds. Swallowing the enclave is the lesser
 *          inaccuracy.
 *   south  the block below that road — Engineering, Architecture, the Ansari
 *          Auditorium and the southern residences. OSM has no polygon for it,
 *          so this outline is traced by hand from satellite imagery and is
 *          deliberately a little generous: cutting off real campus is worse
 *          than including a few metres of verge.
 */
import { campusCore, type Position } from './campus';
import { METRES_PER_DEG_LAT, METRES_PER_DEG_LNG, type LngLat } from '../lib/projection';

/** Hand-traced southern block, clockwise from its north-west corner. */
const SOUTHERN_BLOCK: Position[] = [
  // The north edge runs a little past the core block's southern boundary, so
  // the two pieces meet across Maulana Mohamed Ali Jauhar Marg instead of
  // leaving the road that serves the campus masked off. The mask paints rather
  // than winds, so the overlap costs nothing.
  [77.27740, 28.56126],
  [77.28660, 28.56120],
  [77.28672, 28.56020],
  [77.28606, 28.55938],
  [77.28472, 28.55880],
  [77.28268, 28.55852],
  [77.28032, 28.55860],
  [77.27858, 28.55892],
  [77.27758, 28.55960],
  [77.27728, 28.56034],
  [77.27740, 28.56126],
];

/** The academic core, traced clockwise from its south-west corner. */
const CORE_BLOCK: Position[] = [
  [77.27795, 28.56110],
  [77.28330, 28.56110],
  [77.28492, 28.56200],
  [77.28604, 28.56312],
  [77.28592, 28.56448],
  [77.28416, 28.56534],
  [77.28272, 28.56588],
  [77.28078, 28.56668],
  [77.28026, 28.56662],
  [77.27898, 28.56568],
  [77.27795, 28.56528],
  [77.27795, 28.56110],
];

/**
 * A sanity check rather than a data source: if a refetch ever moved the campus,
 * the traced outline should still sit on top of the surveyed one.
 */
function coreRing(): Position[] {
  if (campusCore?.geometry.type === 'Polygon') {
    const surveyed = campusCore.geometry.coordinates[0];
    if (surveyed && surveyed.length > 3) {
      const centre = surveyed.reduce(
        (acc, p) => ({ lng: acc.lng + p[0] / surveyed.length, lat: acc.lat + p[1] / surveyed.length }),
        { lng: 0, lat: 0 },
      );
      if (!inRing(centre, CORE_BLOCK) && typeof console !== 'undefined') {
        console.warn('estate: the traced core outline no longer covers OSM way/278041499.');
      }
    }
  }
  return CORE_BLOCK;
}


/**
 * The two blocks, unioned and dilated by 55 m, as a single ring.
 *
 * Precomputed rather than assembled at runtime: the mask used to be an SVG
 * <mask> containing eight wide-stroked paths, which forces an offscreen buffer
 * the size of the map and re-rasterises it on every zoom step. One flat ring
 * lets the cover be a single even-odd path instead — no mask, no strokes, no
 * filters, nothing for the compositor to recompute while the map is moving.
 *
 * Regenerate with the marching-squares pass in scripts/ if the blocks change.
 */
export const ESTATE_OUTLINE: readonly Position[] = [
  [77.28067, 28.56717],
  [77.27997, 28.56705],
  [77.27868, 28.56611],
  [77.27768, 28.56571],
  [77.27743, 28.56547],
  [77.27739, 28.56176],
  [77.27708, 28.56167],
  [77.27689, 28.56146],
  [77.27672, 28.56037],
  [77.27710, 28.55934],
  [77.27836, 28.55846],
  [77.28030, 28.55810],
  [77.28271, 28.55802],
  [77.28481, 28.55831],
  [77.28636, 28.55896],
  [77.28726, 28.56006],
  [77.28714, 28.56134],
  [77.28699, 28.56156],
  [77.28673, 28.56168],
  [77.28538, 28.56171],
  [77.28658, 28.56298],
  [77.28640, 28.56474],
  [77.28620, 28.56491],
  [77.28440, 28.56579],
  [77.28100, 28.56714],
  [77.28067, 28.56717],
];

/** The blocks themselves, still the authority for `isOnEstate`. */
export const ESTATE_PARTS: readonly Position[][] = [coreRing(), SOUTHERN_BLOCK];

function inRing(point: LngLat, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > point.lat !== b[1] > point.lat) {
      if (point.lng < ((b[0] - a[0]) * (point.lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

/** True when a point is on university land — used to decide what to draw. */
export function isOnEstate(point: LngLat, marginMetres = 0): boolean {
  if (ESTATE_PARTS.some((ring) => inRing(point, ring))) return true;
  if (marginMetres <= 0) return false;
  const dLng = marginMetres / METRES_PER_DEG_LNG;
  const dLat = marginMetres / METRES_PER_DEG_LAT;
  // A cheap dilation: test the four cardinal offsets rather than buffering the
  // polygon properly, which is plenty for a tolerance of a few tens of metres.
  return (
    ESTATE_PARTS.some((ring) => inRing({ lat: point.lat + dLat, lng: point.lng }, ring)) ||
    ESTATE_PARTS.some((ring) => inRing({ lat: point.lat - dLat, lng: point.lng }, ring)) ||
    ESTATE_PARTS.some((ring) => inRing({ lat: point.lat, lng: point.lng + dLng }, ring)) ||
    ESTATE_PARTS.some((ring) => inRing({ lat: point.lat, lng: point.lng - dLng }, ring))
  );
}

/** Bounding box of the estate, for framing and for clamping the pan. */
export const ESTATE_BOUNDS = (() => {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const ring of ESTATE_PARTS) {
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, south, east, north };
})();

export const ESTATE_CENTRE: LngLat = {
  lng: (ESTATE_BOUNDS.west + ESTATE_BOUNDS.east) / 2,
  lat: (ESTATE_BOUNDS.south + ESTATE_BOUNDS.north) / 2,
};
