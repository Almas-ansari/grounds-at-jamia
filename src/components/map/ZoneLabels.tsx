/**
 * Layer 6: the estate outline and the zone labels.
 *
 * Labels are set in the map's own hand and wrapped by hand too — no
 * measurement pass, just a sensible break on the longest word boundary, which
 * is what a cartographer lettering a sheet would do.
 */
import { memo } from 'react';
import { campusCore } from '../../data/campus';
import { pathFromCoordinates, project } from '../../lib/projection';
import { zones, type Zone } from '../../data/zones';
import osmNames from '../../data/osm-names.json';
import { distanceMetres } from '../../lib/projection';

/** Break a name into at most three lines of roughly even length. */
function wrap(name: string, target = 15): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > target && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

const LABEL_SIZE: Record<Zone['importance'], number> = { 3: 21, 2: 17.5, 1: 14.5 };
const CHAR_WIDTH = 0.52;

interface Placed {
  readonly zone: Zone;
  readonly x: number;
  readonly y: number;
  readonly lines: readonly string[];
  readonly size: number;
}

/**
 * Lettering a crowded sheet by hand means deciding what to leave out. Labels
 * are laid down in order of importance and anything that would collide with
 * ink already on the page is nudged, and dropped if it still will not fit.
 */
function placeLabels(sizeScale: number): Placed[] {
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const placed: Placed[] = [];

  const ordered = [...zones].sort((a, b) => {
    if (a.importance !== b.importance) return b.importance - a.importance;
    return a.name.localeCompare(b.name);
  });

  const hits = (x: number, y: number, w: number, h: number): boolean =>
    boxes.some(
      (b) =>
        Math.abs(b.x - x) * 2 < b.w + w + 10 * sizeScale &&
        Math.abs(b.y - y) * 2 < b.h + h + 8 * sizeScale,
    );

  for (const zone of ordered) {
    const p = project(zone.centroid.lat, zone.centroid.lng);
    const lines = wrap(zone.name);
    const size = LABEL_SIZE[zone.importance] * sizeScale;
    const w = Math.max(...lines.map((l) => l.length)) * size * CHAR_WIDTH;
    const h = lines.length * size * 1.05;

    // Try the centroid, then a short ring of offsets around it.
    const offsets: readonly [number, number][] = [
      [0, 0],
      [0, -(h / 2 + 16)],
      [0, h / 2 + 16],
      [-(w / 2 + 18), 0],
      [w / 2 + 18, 0],
      [0, -(h + 30)],
      [0, h + 30],
    ];
    const spot = offsets.find(([dx, dy]) => !hits(p.x + dx, p.y + dy, w, h));
    if (!spot) continue;

    boxes.push({ x: p.x + spot[0], y: p.y + spot[1], w, h });
    placed.push({ zone, x: p.x + spot[0], y: p.y + spot[1], lines, size });
  }

  return placed;
}

/**
 * Placement depends on how far in the map is zoomed, so it cannot be computed
 * once. Lettering is drawn in map units and shrinks as you go closer, which
 * means fewer collisions and room for more names — which is the whole point of
 * zooming into a map. Cached per half-step of zoom so a pinch does not
 * re-run the layout on every frame.
 */
const PLACEMENT_CACHE = new Map<number, Placed[]>();

function labelScaleFor(zoom: number): number {
  return 1 / Math.pow(Math.max(1, zoom), 0.62);
}

function placementFor(zoom: number): Placed[] {
  const bucket = Math.min(6, Math.max(1, Math.round(zoom * 2) / 2));
  const cached = PLACEMENT_CACHE.get(bucket);
  if (cached) return cached;
  const placed = placeLabels(labelScaleFor(bucket));
  PLACEMENT_CACHE.set(bucket, placed);
  return placed;
}

/**
 * How far in the map has to be zoomed before a label is worth the ink.
 * Faculties and the library carry the map at every scale; gates and lesser
 * grounds only earn their place once you are close enough to walk to them.
 */
const REVEAL_AT: Record<Zone['importance'], number> = { 3: 0, 2: 1.05, 1: 1.75 };

/**
 * Zones the basemap already letters itself.
 *
 * The tiles carry OSM's own names, and they start appearing around this scale.
 * Drawing ours on top of theirs gives "Zakir Hussain Library" twice in two
 * different hands, which is worse than either alone — so past this zoom we
 * stand down for the places OSM knows, and keep lettering the ones it does not.
 * That is most of the faculties.
 */
const TILES_LETTER_FROM = 1.5;
const SAME_PLACE_M = 70;

const LETTERED_BY_TILES = new Set(
  zones
    .filter((zone) =>
      (osmNames as readonly { name: string; lat: number; lng: number }[]).some((n) => {
        if (distanceMetres(zone.centroid, n) > SAME_PLACE_M) return false;
        const a = zone.name.toLowerCase().replace(/[^a-z]/g, '');
        const b = n.name.toLowerCase().replace(/[^a-z]/g, '');
        // A loose match: OSM writes "Zakir Hussain Library (JMI)" where this
        // map writes "Dr. Zakir Husain Library".
        return a.includes(b.slice(0, 8)) || b.includes(a.slice(0, 8));
      }),
    )
    .map((zone) => zone.id),
);

function ZoneLabelsImpl({
  highlightZoneId,
  zoom,
  onSelect,
}: {
  highlightZoneId?: string | null;
  zoom: number;
  onSelect?: (zone: Zone) => void;
}): JSX.Element {
  const placement = placementFor(zoom);

  return (
    <g className="mm-layer mm-layer--labels" aria-hidden="true">
      {/* The estate boundary: a heavier, wetter line than anything else. */}
      {campusCore && campusCore.geometry.type === 'Polygon' && campusCore.geometry.coordinates[0] && (
        <path
          d={pathFromCoordinates(campusCore.geometry.coordinates[0], true)}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={3.4}
          strokeOpacity={0.5}
          strokeDasharray="26 9 5 9"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#mm-bleed)"
        />
      )}

      <g filter="url(#mm-quill-fine)">
        {placement.map(({ zone, x, y, lines, size }) => {
          const active = highlightZoneId === zone.id;
          if (!active && zoom < REVEAL_AT[zone.importance]) return null;
          // Past this scale the basemap letters its own places, in OSM's hand.
          // Lettering them again gives the same library two names in two
          // different scripts, so ours stands down for the places OSM knows and
          // keeps naming the ones it does not — which is most of the faculties.
          if (!active && zoom >= TILES_LETTER_FROM && LETTERED_BY_TILES.has(zone.id)) return null;
          const dy0 = -((lines.length - 1) * size * 0.56);
          return (
            <g
              key={zone.id}
              className={active ? 'mm-zone mm-zone--lit' : 'mm-zone'}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `${zone.name}. Show on the map.` : undefined}
              onClick={onSelect ? () => onSelect(zone) : undefined}
              onKeyDown={
                onSelect
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(zone);
                      }
                    }
                  : undefined
              }
            >
              {/* A generous invisible target, so a label is tappable on a phone
                  without having to hit the lettering itself. */}
              {onSelect && (
                <rect
                  x={x - (Math.max(...lines.map((l) => l.length)) * size * 0.52) / 2 - 10}
                  y={y + dy0 - size}
                  width={Math.max(...lines.map((l) => l.length)) * size * 0.52 + 20}
                  height={lines.length * size * 1.05 + 14}
                  fill="transparent"
                />
              )}
              {/* Zone footprint, drawn only for hand-approximated shapes so the
                  reader can tell a surveyed outline from a sketched one. */}
              {(zone.approximate || active) && (
                <path
                  d={pathFromCoordinates(zone.polygon, true)}
                  fill="none"
                  stroke="var(--ink-faded)"
                  strokeWidth={1.1}
                  strokeOpacity={active ? 0.7 : 0.34}
                  strokeDasharray="4 5"
                  strokeLinejoin="round"
                />
              )}
              <text
                x={x}
                y={y}
                textAnchor="middle"
                className="mm-label"
                fontSize={size}
                fill={active ? 'var(--ember)' : 'var(--ink)'}
                fillOpacity={active ? 1 : zone.importance === 1 ? 0.72 : 0.92}
              >
                {lines.map((line, i) => (
                  <tspan key={line} x={x} dy={i === 0 ? dy0 : size * 1.02}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}

export const ZoneLabels = memo(ZoneLabelsImpl);
