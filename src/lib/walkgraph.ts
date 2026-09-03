/**
 * A walking network built from the surveyed roads and footpaths.
 *
 * Used by the demo wanderers and by `npm run seed:phantoms`, so invented
 * people walk the actual lanes of the campus instead of drifting across
 * buildings in straight lines. Takes its features as an argument so the same
 * code runs in the browser (Vite imports the GeoJSON) and in a node script
 * (which reads it off disk).
 */
import { METRES_PER_DEG_LAT, METRES_PER_DEG_LNG, type LngLat } from './projection';

export interface WalkFeature {
  readonly properties: { readonly layer: string };
  readonly geometry:
    | { readonly type: 'LineString'; readonly coordinates: readonly (readonly number[])[] }
    | { readonly type: string; readonly coordinates: unknown };
}

/** Vertices closer than this are the same junction. */
const SNAP_METRES = 9;

interface Node {
  readonly id: number;
  readonly lng: number;
  readonly lat: number;
  readonly edges: { to: number; cost: number }[];
}

export interface WalkGraph {
  readonly nodes: readonly Node[];
  nearest(point: LngLat): number | null;
  route(from: LngLat, to: LngLat): LngLat[];
}

const metres = (a: LngLat, b: LngLat): number =>
  Math.hypot((a.lng - b.lng) * METRES_PER_DEG_LNG, (a.lat - b.lat) * METRES_PER_DEG_LAT);

export function buildWalkGraph(
  features: readonly WalkFeature[],
  bounds: { west: number; south: number; east: number; north: number },
): WalkGraph {
  const nodes: Node[] = [];
  const index = new Map<string, number>();

  const cellLng = SNAP_METRES / METRES_PER_DEG_LNG;
  const cellLat = SNAP_METRES / METRES_PER_DEG_LAT;
  const keyOf = (lng: number, lat: number): string =>
    `${Math.round(lng / cellLng)}:${Math.round(lat / cellLat)}`;

  const nodeFor = (lng: number, lat: number): number => {
    const key = keyOf(lng, lat);
    const existing = index.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push({ id, lng, lat, edges: [] });
    index.set(key, id);
    return id;
  };

  const link = (a: number, b: number): void => {
    if (a === b) return;
    const na = nodes[a]!;
    const nb = nodes[b]!;
    const cost = metres(na, nb);
    if (!na.edges.some((e) => e.to === b)) na.edges.push({ to: b, cost });
    if (!nb.edges.some((e) => e.to === a)) nb.edges.push({ to: a, cost });
  };

  const inBounds = (lng: number, lat: number): boolean =>
    lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;

  for (const f of features) {
    const layer = f.properties.layer;
    if (layer !== 'road' && layer !== 'footway') continue;
    if (f.geometry.type !== 'LineString') continue;
    const coords = f.geometry.coordinates as readonly (readonly number[])[];
    let previous: number | null = null;
    for (const c of coords) {
      const lng = c[0];
      const lat = c[1];
      if (lng === undefined || lat === undefined || !inBounds(lng, lat)) {
        previous = null;
        continue;
      }
      const id = nodeFor(lng, lat);
      if (previous !== null) link(previous, id);
      previous = id;
    }
  }

  const nearest = (point: LngLat): number | null => {
    let best: number | null = null;
    let bestD = Infinity;
    for (const node of nodes) {
      const d = metres(point, node);
      if (d < bestD) {
        bestD = d;
        best = node.id;
      }
    }
    return best;
  };

  /** Dijkstra. The graph is a few thousand nodes; a heap would be overkill. */
  const shortestPath = (startId: number, goalId: number): number[] => {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const done = new Uint8Array(nodes.length);
    dist[startId] = 0;

    for (;;) {
      let current = -1;
      let bestD = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (!done[i] && dist[i]! < bestD) {
          bestD = dist[i]!;
          current = i;
        }
      }
      if (current === -1 || current === goalId) break;
      done[current] = 1;
      for (const edge of nodes[current]!.edges) {
        const next = dist[current]! + edge.cost;
        if (next < dist[edge.to]!) {
          dist[edge.to] = next;
          prev[edge.to] = current;
        }
      }
    }

    if (dist[goalId] === Infinity) return [];
    const path: number[] = [];
    for (let at = goalId; at !== -1; at = prev[at]!) path.push(at);
    return path.reverse();
  };

  return {
    nodes,
    nearest,
    route(from, to) {
      const a = nearest(from);
      const b = nearest(to);
      if (a === null || b === null) return [from, to];
      const ids = shortestPath(a, b);
      // No connected route (the network is not fully joined everywhere in OSM):
      // walk the straight line rather than refusing to move.
      if (ids.length === 0) return [from, to];
      return [from, ...ids.map((id) => ({ lng: nodes[id]!.lng, lat: nodes[id]!.lat })), to];
    },
  };
}

/** Walk a polyline at a constant pace, in metres per second. */
export function advanceAlongRoute(
  route: readonly LngLat[],
  distanceM: number,
): { point: LngLat; bearing: number; done: boolean } {
  if (route.length === 0) {
    return { point: { lat: 0, lng: 0 }, bearing: 0, done: true };
  }
  let remaining = distanceM;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const seg = metres(a, b);
    if (seg <= 0.0001) continue;
    if (remaining <= seg) {
      const t = remaining / seg;
      const dx = (b.lng - a.lng) * METRES_PER_DEG_LNG;
      const dy = (b.lat - a.lat) * METRES_PER_DEG_LAT;
      return {
        point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
        bearing: (Math.atan2(dx, dy) * 180) / Math.PI,
        done: false,
      };
    }
    remaining -= seg;
  }
  const last = route[route.length - 1]!;
  return { point: last, bearing: 0, done: true };
}

export function routeLengthMetres(route: readonly LngLat[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) total += metres(route[i]!, route[i + 1]!);
  return total;
}
