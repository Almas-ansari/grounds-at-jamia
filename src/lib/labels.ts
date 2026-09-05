/**
 * Name banner placement.
 *
 * Banners must not overlap, and a crowd must not become a wall of ribbons. Two
 * rules, in order:
 *
 *   1. If more than four people are packed inside a small radius, they become
 *      one cluster marker showing the count, which opens on tap.
 *   2. Everyone else gets a banner pushed outward along its own leader line
 *      until it is clear of every banner already placed.
 */

export interface BannerAnchor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly isSelf: boolean;
}

export interface PlacedBanner {
  readonly id: string;
  readonly label: string;
  /** Where the leader line starts — the person's feet. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Centre of the ribbon. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isSelf: boolean;
}

export interface PlacedCluster {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly memberIds: readonly string[];
  readonly containsSelf: boolean;
}

export interface BannerLayout {
  readonly banners: readonly PlacedBanner[];
  readonly clusters: readonly PlacedCluster[];
}

/** Map units. A crowd this tight is unreadable as separate ribbons. */
export const CLUSTER_RADIUS = 105;
export const CLUSTER_THRESHOLD = 5;

const BANNER_HEIGHT = 34;
const CHAR_WIDTH = 9.6;
const BANNER_PADDING = 26;
/** How far above the feet a banner sits before any pushing. */
const LEADER_LENGTH = 62;
const MAX_PASSES = 48;
const STEP = 11;

/**
 * How long ago, in as few characters as will fit on a ribbon. Minutes only:
 * "last seen 4m ago" is the useful precision, and seconds would make a fading
 * record look more exact than it is.
 */
export function agoLabel(sinceMs: number): string {
  const minutes = Math.floor(sinceMs / 60_000);
  if (minutes < 1) return 'just now';
  return `${minutes}m ago`;
}

export function bannerWidth(label: string): number {
  return Math.max(72, label.length * CHAR_WIDTH + BANNER_PADDING);
}

function overlaps(a: PlacedBanner, b: PlacedBanner, gap = 6): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + gap * 2 &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height + gap * 2
  );
}

/**
 * Greedy clustering: walk the anchors in a stable order, and whenever a point
 * still has CLUSTER_THRESHOLD or more unclaimed neighbours within
 * CLUSTER_RADIUS, take the whole group.
 */
function cluster(anchors: readonly BannerAnchor[]): {
  clusters: PlacedCluster[];
  loose: BannerAnchor[];
} {
  const claimed = new Set<string>();
  const clusters: PlacedCluster[] = [];

  for (const seed of anchors) {
    if (claimed.has(seed.id)) continue;
    const near = anchors.filter(
      (a) => !claimed.has(a.id) && Math.hypot(a.x - seed.x, a.y - seed.y) <= CLUSTER_RADIUS,
    );
    if (near.length < CLUSTER_THRESHOLD) continue;
    for (const a of near) claimed.add(a.id);
    const cx = near.reduce((sum, a) => sum + a.x, 0) / near.length;
    const cy = near.reduce((sum, a) => sum + a.y, 0) / near.length;
    clusters.push({
      id: `cluster:${near.map((a) => a.id).sort().join('|')}`,
      x: cx,
      y: cy,
      count: near.length,
      memberIds: near.map((a) => a.id),
      containsSelf: near.some((a) => a.isSelf),
    });
  }

  return { clusters, loose: anchors.filter((a) => !claimed.has(a.id)) };
}

export function layoutBanners(anchors: readonly BannerAnchor[]): BannerLayout {
  const { clusters, loose } = cluster(anchors);

  // Deterministic order, so the same crowd lays out the same way every frame.
  // Your own banner is placed first and never displaced by anybody else's.
  const ordered = [...loose].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.y !== b.y) return a.y - b.y;
    return a.id < b.id ? -1 : 1;
  });

  const placed: PlacedBanner[] = [];

  for (const anchor of ordered) {
    const width = bannerWidth(anchor.label);
    let candidate: PlacedBanner = {
      id: anchor.id,
      label: anchor.label,
      anchorX: anchor.x,
      anchorY: anchor.y,
      x: anchor.x,
      y: anchor.y - LEADER_LENGTH,
      width,
      height: BANNER_HEIGHT,
      isSelf: anchor.isSelf,
    };

    // Push along the leader line — straight up first, then fanning outward if
    // going straight up cannot find room.
    let pass = 0;
    let fan = 0;
    while (placed.some((p) => overlaps(p, candidate)) && pass < MAX_PASSES) {
      pass += 1;
      // Every eight steps, tilt the leader a little so a dense column of
      // people does not build one absurdly tall stack of ribbons.
      if (pass % 8 === 0) fan += fan >= 0 ? -(fan + 1) : -(fan - 1);
      const tilt = (fan * 16 * Math.PI) / 180;
      const distance = LEADER_LENGTH + pass * STEP;
      candidate = {
        ...candidate,
        x: anchor.x + Math.sin(tilt) * distance,
        y: anchor.y - Math.cos(tilt) * distance,
      };
    }

    placed.push(candidate);
  }

  return { banners: placed, clusters };
}
