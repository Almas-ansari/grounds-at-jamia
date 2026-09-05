/**
 * The scene, in two halves.
 *
 * `MapBase` is the hand-inked sheet: parchment, creases, ground cover,
 * buildings, roads, footpaths and the map's furniture. It is the whole map in
 * the `inked` style, and it is not drawn at all in `surveyed`, where the real
 * basemap does that job.
 *
 * `MapOverlay` is everything that belongs to *this* map rather than to the
 * terrain — the shared filter definitions, the zone lettering in the map's own
 * hand, the footprints and the name banners. It sits over either base, and it
 * is always mounted, which is also why the shared <defs> live here: the ink
 * filters must survive a style change.
 */
import { memo } from 'react';
import { HEIGHT, WIDTH } from '../../lib/projection';
import { MapDefs } from './MapDefs';
import { ParchmentBase } from './ParchmentBase';
import { CampusLayers } from './CampusLayers';
import { ZoneLabels } from './ZoneLabels';
import { MapFurniture } from './MapFurniture';
import { Footprints } from './Footprints';
import { NameBanners } from './NameBanners';
import { EstateMask } from './EstateMask';
import { MlBuildings } from './MlBuildings';
import type { TrailState } from '../../lib/trails';
import type { Wanderer } from '../../store/live';

/** The panels that peel back during the opening sequence. */
const PANELS = [
  { x: 0, width: WIDTH / 3, className: 'mm-fold-panel mm-fold-panel--1' },
  { x: WIDTH / 3, width: WIDTH / 3, className: 'mm-fold-panel mm-fold-panel--2' },
  { x: (WIDTH * 2) / 3, width: WIDTH / 3 + 1, className: 'mm-fold-panel mm-fold-panel--3' },
];

function MapBaseImpl({
  marginNote,
}: {
  readonly marginNote: string | null;
}): JSX.Element {
  return (
    <g clipPath="url(#mm-sheet-clip)">
      <ParchmentBase />
      <CampusLayers />
      <MapFurniture marginNote={marginNote} />
    </g>
  );
}

export const MapBase = memo(MapBaseImpl);

interface MapOverlayProps {
  readonly wanderers: Record<string, Wanderer>;
  readonly trails: Record<string, TrailState>;
  readonly highlightZoneId: string | null;
  readonly marginNote: string | null;
  readonly reducedMotion: boolean;
  readonly expandedClusterId: string | null;
  readonly onToggleCluster: (id: string | null) => void;
  readonly opening: boolean;
  readonly zoom: number;
  readonly surveyed: boolean;
}

function MapOverlayImpl({
  wanderers,
  trails,
  highlightZoneId,
  marginNote,
  reducedMotion,
  expandedClusterId,
  onToggleCluster,
  opening,
  zoom,
  surveyed,
}: MapOverlayProps): JSX.Element {
  return (
    <>
      <MapDefs />

      {/* Over the real basemap the paper is a treatment rather than the
          substrate, and it is applied in CSS on the map container — see
          `.mm-map--surveyed::before`. Tiling feTurbulence inside this overlay
          meant re-filtering it on every frame of every gesture. */}

      {/* The buildings the basemap does not have. Drawn before the mask, so a
          footprint that strays off the estate is covered like anything else. */}
      {surveyed && <MlBuildings />}

      {/* Anything that is not Jamia is covered over before the map's own
          lettering goes down, so a masked street can never sit on top of a
          zone label. */}
      <EstateMask />

      {/* The names on this map are OpenStreetMap's, carried by the tiles. This
          layer draws only the boundary and whatever place the reader searched
          for — lettering the zones a second time gave every building two names
          in two different hands. */}
      <ZoneLabels highlightZoneId={highlightZoneId} zoom={zoom} />

      {/* The empty-state marginalia belongs to the map's voice, so over the
          surveyed basemap it comes with the overlay rather than the sheet. */}
      {surveyed && marginNote && (
        <text
          x={WIDTH / 2}
          y={HEIGHT - 54}
          textAnchor="middle"
          className="mm-label mm-marginalia"
          fontSize={22}
          fill="var(--ink-faded)"
          fillOpacity={0.85}
        >
          {marginNote}
        </text>
      )}

      <Footprints wanderers={wanderers} trails={trails} reducedMotion={reducedMotion} />
      <NameBanners
        wanderers={wanderers}
        trails={trails}
        zoom={zoom}
        expandedClusterId={expandedClusterId}
        onToggleCluster={onToggleCluster}
      />

      {opening && (
        <g aria-hidden="true">
          {PANELS.map((panel) => (
            <rect
              key={panel.className}
              className={panel.className}
              x={panel.x}
              y={-4}
              width={panel.width}
              height={HEIGHT + 8}
            />
          ))}
        </g>
      )}
    </>
  );
}

export const MapOverlay = memo(MapOverlayImpl);
