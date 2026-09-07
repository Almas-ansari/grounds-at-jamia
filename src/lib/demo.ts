/**
 * The three who are always here.
 *
 * An empty map teaches nobody anything, and nobody signs in to an empty map to
 * find out what it does — so three invented people walk the real footpaths
 * whether or not anybody else is about. Nothing here touches the database and
 * no real person's location is involved: the positions are worked out in the
 * browser from the campus's own paths.
 *
 * They keep walking once you are signed in, and that is the part to be careful
 * about — invented people standing among real ones with nothing to tell them
 * apart would be a straightforward lie about where somebody is. So they carry
 * an `invented` flag, the map letters them with it, and the note at the top of
 * the screen says so in plain words rather than in a tooltip nobody opens.
 */
import { campus } from '../data/campus';
import { zones, type Zone } from '../data/zones';
import type { Wanderer } from '../store/live';
import { advanceAlongRoute, buildWalkGraph, routeLengthMetres, type WalkGraph } from './walkgraph';
import { distanceMetres, EAST, NORTH, SOUTH, WEST, type LngLat } from './projection';
import { hashString, seededRandom } from './rng';

/**
 * A stroll, not a walk. A real walk is about 1.3 m/s; at the scale a phone
 * shows the whole estate that reads as scurrying. This is slow enough to look
 * like somebody in no hurry and still comfortably above the speed at which the
 * trail machinery decides a person is standing still and stops laying prints —
 * below that they would drift along leaving nothing behind them.
 */
export const RESIDENT_SPEED_MS = 0.6;

/** Named, because three people with names read as a campus and three
 *  placeholders read as a loading state. */
const RESIDENTS = [
  { displayName: 'Almas Ansari', handle: 'almas_ansari' },
  { displayName: 'Abdullah Shakir', handle: 'abdullah_shakir' },
  { displayName: 'Mohd Asif', handle: 'mohd_asif' },
] as const;

interface Walker {
  readonly userId: string;
  readonly displayName: string;
  readonly handle: string;
  route: LngLat[];
  routeLength: number;
  distance: number;
  /** Seconds left standing still before setting off again. */
  dwell: number;
  target: Zone;
  point: LngLat;
  bearing: number;
}

export interface DemoFlock {
  tick: (deltaSeconds: number) => Wanderer[];
}

function pickZone(random: () => number, notThis?: Zone): Zone {
  const candidates = zones.filter((z) => z.kind !== 'gate' && z.id !== notThis?.id);
  return candidates[Math.floor(random() * candidates.length)] ?? zones[0]!;
}

/**
 * Where they are standing when the page opens.
 *
 * Left to wander from anywhere, three people on a campus this size are easy to
 * miss entirely — the map opens zoomed in, and a first glance showing nobody is
 * exactly the empty map they exist to prevent. So they start on the three
 * places nearest the middle of the grounds, which the opening view contains,
 * and wander outwards from there.
 */
const CENTRAL_ZONES: readonly Zone[] = [...zones]
  .filter((z) => z.kind !== 'gate')
  .sort(
    (a, b) =>
      distanceMetres(a.centroid, { lat: (NORTH + SOUTH) / 2, lng: (WEST + EAST) / 2 }) -
      distanceMetres(b.centroid, { lat: (NORTH + SOUTH) / 2, lng: (WEST + EAST) / 2 }),
  );

export function createResidents(): DemoFlock {
  const graph: WalkGraph = buildWalkGraph(campus.features, {
    west: WEST,
    south: SOUTH,
    east: EAST,
    north: NORTH,
  });

  const walkers: Walker[] = RESIDENTS.map((who, i) => {
    const random = seededRandom(hashString(`resident-${i}`));
    const from = CENTRAL_ZONES[i] ?? pickZone(random);
    const to = pickZone(random, from);
    const route = graph.route(from.centroid, to.centroid);
    return {
      userId: `resident-${i}`,
      displayName: who.displayName,
      handle: who.handle,
      route,
      routeLength: routeLengthMetres(route),
      // Stagger them so they do not all set off in lockstep — but only a
      // little, or the head start carries them out of the opening view before
      // anybody has seen them.
      distance: random() * Math.max(1, routeLengthMetres(route)) * 0.12,
      dwell: 6 + random() * 30,
      target: to,
      point: from.centroid,
      bearing: 0,
    };
  });

  const random = seededRandom(hashString('demo-flock'));

  return {
    tick(deltaSeconds) {
      const now = Date.now();
      return walkers.map((walker) => {
        if (walker.dwell > 0) {
          walker.dwell -= deltaSeconds;
        } else {
          walker.distance += RESIDENT_SPEED_MS * deltaSeconds;
          const step = advanceAlongRoute(walker.route, walker.distance);
          walker.point = step.point;
          walker.bearing = step.bearing;
          if (step.done || walker.distance >= walker.routeLength) {
            const next = pickZone(random, walker.target);
            walker.route = graph.route(walker.point, next.centroid);
            walker.routeLength = routeLengthMetres(walker.route);
            walker.distance = 0;
            walker.target = next;
            walker.dwell = 25 + random() * 60;
          }
        }
        return {
          userId: walker.userId,
          displayName: walker.displayName,
          handle: walker.handle,
          isSelf: false,
          precise: true,
          point: walker.point,
          zoneId: walker.target.id,
          bearing: walker.bearing,
          updatedAt: now,
          // Invented people never lapse; they are always walking.
          staleSince: null,
          invented: true,
        } satisfies Wanderer;
      });
    },
  };
}
