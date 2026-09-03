/**
 * Layers 3 to 5: the campus itself, inked from the committed OSM extract.
 *
 * Nothing here is stateful and nothing here depends on live data, so the whole
 * thing memoises to a single static subtree. Pan and zoom never re-render it —
 * they only move the transform on the group above.
 */
import { memo, useMemo } from 'react';
import { campus, campusCore, type CampusFeature } from '../../data/campus';
import { pathFromCoordinates } from '../../lib/projection';
import { hashString, seededRandom } from '../../lib/rng';
import { distanceToPolygonMetres, pointInRing } from '../../lib/geo';
import { zones } from '../../data/zones';

/**
 * The estate, for inking purposes: the surveyed amenity=university polygon
 * plus every named zone. The Engineering and Architecture faculties sit south
 * of the core polygon in OSM but are unmistakably part of the campus, and they
 * should not be drawn as if they were somebody else's town.
 */
const ESTATE_PAD_M = 130;

/** Faculties and the library are inked hardest, so the eye finds them first. */
const zoneOsmIds = new Set<string>();
for (const zone of zones) {
  if (zone.importance < 3) continue;
  for (const f of campus.features) {
    if (f.geometry.type !== 'Polygon') continue;
    if (f.geometry.coordinates[0] === zone.polygon) zoneOsmIds.add(f.properties.osmId);
  }
}

interface Inked {
  readonly key: string;
  readonly d: string;
  readonly strokeWidth: number;
  readonly fill: string;
  readonly opacity: number;
}

/** A stroke width that wobbles per feature but never changes between reloads. */
function inkWidth(key: string, base: number, spread: number): number {
  return base + (seededRandom(hashString(key))() - 0.5) * spread;
}

function ringOf(f: CampusFeature): readonly (readonly number[])[] | null {
  if (f.geometry.type === 'Polygon') return f.geometry.coordinates[0] ?? null;
  return null;
}

function centroidOf(coords: readonly (readonly number[])[]): { lng: number; lat: number } {
  let x = 0;
  let y = 0;
  for (const c of coords) {
    x += c[0] ?? 0;
    y += c[1] ?? 0;
  }
  return { lng: x / coords.length, lat: y / coords.length };
}

function CampusLayersImpl(): JSX.Element {
  const layers = useMemo(() => {
    const core = campusCore && campusCore.geometry.type === 'Polygon'
      ? campusCore.geometry.coordinates[0] ?? null
      : null;

    /** Off-estate features are drawn faintly, the way a surveyor sketches in
     *  the surrounding town without surveying it. */
    const onEstate = (f: CampusFeature): boolean => {
      const coords =
        f.geometry.type === 'Point'
          ? [f.geometry.coordinates]
          : f.geometry.type === 'Polygon'
            ? f.geometry.coordinates[0] ?? []
            : f.geometry.coordinates;
      if (coords.length === 0) return false;
      const centre = centroidOf(coords);
      if (core && pointInRing(centre, core)) return true;
      for (const zone of zones) {
        if (distanceToPolygonMetres(centre, zone.polygon) <= ESTATE_PAD_M) return true;
      }
      return false;
    };

    const greens: Inked[] = [];
    const pitches: Inked[] = [];
    const waters: Inked[] = [];
    const buildings: Inked[] = [];
    const footways: Inked[] = [];
    const roads: Inked[] = [];

    for (const f of campus.features) {
      const { layer, osmId } = f.properties;
      const near = onEstate(f);

      if (layer === 'green' || layer === 'pitch' || layer === 'water') {
        const ring = ringOf(f);
        if (!ring) continue;
        const item: Inked = {
          key: osmId,
          d: pathFromCoordinates(ring, true),
          strokeWidth: inkWidth(osmId, 1.5, 0.7),
          fill:
            layer === 'water'
              ? 'url(#mm-water)'
              : f.properties.tags.leisure === 'pitch' || f.properties.tags.leisure === 'track'
                ? 'url(#mm-pitch)'
                : 'url(#mm-grass)',
          opacity: near ? 1 : 0.45,
        };
        if (layer === 'water') waters.push(item);
        else if (f.properties.tags.leisure === 'pitch') pitches.push(item);
        else greens.push(item);
        continue;
      }

      if (layer === 'building') {
        const ring = ringOf(f);
        if (!ring) continue;
        // Hierarchy: named JMI blocks get cross-hatch, other on-estate
        // buildings get mid hatch, the surrounding town gets stipple.
        const important = zoneOsmIds.has(osmId);
        const named = Boolean(f.properties.name);
        const fill = !near
          ? 'url(#mm-stipple)'
          : important
            ? 'url(#mm-cross)'
            : named
              ? 'url(#mm-hatch-3)'
              : 'url(#mm-hatch-2)';
        buildings.push({
          key: osmId,
          d: pathFromCoordinates(ring, true),
          strokeWidth: inkWidth(osmId, near ? 2.6 : 1.5, near ? 1.1 : 0.5),
          fill,
          opacity: near ? 1 : 0.36,
        });
        continue;
      }

      if (layer === 'footway' || layer === 'road') {
        if (f.geometry.type !== 'LineString') continue;
        const item: Inked = {
          key: osmId,
          d: pathFromCoordinates(f.geometry.coordinates, false),
          strokeWidth: inkWidth(osmId, layer === 'road' ? 6.2 : 2.6, 1.2),
          fill: 'none',
          opacity: near ? 1 : 0.34,
        };
        if (layer === 'road') roads.push(item);
        else footways.push(item);
      }
    }

    return { greens, pitches, waters, buildings, footways, roads };
  }, []);

  return (
    <>
      {/* --- 3. ground cover ------------------------------------------- */}
      <g className="mm-layer mm-layer--ground" filter="url(#mm-quill)" aria-hidden="true">
        {[...layers.greens, ...layers.pitches].map((item) => (
          <g key={item.key} opacity={item.opacity}>
            <path d={item.d} fill="var(--parchment-deep)" fillOpacity={0.5} />
            <path d={item.d} fill={item.fill} />
            <path
              d={item.d}
              fill="none"
              stroke="var(--ink-faded)"
              strokeWidth={item.strokeWidth}
              strokeOpacity={0.8}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {layers.waters.map((item) => (
          <g key={item.key} opacity={item.opacity}>
            <path d={item.d} fill={item.fill} />
            <path
              d={item.d}
              fill="none"
              stroke="var(--ink-faded)"
              strokeWidth={item.strokeWidth + 0.5}
              strokeOpacity={0.7}
              strokeLinejoin="round"
            />
          </g>
        ))}
      </g>

      {/* --- 5a. roads, under the buildings so kerbs tuck behind walls --- */}
      <g className="mm-layer mm-layer--roads" filter="url(#mm-quill)" aria-hidden="true">
        {layers.roads.map((item) => (
          <g key={item.key} opacity={item.opacity}>
            {/* Two thin kerb lines… */}
            <path
              className="mm-draw"
              pathLength={1}
              d={item.d}
              fill="none"
              stroke="var(--ink-faded)"
              strokeWidth={item.strokeWidth}
              strokeOpacity={0.85}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={item.d}
              fill="none"
              stroke="var(--parchment)"
              strokeWidth={Math.max(1, item.strokeWidth - 1.7)}
              strokeOpacity={0.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* …and a dashed centre. */}
            <path
              d={item.d}
              fill="none"
              stroke="var(--ink-faded)"
              strokeWidth={0.85}
              strokeOpacity={0.6}
              strokeDasharray="6 7"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>

      {/* --- 4. buildings ---------------------------------------------- */}
      <g className="mm-layer mm-layer--buildings" filter="url(#mm-quill)" aria-hidden="true">
        {layers.buildings.map((item) => (
          <g key={item.key} opacity={item.opacity}>
            <path d={item.d} fill="var(--parchment)" fillOpacity={0.7} />
            <path d={item.d} fill={item.fill} />
            <path
              className="mm-draw"
              pathLength={1}
              d={item.d}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={item.strokeWidth}
              strokeOpacity={0.95}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>

      {/* --- 5b. footpaths, over everything so they read as routes ------ */}
      <g className="mm-layer mm-layer--paths" filter="url(#mm-quill)" aria-hidden="true">
        {layers.footways.map((item) => (
          <path
            key={item.key}
            d={item.d}
            fill="none"
            stroke="var(--ink-faded)"
            strokeWidth={item.strokeWidth}
            strokeOpacity={item.opacity * 0.95}
            strokeDasharray="7 6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </>
  );
}

export const CampusLayers = memo(CampusLayersImpl);
