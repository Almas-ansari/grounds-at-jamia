/**
 * The estate outline, and the one name the reader has actually asked for.
 *
 * This layer used to letter every zone. It no longer does, because the basemap
 * already carries OpenStreetMap's own names and lettering them again gave the
 * same library two names in two different scripts. Where the two disagreed the
 * map contradicted itself; where they agreed it was simply noise. OSM's names
 * are better surveyed than the hand-curated list anyway, and they are already
 * washed into the palette with everything else.
 *
 * What survives is the part the tiles cannot do: the boundary of the grounds,
 * and a highlight for the place someone picked out of the search — which is a
 * reply to a question, not a duplicate.
 */
import { memo } from 'react';
import { campusCore } from '../../data/campus';
import { pathFromCoordinates, project } from '../../lib/projection';
import { zoneById, type Zone } from '../../data/zones';

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

const HIGHLIGHT_SIZE = 21;

function ZoneLabelsImpl({
  highlightZoneId,
  zoom,
}: {
  highlightZoneId?: string | null;
  /** Lettering is drawn in map units, so it has to shrink as the map grows. */
  zoom: number;
}): JSX.Element {
  const zone: Zone | undefined = highlightZoneId ? zoneById.get(highlightZoneId) : undefined;
  const size = HIGHLIGHT_SIZE / Math.pow(Math.max(1, zoom), 0.62);

  return (
    <g className="mm-layer mm-layer--labels" aria-hidden="true">
      {/* The estate boundary: a heavier, wetter line than anything else, and
          the one thing on this map that OSM does not draw for us. */}
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

      {zone && (
        <g className="mm-zone mm-zone--lit" filter="url(#mm-quill-fine)">
          {/* A hand-drawn outline is worth showing when it is the answer to a
              search: it admits the shape is sketched rather than surveyed. */}
          {zone.approximate && (
            <path
              d={pathFromCoordinates(zone.polygon, true)}
              fill="none"
              stroke="var(--ember)"
              strokeWidth={1.4}
              strokeOpacity={0.6}
              strokeDasharray="4 5"
              strokeLinejoin="round"
            />
          )}
          {(() => {
            const p = project(zone.centroid.lat, zone.centroid.lng);
            const lines = wrap(zone.name);
            const dy0 = -((lines.length - 1) * size * 0.56);
            return (
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                className="mm-label"
                fontSize={size}
                fill="var(--ember)"
              >
                {lines.map((line, i) => (
                  <tspan key={line} x={p.x} dy={i === 0 ? dy0 : size * 1.02}>
                    {line}
                  </tspan>
                ))}
              </text>
            );
          })()}
        </g>
      )}
    </g>
  );
}

export const ZoneLabels = memo(ZoneLabelsImpl);
