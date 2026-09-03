/**
 * Layer 7: the things that make a sheet of paper a map — a torn border, a
 * compass rose, a scale bar, and a line of marginalia.
 */
import { memo } from 'react';
import { HEIGHT, METRES_PER_UNIT, WIDTH } from '../../lib/projection';

const MARGIN = 34;

/** A scale bar whose bar length is a round number of metres. */
const SCALE_METRES = 200;
const SCALE_UNITS = SCALE_METRES / METRES_PER_UNIT;

function CompassRose({ x, y, r }: { x: number; y: number; r: number }): JSX.Element {
  const pt = (angle: number, radius: number): string => {
    const a = ((angle - 90) * Math.PI) / 180;
    return `${(x + Math.cos(a) * radius).toFixed(2)} ${(y + Math.sin(a) * radius).toFixed(2)}`;
  };
  const star = (angle: number, long: number, short: number): string =>
    `M${pt(angle, long)} L${pt(angle + 45, short)} L${pt(angle + 90, long)} L${pt(angle + 45, short * 0.28)} Z`;

  return (
    <g filter="url(#mm-quill-fine)" className="mm-compass">
      <circle cx={x} cy={y} r={r} fill="var(--parchment)" fillOpacity={0.32} />
      <circle cx={x} cy={y} r={r} fill="none" stroke="var(--ink-faded)" strokeWidth={1.2} strokeOpacity={0.6} />
      <circle cx={x} cy={y} r={r * 0.78} fill="none" stroke="var(--ink-faded)" strokeWidth={0.7} strokeOpacity={0.45} />

      {/* Sixteen ticks, longer on the cardinals. */}
      {Array.from({ length: 16 }, (_, i) => i * 22.5).map((angle) => (
        <path
          key={angle}
          d={`M${pt(angle, r * 0.8)} L${pt(angle, angle % 90 === 0 ? r * 0.94 : r * 0.88)}`}
          stroke="var(--ink-faded)"
          strokeWidth={angle % 90 === 0 ? 1.1 : 0.6}
          strokeOpacity={0.6}
          strokeLinecap="round"
        />
      ))}

      {/* Diagonal points, then the cardinal star over them. */}
      <path d={star(45, r * 0.58, r * 0.16)} fill="var(--ink-faded)" fillOpacity={0.45} />
      <path d={star(135, r * 0.58, r * 0.16)} fill="var(--ink-faded)" fillOpacity={0.45} />
      <path d={star(0, r * 0.74, r * 0.2)} fill="var(--ink)" fillOpacity={0.55} />
      <path d={star(90, r * 0.74, r * 0.2)} fill="var(--ink)" fillOpacity={0.55} />
      {/* North, filled solid so it reads first. */}
      <path
        d={`M${pt(0, r * 0.74)} L${pt(20, r * 0.2)} L${pt(-20, r * 0.2)} Z`}
        fill="var(--ember)"
        fillOpacity={0.82}
      />
      <text
        x={x}
        y={y - r * 1.18}
        textAnchor="middle"
        className="mm-label"
        fontSize={17}
        fill="var(--ink)"
        fillOpacity={0.8}
      >
        N
      </text>
    </g>
  );
}

function ScaleBar({ x, y }: { x: number; y: number }): JSX.Element {
  const half = SCALE_UNITS / 2;
  return (
    <g filter="url(#mm-quill-fine)" className="mm-scale">
      <path
        d={`M${x} ${y - 5} V${y + 5} M${x} ${y} H${x + SCALE_UNITS} M${x + SCALE_UNITS} ${y - 5} V${y + 5} M${x + half} ${y - 3.5} V${y + 3.5}`}
        stroke="var(--ink)"
        strokeWidth={1.5}
        strokeOpacity={0.7}
        strokeLinecap="round"
        fill="none"
      />
      {/* Alternating chequer, the way a surveyor's scale is drawn. */}
      <rect x={x} y={y - 4} width={half / 2} height={8} fill="var(--ink)" fillOpacity={0.55} />
      <rect x={x + half} y={y - 4} width={half / 2} height={8} fill="var(--ink)" fillOpacity={0.55} />
      <text x={x} y={y - 11} className="mm-label" fontSize={14} fill="var(--ink)" fillOpacity={0.75}>
        0
      </text>
      <text
        x={x + SCALE_UNITS}
        y={y - 11}
        textAnchor="end"
        className="mm-label"
        fontSize={14}
        fill="var(--ink)"
        fillOpacity={0.75}
      >
        {SCALE_METRES} metres
      </text>
    </g>
  );
}

function MapFurnitureImpl({ marginNote }: { marginNote?: string | null }): JSX.Element {
  return (
    <g className="mm-layer mm-layer--furniture" aria-hidden="true">
      {/* The torn edge. A rounded rect run through a coarse displacement so
          the sheet ends in a deckle, not a ruled box. */}
      <g filter="url(#mm-deckle)">
        <rect
          x={MARGIN * 0.42}
          y={MARGIN * 0.42}
          width={WIDTH - MARGIN * 0.84}
          height={HEIGHT - MARGIN * 0.84}
          rx={12}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={5}
          strokeOpacity={0.34}
        />
      </g>

      {/* A double rule inside the tear. */}
      <g filter="url(#mm-quill)">
        <rect
          x={MARGIN}
          y={MARGIN}
          width={WIDTH - MARGIN * 2}
          height={HEIGHT - MARGIN * 2}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2.4}
          strokeOpacity={0.62}
        />
        <rect
          x={MARGIN + 8}
          y={MARGIN + 8}
          width={WIDTH - (MARGIN + 8) * 2}
          height={HEIGHT - (MARGIN + 8) * 2}
          fill="none"
          stroke="var(--ink-faded)"
          strokeWidth={0.9}
          strokeOpacity={0.5}
        />
        {/* Corner flourishes. */}
        {(
          [
            [MARGIN + 8, MARGIN + 8, 1, 1],
            [WIDTH - MARGIN - 8, MARGIN + 8, -1, 1],
            [MARGIN + 8, HEIGHT - MARGIN - 8, 1, -1],
            [WIDTH - MARGIN - 8, HEIGHT - MARGIN - 8, -1, -1],
          ] as const
        ).map(([cx, cy, sx, sy]) => (
          <path
            key={`${cx}-${cy}`}
            d={`M${cx} ${cy + sy * 40} q0 ${-sy * 28} ${sx * 28} ${-sy * 28} q${sx * 12} 0 ${sx * 12} ${sy * 11}`}
            fill="none"
            stroke="var(--ink-faded)"
            strokeWidth={1.3}
            strokeOpacity={0.55}
            strokeLinecap="round"
          />
        ))}
      </g>

      <text
        x={WIDTH / 2}
        y={MARGIN + 42}
        textAnchor="middle"
        className="mm-label mm-title"
        fontSize={30}
        fill="var(--ink)"
        fillOpacity={0.72}
      >
        Jamia Millia Islamia
      </text>
      <text
        x={WIDTH / 2}
        y={MARGIN + 66}
        textAnchor="middle"
        className="mm-label"
        fontSize={15}
        fill="var(--ink-faded)"
        fillOpacity={0.75}
      >
        the grounds at Okhla, surveyed and inked
      </text>

      <CompassRose x={WIDTH - MARGIN - 96} y={MARGIN + 108} r={58} />
      <ScaleBar x={MARGIN + 52} y={HEIGHT - MARGIN - 46} />

      {/* Marginalia. The empty state lives here rather than in a modal. */}
      {marginNote && (
        <text
          x={WIDTH - MARGIN - 44}
          y={HEIGHT - MARGIN - 46}
          textAnchor="end"
          className="mm-label mm-marginalia"
          fontSize={19}
          fill="var(--ink-faded)"
          fillOpacity={0.8}
        >
          {marginNote}
        </text>
      )}

      <text
        x={MARGIN + 52}
        y={HEIGHT - MARGIN - 18}
        className="mm-label"
        fontSize={11.5}
        fill="var(--ink-faded)"
        fillOpacity={0.55}
      >
        outlines after OpenStreetMap contributors, ODbL
      </text>
    </g>
  );
}

export const MapFurniture = memo(MapFurnitureImpl);
