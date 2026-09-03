/**
 * Typed access to the committed OSM extract.
 *
 * scripts/fetch-campus.ts produced this file once, at build time. Nothing here
 * touches the network — the app must never call Overpass at runtime.
 */
import raw from './campus.geojson';

export type CampusLayer =
  | 'boundary'
  | 'campus_core'
  | 'building'
  | 'footway'
  | 'road'
  | 'pitch'
  | 'green'
  | 'water'
  | 'poi';

export type Position = [number, number];

export interface CampusFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly properties: {
    readonly layer: CampusLayer;
    readonly name?: string;
    readonly osmId: string;
    readonly tags: Readonly<Record<string, string>>;
  };
  readonly geometry:
    | { readonly type: 'Polygon'; readonly coordinates: readonly Position[][] }
    | { readonly type: 'LineString'; readonly coordinates: readonly Position[] }
    | { readonly type: 'Point'; readonly coordinates: Position };
}

export interface CampusData {
  readonly type: 'FeatureCollection';
  /** Full OSM data extent (the administrative boundary). */
  readonly bbox: [number, number, number, number];
  readonly properties: {
    readonly source: string;
    readonly fetchedAt: string;
    readonly campusOsmId: string;
    readonly spanMetres: { readonly ew: number; readonly ns: number };
    /** The framed university estate; drives the SVG viewBox. */
    readonly renderBbox: [number, number, number, number];
    readonly renderSpanMetres: { readonly ew: number; readonly ns: number };
  };
  readonly features: readonly CampusFeature[];
}

export const campus = raw as CampusData;

export function featuresOfLayer(layer: CampusLayer): readonly CampusFeature[] {
  return campus.features.filter((f) => f.properties.layer === layer);
}

/** The university's own amenity=university polygon, not the neighbours'. */
export const campusCore: CampusFeature | undefined = campus.features.find(
  (f) => f.properties.layer === 'campus_core' && /jamia/i.test(f.properties.name ?? ''),
);

export default campus;
