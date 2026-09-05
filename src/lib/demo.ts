/**
 * Demonstration wanderers.
 *
 * Signed out, the map still has to be worth looking at, so six invented people
 * walk the real footpaths. Nothing here touches the database and none of these
 * names belongs to anybody: no real person's location is involved, which is
 * exactly why the map says so out loud while this is running.
 */
import { campus } from '../data/campus';
import { zones, type Zone } from '../data/zones';
import type { Wanderer } from '../store/live';
import { advanceAlongRoute, buildWalkGraph, routeLengthMetres, type WalkGraph } from './walkgraph';
import { EAST, NORTH, SOUTH, WEST, type LngLat } from './projection';
import { hashString, seededRandom } from './rng';

/**
 * An unhurried campus pace. A real walk is about 1.3 m/s; at the scale a phone
 * shows the whole estate that reads as scurrying, but much below this and the
 * demonstration walkers never lay enough prints to show what a trail is for.
 */
export const WALK_SPEED_MS = 0.95;

const INVENTED_NAMES = [
  'Rukhsana',
  'Imtiaz',
  'Parveen',
  'Yusuf',
  'Shabana',
  'Zaheer',
  'Nasreen',
  'Faraz',
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

export function createDemoFlock(count = 6): DemoFlock {
  const graph: WalkGraph = buildWalkGraph(campus.features, {
    west: WEST,
    south: SOUTH,
    east: EAST,
    north: NORTH,
  });

  const walkers: Walker[] = Array.from({ length: count }, (_, i) => {
    const random = seededRandom(hashString(`demo-${i}`));
    const from = pickZone(random);
    const to = pickZone(random, from);
    const route = graph.route(from.centroid, to.centroid);
    return {
      userId: `demo-${i}`,
      displayName: INVENTED_NAMES[i % INVENTED_NAMES.length]!,
      handle: `demo_${i}`,
      route,
      routeLength: routeLengthMetres(route),
      // Stagger them so they do not all set off in lockstep.
      distance: random() * Math.max(1, routeLengthMetres(route)) * 0.6,
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
          walker.distance += WALK_SPEED_MS * deltaSeconds;
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
        } satisfies Wanderer;
      });
    },
  };
}
