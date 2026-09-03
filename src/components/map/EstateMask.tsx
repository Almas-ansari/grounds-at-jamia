/**
 * Everything that is not Jamia, covered over.
 *
 * The basemap does not stop at the university gates — it carries on into Okhla
 * and Batla House, which is not what this map is about. So a cover is laid over
 * the whole sheet and the estate is punched out of it with the even-odd fill
 * rule: one outer rectangle, one hole.
 *
 * That hole is `ESTATE_OUTLINE`, a single ring precomputed from the union of
 * the two campus blocks, dilated to keep the approaches. Doing it that way
 * matters for performance: the earlier version used an SVG <mask> holding
 * several wide-stroked paths, and a mask forces an offscreen buffer that is
 * re-rasterised on every step of a zoom. This is one path, and the compositor
 * has nothing to recompute while the map moves.
 */
import { memo } from 'react';
import { HEIGHT, WIDTH, pathFromCoordinates } from '../../lib/projection';
import { ESTATE_OUTLINE } from '../../data/estate';

/** Enough that a hard pan never reveals an uncovered corner. */
const BLEED = 700;

const HOLE = pathFromCoordinates(ESTATE_OUTLINE, true);
const COVER =
  `M${-BLEED} ${-BLEED} L${WIDTH + BLEED} ${-BLEED} L${WIDTH + BLEED} ${HEIGHT + BLEED} ` +
  `L${-BLEED} ${HEIGHT + BLEED} Z ${HOLE}`;

function EstateMaskImpl(): JSX.Element {
  return (
    <g className="mm-layer mm-layer--mask" aria-hidden="true">
      <path d={COVER} fillRule="evenodd" fill="var(--wood)" />
      {/* The edge of the grounds, drawn rather than merely cut. */}
      <path
        d={HOLE}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2.4}
        strokeOpacity={0.38}
        strokeDasharray="22 8 5 8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
}

export const EstateMask = memo(EstateMaskImpl);
