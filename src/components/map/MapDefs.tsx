/**
 * Every texture, filter, pattern and glyph the map is made of.
 *
 * All of it is generated here in SVG. There are no image files, no tile
 * server, and nothing traced from anybody else's artwork.
 *
 * A note on performance: feTurbulence over a 1600 × 1686 region is far too
 * expensive for a mid-range phone, so the grain and tooth are rendered once
 * into small tiles and repeated with <pattern>. `stitchTiles="stitch"` makes
 * the noise continuous across tile edges, so the repeat is invisible.
 */
import { memo } from 'react';
import { HEIGHT as SHEET_H, WIDTH as SHEET_W } from '../../lib/projection';

export const GRAIN_TILE = 320;

function MapDefsImpl(): JSX.Element {
  return (
    <defs>
      {/* ---------------------------------------------------------------
          Paper fibre. Low-frequency fractal noise pushed through a sepia
          matrix, so the grain is brown-on-brown rather than grey.
          --------------------------------------------------------------- */}
      <filter id="mm-grain" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.02"
          numOctaves={4}
          seed={7}
          stitchTiles="stitch"
          result="fibre"
        />
        <feColorMatrix
          in="fibre"
          type="matrix"
          values="0.44 0.18 0.06 0 0.10
                  0.32 0.16 0.05 0 0.07
                  0.19 0.10 0.04 0 0.04
                  0    0    0    0 0.62"
        />
      </filter>

      {/* Paper tooth: much finer, much fainter. This is what stops the
          parchment reading as a flat fill at close zoom. */}
      <filter id="mm-tooth" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves={2}
          seed={19}
          stitchTiles="stitch"
          result="tooth"
        />
        <feColorMatrix
          in="tooth"
          type="matrix"
          values="0 0 0 0 0.17
                  0 0 0 0 0.11
                  0 0 0 0 0.06
                  0 0 0 0.22 0"
        />
      </filter>

      <pattern id="mm-grain-tile" width={GRAIN_TILE} height={GRAIN_TILE} patternUnits="userSpaceOnUse">
        <rect width={GRAIN_TILE} height={GRAIN_TILE} filter="url(#mm-grain)" />
      </pattern>

      <pattern id="mm-tooth-tile" width={GRAIN_TILE} height={GRAIN_TILE} patternUnits="userSpaceOnUse">
        <rect width={GRAIN_TILE} height={GRAIN_TILE} filter="url(#mm-tooth)" />
      </pattern>

      {/* ---------------------------------------------------------------
          The quill. A small displacement applied to whole ink layers so no
          line is ever mathematically straight.
          --------------------------------------------------------------- */}
      <filter id="mm-quill" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves={3} seed={31} result="wobble" />
        <feDisplacementMap in="SourceGraphic" in2="wobble" scale={2.2} xChannelSelector="R" yChannelSelector="G" />
      </filter>

      {/* A gentler hand for fine work: labels, hatching, the compass. */}
      <filter id="mm-quill-fine" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves={2} seed={53} result="wobble" />
        <feDisplacementMap in="SourceGraphic" in2="wobble" scale={1.5} xChannelSelector="R" yChannelSelector="G" />
      </filter>

      {/* The torn edge. A much coarser displacement, applied only to the
          border path, so the sheet ends in a deckle rather than a ruled box. */}
      <filter id="mm-deckle" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves={4} seed={11} result="tear" />
        <feDisplacementMap in="SourceGraphic" in2="tear" scale={22} xChannelSelector="R" yChannelSelector="G" />
      </filter>

      {/* The shadow the sheet casts on the desk. */}
      <filter id="mm-sheet-shadow" x="-12%" y="-12%" width="124%" height="124%">
        <feGaussianBlur in="SourceAlpha" stdDeviation={16} />
        <feOffset dx={0} dy={10} result="cast" />
        <feFlood floodColor="#000" floodOpacity={0.55} />
        <feComposite in2="cast" operator="in" />
      </filter>

      {/* Ink bleed for the heaviest strokes — a wet nib on absorbent paper. */}
      <filter id="mm-bleed" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="soft" />
        <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves={2} seed={5} result="fuzz" />
        <feDisplacementMap in="soft" in2="fuzz" scale={1.6} xChannelSelector="R" yChannelSelector="G" />
      </filter>

      {/* ---------------------------------------------------------------
          Age. Radial washes at the corners; the sheet has sat in a drawer.
          --------------------------------------------------------------- */}
      {(
        [
          ['mm-age-tl', '0%', '0%'],
          ['mm-age-tr', '100%', '0%'],
          ['mm-age-bl', '0%', '100%'],
          ['mm-age-br', '100%', '100%'],
        ] as const
      ).map(([id, cx, cy]) => (
        <radialGradient key={id} id={id} cx={cx} cy={cy} r="72%">
          <stop offset="0%" stopColor="var(--sepia-wash)" stopOpacity="0.42" />
          <stop offset="42%" stopColor="var(--parchment-deep)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--parchment-deep)" stopOpacity="0" />
        </radialGradient>
      ))}

      {/* A fold crease: dark in the valley, a highlight on the ridge. */}
      <linearGradient id="mm-crease-v" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--parchment-deep)" stopOpacity="0" />
        <stop offset="38%" stopColor="var(--sepia-wash)" stopOpacity="0.20" />
        <stop offset="52%" stopColor="var(--ink)" stopOpacity="0.10" />
        <stop offset="64%" stopColor="var(--parchment)" stopOpacity="0.34" />
        <stop offset="100%" stopColor="var(--parchment-deep)" stopOpacity="0" />
      </linearGradient>

      <linearGradient id="mm-crease-h" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--parchment-deep)" stopOpacity="0" />
        <stop offset="38%" stopColor="var(--sepia-wash)" stopOpacity="0.18" />
        <stop offset="52%" stopColor="var(--ink)" stopOpacity="0.09" />
        <stop offset="64%" stopColor="var(--parchment)" stopOpacity="0.30" />
        <stop offset="100%" stopColor="var(--parchment-deep)" stopOpacity="0" />
      </linearGradient>

      {/* ---------------------------------------------------------------
          Building fills. Three hatch densities give the map its hierarchy:
          a faculty is inked harder than a shed.
          --------------------------------------------------------------- */}
      <pattern id="mm-hatch-3" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <path d="M0 0 V7" stroke="var(--ink)" strokeWidth={1.3} strokeOpacity={0.85} />
        <path d="M3.5 0 V7" stroke="var(--ink-faded)" strokeWidth={0.85} strokeOpacity={0.6} />
      </pattern>

      <pattern id="mm-hatch-2" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <path d="M0 0 V9" stroke="var(--ink-faded)" strokeWidth={1.05} strokeOpacity={0.68} />
      </pattern>

      <pattern id="mm-hatch-1" width={13} height={13} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <path d="M0 0 V13" stroke="var(--ink-faded)" strokeWidth={0.8} strokeOpacity={0.5} />
      </pattern>

      {/* Cross-hatch, reserved for the library and the faculties. */}
      <pattern id="mm-cross" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <path d="M0 0 V8" stroke="var(--ink)" strokeWidth={1.2} strokeOpacity={0.78} />
        <path d="M0 0 H8" stroke="var(--ink)" strokeWidth={0.9} strokeOpacity={0.52} />
      </pattern>

      {/* Stipple, for outbuildings that should sit back. */}
      <pattern id="mm-stipple" width={10} height={10} patternUnits="userSpaceOnUse">
        <circle cx={2} cy={2.6} r={0.75} fill="var(--ink-faded)" fillOpacity={0.7} />
        <circle cx={7.2} cy={5.4} r={0.62} fill="var(--ink-faded)" fillOpacity={0.62} />
        <circle cx={4.4} cy={8.6} r={0.58} fill="var(--ink-faded)" fillOpacity={0.55} />
      </pattern>

      {/* Grass: short scratched tufts rather than a flat green (there is no
          green in the palette, and there should not be). */}
      <pattern id="mm-grass" width={16} height={16} patternUnits="userSpaceOnUse" patternTransform="rotate(-6)">
        <path
          d="M2 14 q1.4 -4 0.6 -7 M6 15 q1.8 -5 1 -8 M10.5 14 q1.2 -4.5 0.4 -7.5 M14 15.5 q1.6 -4.6 0.8 -7.6"
          stroke="var(--ink-faded)"
          strokeWidth={0.8}
          strokeOpacity={0.6}
          fill="none"
          strokeLinecap="round"
        />
      </pattern>

      {/* A playing field: ruled lines, the way a surveyor would mark it. */}
      <pattern id="mm-pitch" width={12} height={12} patternUnits="userSpaceOnUse" patternTransform="rotate(-6)">
        <path d="M0 6 H12" stroke="var(--ink-faded)" strokeWidth={0.65} strokeOpacity={0.45} />
      </pattern>

      {/* Water: the old convention of parallel shore lines. */}
      <pattern id="mm-water" width={14} height={14} patternUnits="userSpaceOnUse">
        <path
          d="M0 4 q3.5 -2 7 0 t7 0 M0 10 q3.5 -2 7 0 t7 0"
          stroke="var(--ink-faded)"
          strokeWidth={0.6}
          strokeOpacity={0.42}
          fill="none"
        />
      </pattern>

      {/* ---------------------------------------------------------------
          The foot glyph. Drawn from scratch: a sole about 10 × 16 units with
          five toes. `mm-foot-r` is the right foot; the left is the same path
          mirrored at the point of use.
          --------------------------------------------------------------- */}
      <g id="mm-foot-r">
        <path
          d="M1.05 -6.2
             C 3.1 -5.4 4.0 -3.1 3.55 -0.85
             C 3.2 0.95 2.05 2.2 1.75 3.85
             C 1.45 5.5 2.15 6.55 1.35 7.45
             C 0.5 8.4 -1.75 8.35 -2.5 7.15
             C -3.2 6.0 -2.5 4.45 -2.7 2.9
             C -2.95 1.0 -3.85 -0.6 -3.5 -2.5
             C -3.15 -4.4 -1.15 -6.0 0.15 -6.15
             Z"
          fill="currentColor"
        />
        <ellipse cx={2.0} cy={-7.35} rx={1.05} ry={0.85} fill="currentColor" transform="rotate(14 2 -7.35)" />
        <ellipse cx={0.15} cy={-7.95} rx={0.72} ry={0.62} fill="currentColor" />
        <ellipse cx={-1.35} cy={-7.7} rx={0.62} ry={0.55} fill="currentColor" />
        <ellipse cx={-2.6} cy={-7.15} rx={0.55} ry={0.48} fill="currentColor" />
        <ellipse cx={-3.6} cy={-6.35} rx={0.46} ry={0.42} fill="currentColor" />
      </g>

      {/* ---------------------------------------------------------------
          A ribbon for a name banner: hand-drawn, with folded tails.
          --------------------------------------------------------------- */}
      <symbol id="mm-ribbon" viewBox="0 0 100 24" preserveAspectRatio="none">
        {/* Folded tails behind, then the face of the ribbon over them. */}
        <path
          d="M0 2 L7 6 L7 18 L0 22 Z M100 2 L93 6 L93 18 L100 22 Z"
          fill="var(--parchment-deep)"
          stroke="var(--ink)"
          strokeWidth={0.8}
          strokeOpacity={0.6}
          strokeLinejoin="round"
        />
        <path
          d="M6 4.4 Q4.2 12 6 19.6 L94 19.2 Q95.9 12 94 4.6 Z"
          fill="var(--parchment)"
          stroke="var(--ink)"
          strokeWidth={1}
          strokeOpacity={0.8}
          strokeLinejoin="round"
        />
      </symbol>

      {/* The edge of the sheet. The OSM extract reaches well past the framed
          estate, so everything drawn is clipped to the parchment — a map does
          not spill onto the desk. Slightly oversized so the deckle filter's
          own displacement is not sliced off. */}
      <clipPath id="mm-sheet-clip">
        <rect x={-14} y={-14} width={SHEET_W + 28} height={SHEET_H + 28} />
      </clipPath>
    </defs>
  );
}

export const MapDefs = memo(MapDefsImpl);
