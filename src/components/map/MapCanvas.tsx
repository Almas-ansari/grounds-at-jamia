/**
 * The map surface.
 *
 * Leaflet drives it, over a basemap this app **serves itself** from
 * `public/tiles/` — downloaded once by `npm run fetch:tiles` and committed. No
 * tile provider is contacted while anybody is using the map, which is what
 * makes it work offline in the PWA and means no third party gets a log of
 * where a reader is panning.
 *
 * Two styles sit on the same map:
 *
 *   surveyed — the real basemap, washed into the parchment palette by a CSS
 *              filter, with the paper grain over it. Accurate, and the one to
 *              use when you actually need to find a door.
 *   inked    — the hand-drawn SVG scene, with no tiles at all.
 *
 * Either way the people layer — footprints, banners, zone lettering — is the
 * same SVG overlay, georeferenced to the campus bounds, so it lines up with
 * both.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EAST, HEIGHT, NORTH, SOUTH, WEST, WIDTH } from '../../lib/projection';
import { ESTATE_BOUNDS, ESTATE_CENTRE } from '../../data/estate';
import { footScaleFor, setMapZoom } from '../../lib/viewport';

export type BasemapStyle = 'surveyed' | 'inked';

/** Matches the zoom range fetch-tiles downloaded. */
const TILE_MIN_ZOOM = 15;
const TILE_MAX_ZOOM = 18;
/** Leaflet will upscale the deepest tiles rather than showing nothing. */
const VIEW_MAX_ZOOM = 20;

export interface MapCanvasHandle {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  fitTo: (ring: readonly (readonly number[])[], padding?: number) => void;
  zoomBy: (steps: number) => void;
  reset: () => void;
  getZoom: () => number;
  canZoomIn: () => boolean;
  canZoomOut: () => boolean;
}

interface MapCanvasProps {
  /** The hand-drawn scene. Shown only in the `inked` style. */
  readonly base: ReactNode;
  /** People and lettering. Shown over either style. */
  readonly overlay: ReactNode;
  readonly style: BasemapStyle;
  readonly opening: boolean;
  readonly reducedMotion: boolean;
  readonly onZoomChange?: (zoom: number) => void;
  readonly label: string;
}

/** The georeferenced frame of the SVG overlay: the whole render window. */
const SHEET_BOUNDS = L.latLngBounds([SOUTH, WEST], [NORTH, EAST]);

/**
 * The university's own land. Framing, the minimum zoom and the pan limits are
 * all derived from this rather than from the downloaded sheet, so a reader
 * cannot wander off into Okhla — there is nothing out there to see.
 */
const ESTATE = L.latLngBounds(
  [ESTATE_BOUNDS.south, ESTATE_BOUNDS.west],
  [ESTATE_BOUNDS.north, ESTATE_BOUNDS.east],
).pad(0.06);
// The mask keeps showing roughly 90 m past the estate outline, so panning is
// allowed a matching margin — stopping dead at the boundary would feel like a
// wall where the map plainly carries on.
const PAN_BOUNDS = ESTATE.pad(0.22);

const HOME: L.LatLngExpression = [ESTATE_CENTRE.lat, ESTATE_CENTRE.lng];

/** The Leaflet zoom at which the whole estate is on screen. */
const fitZoom = (map: L.Map): number => map.getBoundsZoom(ESTATE);

/**
 * Leaflet's zoom, restated the way the rest of the app thinks about scale:
 * 1 means the whole estate is visible, 2 is twice that, and so on. Footprints
 * and label thresholds are expressed in these terms so they do not have to know
 * anything about tile pyramids.
 */
const relativeScale = (map: L.Map): number => Math.pow(2, map.getZoom() - fitZoom(map));

/** How far in the map opens: close enough to read, with room to pull back. */
const OPENING_STEPS = 0.55;

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { base, overlay, style, opening, reducedMotion, onZoomChange, label },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseSvgRef = useRef<SVGSVGElement | null>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const inkRef = useRef<L.SVGOverlay | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const baseSvg = baseSvgRef.current;
    const overlaySvg = overlaySvgRef.current;
    if (!container || !baseSvg || !overlaySvg || mapRef.current) return undefined;

    const map = L.map(container, {
      // Attribution is required for the basemap, so it is shown — restyled
      // into the palette rather than hidden.
      attributionControl: true,
      zoomControl: false,
      // Continuous zoom: this is one drawing and one small tile set, not a
      // pyramid deep enough for integer steps to matter.
      zoomSnap: 0,
      zoomDelta: 0.6,
      wheelPxPerZoomLevel: 110,
      inertia: !reducedMotion,
      inertiaDeceleration: 2600,
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: false,
      maxBounds: PAN_BOUNDS,
      maxBoundsViscosity: 0.85,
      keyboard: true,
      keyboardPanDelta: 90,
      bounceAtZoomLimits: false,
      minZoom: TILE_MIN_ZOOM,
      maxZoom: VIEW_MAX_ZOOM,
    });

    // Self-hosted. Nothing here reaches out to anybody at runtime.
    tilesRef.current = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      minZoom: TILE_MIN_ZOOM,
      maxNativeZoom: TILE_MAX_ZOOM,
      maxZoom: VIEW_MAX_ZOOM,
      bounds: PAN_BOUNDS,
      tileSize: 256,
      // One ring of off-screen tiles is plenty for a campus-sized map.
      keepBuffer: 1,
      className: 'mm-tiles',
      // Required by the tile source, and repeated in the About panel.
      attribution: '© OpenStreetMap contributors',
    });

    /**
     * Tailwind's preflight sets `img { max-width: 100% }`, and Leaflet's tiles
     * sit in an absolutely-positioned container of zero width, so every tile
     * gets clamped to nothing at all. Rather than fight that in the cascade,
     * the size is written onto each tile as it is created, where no stylesheet
     * can reach it.
     */
    tilesRef.current.on('tileloadstart', (event) => {
      const tile = event.tile as HTMLImageElement;
      tile.style.maxWidth = 'none';
      tile.style.maxHeight = 'none';
      tile.style.width = '256px';
      tile.style.height = '256px';
    });

    inkRef.current = L.svgOverlay(baseSvg, SHEET_BOUNDS, { interactive: false, className: 'mm-ink-overlay' });
    L.svgOverlay(overlaySvg, SHEET_BOUNDS, { interactive: true, className: 'mm-people-overlay' }).addTo(map);

    map.attributionControl.setPrefix('');
    L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 130 }).addTo(map);

    map.setView(HOME, fitZoom(map) + OPENING_STEPS, { animate: false });
    // Never further out than the whole estate: past that there is only mask.
    map.setMinZoom(Math.max(TILE_MIN_ZOOM, fitZoom(map) - 0.08));
    mapRef.current = map;

    const publishScale = (): number => {
      const k = relativeScale(map);
      overlaySvg.style.setProperty('--mm-foot', footScaleFor(k).toFixed(4));
      baseSvg.style.setProperty('--mm-foot', footScaleFor(k).toFixed(4));
      setMapZoom(k);
      return k;
    };
    const sync = (): void => {
      const k = publishScale();
      setZoom(k);
      onZoomChange?.(k);
    };
    // Mid-gesture only the CSS variable moves; React hears about it once the
    // map has come to rest.
    map.on('zoom', publishScale);
    map.on('zoomend moveend', sync);
    sync();

    const resize = (): void => {
      map.invalidateSize();
      map.setMinZoom(Math.max(TILE_MIN_ZOOM, fitZoom(map) - 0.08));
    };
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      map.off();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      inkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Swap the base without rebuilding the map, so the view is never lost. */
  useEffect(() => {
    const map = mapRef.current;
    const tiles = tilesRef.current;
    const ink = inkRef.current;
    if (!map || !tiles || !ink) return;
    if (style === 'surveyed') {
      if (!map.hasLayer(tiles)) tiles.addTo(map);
      if (map.hasLayer(ink)) map.removeLayer(ink);
    } else {
      if (map.hasLayer(tiles)) map.removeLayer(tiles);
      if (!map.hasLayer(ink)) ink.addTo(map);
      ink.bringToBack();
    }
  }, [style]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo(lat, lng, targetZoom = 2.6) {
        const map = mapRef.current;
        if (!map) return;
        const z = Math.min(map.getMaxZoom(), fitZoom(map) + Math.log2(Math.max(1, targetZoom)));
        if (reducedMotion) map.setView([lat, lng], z, { animate: false });
        else map.flyTo([lat, lng], z, { duration: 0.9 });
      },
      fitTo(ring, padding = 56) {
        const map = mapRef.current;
        if (!map || ring.length === 0) return;
        const bounds = L.latLngBounds(
          ring
            .filter((c) => c[0] !== undefined && c[1] !== undefined)
            .map((c) => [c[1]!, c[0]!] as [number, number]),
        );
        if (!bounds.isValid()) return;
        map.flyToBounds(bounds, {
          padding: [padding, padding],
          maxZoom: Math.min(map.getMaxZoom(), TILE_MAX_ZOOM),
          duration: reducedMotion ? 0 : 0.9,
          animate: !reducedMotion,
        });
      },
      zoomBy(steps) {
        const map = mapRef.current;
        if (!map) return;
        map.setZoom(map.getZoom() + steps, { animate: !reducedMotion });
      },
      reset() {
        const map = mapRef.current;
        if (!map) return;
        map.setView(HOME, fitZoom(map) + OPENING_STEPS, { animate: !reducedMotion });
      },
      getZoom: () => (mapRef.current ? relativeScale(mapRef.current) : 1),
      canZoomIn: () => {
        const map = mapRef.current;
        return map ? map.getZoom() < map.getMaxZoom() - 0.01 : false;
      },
      canZoomOut: () => {
        const map = mapRef.current;
        return map ? map.getZoom() > map.getMinZoom() + 0.01 : false;
      },
    }),
    [reducedMotion],
  );

  return (
    <div
      ref={containerRef}
      className={`mm-map mm-map--${style}${opening ? ' mm-opening' : ''}${reducedMotion ? ' mm-reduced' : ''}`}
      role="application"
      aria-label={label}
      aria-describedby="mm-canvas-help"
      data-zoom={zoom.toFixed(2)}
    >
      <svg
        ref={baseSvgRef}
        className="mm-canvas mm-canvas--base"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {base}
      </svg>
      <svg
        ref={overlaySvgRef}
        className="mm-canvas mm-canvas--people"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {overlay}
      </svg>
    </div>
  );
});
