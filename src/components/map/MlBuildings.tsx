/**
 * The buildings OpenStreetMap has not surveyed yet.
 *
 * OSM has 165 buildings on this campus and a great many real ones are simply
 * absent — which is what makes the map look wrong in places. These are machine
 * derived footprints from Microsoft's Global ML Building Footprints, under the
 * same ODbL licence as OSM, kept only where OSM has nothing at all
 * (see scripts/fetch-buildings.ts, which drops anything already surveyed).
 *
 * They are drawn a shade fainter than the basemap's own buildings, on purpose.
 * A machine's guess at a footprint is not the same kind of fact as somebody
 * having walked round the building with a GPS, and the map should not pretend
 * otherwise.
 */
import { memo } from 'react';
import mlBuildings from '../../data/ml-buildings.geojson';
import { pathFromCoordinates } from '../../lib/projection';

interface MlFeature {
  readonly properties: { readonly confidence: number };
  readonly geometry: { readonly type: 'Polygon'; readonly coordinates: number[][][] };
}

interface MlCollection {
  readonly features: readonly MlFeature[];
  readonly properties: { readonly attribution: string };
}

const data = mlBuildings as MlCollection;

/**
 * Built once, at module load. These never change and never animate, so the
 * whole layer is a single static subtree the browser can keep rasterised
 * while the map moves.
 */
const PATHS: readonly string[] = data.features
  // A low-confidence footprint is more likely to be a shadow or a tree than a
  // building, and a wrong building is worse than a missing one.
  .filter((f) => f.properties.confidence >= 0.6)
  .flatMap((f) => {
    const ring = f.geometry.coordinates[0];
    return ring && ring.length > 3 ? [pathFromCoordinates(ring, true)] : [];
  });

function MlBuildingsImpl(): JSX.Element {
  return (
    <g className="mm-layer mm-layer--ml-buildings" aria-hidden="true">
      {PATHS.map((d) => (
        <path
          key={d}
          d={d}
          fill="var(--ink)"
          fillOpacity={0.13}
          stroke="var(--ink)"
          strokeOpacity={0.3}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

export const MlBuildings = memo(MlBuildingsImpl);
