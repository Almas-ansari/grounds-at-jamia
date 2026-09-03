/**
 * Footprint trails.
 *
 * A person's recent path is turned into alternating foot glyphs laid along it.
 * This is *render* state and nothing else: it lives in memory for as long as
 * the tab is open, it is never written anywhere, and there is no table it
 * could be written to. Reload the page and the trails are gone, because there
 * is no history to reconstruct them from.
 *
 * Prints are laid on a **clock**, not on a distance. That is the whole trick to
 * making the trail read as walking. Spacing them by distance sounds right and
 * is not: a stride sized to look correct on a map of a whole campus is tens of
 * metres of real ground, so somebody strolling is classed as standing still for
 * fifteen seconds and then stamps six prints at once. Laying one print every
 * PRINT_INTERVAL_MS along an interpolated path gives an even cadence at any
 * speed, and the spacing then falls out of how fast the person is actually
 * going — which is what a trail is supposed to tell you.
 *
 * Positions arrive every few seconds at best. `interpolate` fills the gap so
 * the prints are laid along the path rather than at the handful of points the
 * network happened to deliver.
 */
import { footScaleFor, getMapZoom } from './viewport';

/** Glyph units → SVG map units, at the map's resting scale. */
export const FOOT_SCALE = 2.5;
/** Perpendicular to travel, alternating left and right — in glyph units. */
export const PRINT_OFFSET_UNITS = 5;

/** One print roughly every this long, while moving. */
export const PRINT_INTERVAL_MS = 820;
/** A print fades in over this long. */
export const PRINT_FADE_IN_MS = 200;
/** …and dissolves over this long, so a walker leaves a short dissolving trail. */
export const PRINT_LIFETIME_MS = 6000;
/**
 * Below this pace, treat somebody as standing. In map units per second, about
 * 0.35 m/s of ground — slower than anybody walks, and faster than the residual
 * wander of a smoothed phone fix.
 *
 * Judging this by *speed* rather than by accumulated distance matters: with a
 * distance threshold, a slow walker is classed as standing until they have
 * covered it, which on this map meant eight seconds of being wrongly still
 * before the trail admitted they were moving.
 */
export const STILL_SPEED_UNITS_PER_S = 0.55;
/**
 * And a floor on the gap between prints, so a dawdler does not stack a dozen
 * glyphs on one spot. The glyph is drawn far larger than a real foot at this
 * scale, so this is about not overlapping, not about anatomy.
 */
export const MIN_PRINT_GAP_UNITS = 26;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Foot = 'left' | 'right';

export interface Print {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Degrees, clockwise, 0 = the glyph's own "up". */
  readonly angle: number;
  readonly foot: Foot;
  readonly bornAt: number;
  /** A standing pair pulses gently instead of dissolving. */
  readonly stationary: boolean;
}

export interface TrailState {
  /** Where the last print was laid, in map units. */
  readonly cursor: Point | null;
  readonly nextFoot: Foot;
  readonly prints: readonly Print[];
  readonly seq: number;
  /** When the last print was laid, so the cadence can be kept. */
  readonly lastPrintAt: number;
  /** The previous sighting, for working out how fast they are going. */
  readonly seen: { readonly at: number; readonly p: Point } | null;
}

export function emptyTrail(now: number): TrailState {
  return { cursor: null, nextFoot: 'right', prints: [], seq: 0, lastPrintAt: now, seen: null };
}

const other = (foot: Foot): Foot => (foot === 'left' ? 'right' : 'left');

/** How far apart the pair of a standing print sits, at the current zoom. */
function offsetUnits(): number {
  return PRINT_OFFSET_UNITS * footScaleFor(getMapZoom());
}

/**
 * Where somebody is *right now*, between the last two positions the server
 * gave us. Without this the prints land only where an update happened, which
 * on a three-second publish interval is a dotted line, not a walk.
 */
export interface Motion {
  readonly from: Point;
  readonly to: Point;
  readonly startedAt: number;
  /** How long the crossing should take; the observed gap between updates. */
  readonly duration: number;
}

export function interpolate(motion: Motion, now: number): Point {
  if (motion.duration <= 0) return motion.to;
  // Clamped rather than extrapolated: guessing past the last known position
  // would draw somebody walking through a wall on a dropped update.
  const t = Math.max(0, Math.min(1, (now - motion.startedAt) / motion.duration));
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * t,
    y: motion.from.y + (motion.to.y - motion.from.y) * t,
  };
}

/** A pair of prints, side by side, for somebody who is not going anywhere. */
export function standingPair(
  p: Point,
  angle: number,
  now: number,
  userId: string,
  seq: number,
): Print[] {
  const rad = (angle * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  const offset = offsetUnits();
  return (['right', 'left'] as const).map((foot, i) => {
    const side = foot === 'right' ? 1 : -1;
    return {
      id: `${userId}:stand:${seq + i}`,
      x: p.x + nx * offset * side,
      y: p.y + ny * offset * side,
      angle,
      foot,
      bornAt: now,
      stationary: true,
    };
  });
}

/** Start a trail where somebody first appears. */
export function plantTrail(p: Point, now: number, userId: string): TrailState {
  return {
    cursor: p,
    nextFoot: 'right',
    prints: standingPair(p, 0, now, userId, 0),
    seq: 2,
    lastPrintAt: now,
    seen: { at: now, p },
  };
}

function alivePrints(prints: readonly Print[], now: number): Print[] {
  return prints.filter((print) => print.stationary || now - print.bornAt < PRINT_LIFETIME_MS);
}

/**
 * Advance a trail to where the person is now. Called on a steady tick with an
 * interpolated position, so it lays at most one print per call and keeps to the
 * cadence regardless of how often positions arrive.
 *
 * Returns a new state; never mutates.
 */
export function advanceTrail(state: TrailState, p: Point, now: number, userId: string): TrailState {
  const alive = alivePrints(state.prints, now);

  if (!state.cursor || !state.seen) return plantTrail(p, now, userId);

  // How fast, from the last sighting rather than from the last print.
  const dt = Math.max(1, now - state.seen.at) / 1000;
  const speed = Math.hypot(p.x - state.seen.p.x, p.y - state.seen.p.y) / dt;
  const seen = { at: now, p };

  const dx = p.x - state.cursor.x;
  const dy = p.y - state.cursor.y;
  const gap = Math.hypot(dx, dy);

  // --- standing ---------------------------------------------------------
  if (speed < STILL_SPEED_UNITS_PER_S) {
    if (alive.some((print) => print.stationary)) {
      return alive.length === state.prints.length ? { ...state, seen } : { ...state, prints: alive, seen };
    }
    // Come to a halt: settle the walking trail into a standing pair, facing
    // whichever way they were last going.
    const heading = alive.length > 0 ? alive[alive.length - 1]!.angle : 0;
    return {
      ...state,
      cursor: p,
      seen,
      prints: [...alive.filter((x) => !x.stationary), ...standingPair(p, heading, now, userId, state.seq)],
      seq: state.seq + 2,
    };
  }

  // --- walking ----------------------------------------------------------
  // Two gates, and both must open: the clock keeps the cadence even, and the
  // gap keeps the glyphs from overlapping when somebody is barely moving.
  const dueByClock = now - state.lastPrintAt >= PRINT_INTERVAL_MS;
  const farEnough = gap >= MIN_PRINT_GAP_UNITS;
  if (!dueByClock || !farEnough) {
    // Moving, but not yet time. Drop the standing pair so a walker is not
    // trailed by the ghost of where they set off from.
    const walking = alive.filter((print) => !print.stationary);
    return walking.length === state.prints.length
      ? { ...state, seen }
      : { ...state, prints: walking, seen };
  }

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  const foot = state.nextFoot;
  const side = foot === 'right' ? 1 : -1;
  const offset = offsetUnits();
  const nx = -dy / gap;
  const ny = dx / gap;

  return {
    cursor: p,
    nextFoot: other(foot),
    seen,
    prints: [
      ...alive.filter((print) => !print.stationary),
      {
        id: `${userId}:${state.seq}`,
        x: p.x + nx * offset * side,
        y: p.y + ny * offset * side,
        angle,
        foot,
        bornAt: now,
        stationary: false,
      },
    ],
    seq: state.seq + 1,
    lastPrintAt: now,
  };
}

/** Drop prints that have finished dissolving. Called on a slow sweep. */
export function pruneTrail(state: TrailState, now: number): TrailState {
  const prints = alivePrints(state.prints, now);
  return prints.length === state.prints.length ? state : { ...state, prints };
}
