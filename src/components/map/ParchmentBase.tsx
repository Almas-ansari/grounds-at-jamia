/**
 * Layers 1 and 2: the sheet itself, and the creases where it was folded.
 */
import { memo } from 'react';
import { HEIGHT, WIDTH } from '../../lib/projection';

/** Thirds, plus one off-centre crease so the folding is not too tidy. */
const V_CREASES = [WIDTH / 3, (WIDTH * 2) / 3, WIDTH * 0.845];
const H_CREASES = [HEIGHT / 3, (HEIGHT * 2) / 3];
const CREASE_W = 26;

function ParchmentBaseImpl(): JSX.Element {
  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--parchment)" />

      {/* Fibre grain, then the finer tooth over it. */}
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#mm-grain-tile)" opacity={0.55} />
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#mm-tooth-tile)" opacity={0.5} />

      {/* Age darkening, heaviest at the corners where hands have held it. */}
      {['mm-age-tl', 'mm-age-tr', 'mm-age-bl', 'mm-age-br'].map((id) => (
        <rect key={id} x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id})`} />
      ))}

      {/* A wash along the deckled edge. */}
      <rect
        x={0}
        y={0}
        width={WIDTH}
        height={HEIGHT}
        fill="none"
        stroke="var(--sepia-wash)"
        strokeWidth={54}
        strokeOpacity={0.16}
        filter="url(#mm-quill)"
      />

      {/* Creases. Two vertical thirds, one horizontal, and a stray fourth. */}
      {V_CREASES.map((x) => (
        <rect
          key={`v${x}`}
          x={x - CREASE_W / 2}
          y={0}
          width={CREASE_W}
          height={HEIGHT}
          fill="url(#mm-crease-v)"
        />
      ))}
      {H_CREASES.map((y) => (
        <rect
          key={`h${y}`}
          x={0}
          y={y - CREASE_W / 2}
          width={WIDTH}
          height={CREASE_W}
          fill="url(#mm-crease-h)"
        />
      ))}
    </g>
  );
}

export const ParchmentBase = memo(ParchmentBaseImpl);
