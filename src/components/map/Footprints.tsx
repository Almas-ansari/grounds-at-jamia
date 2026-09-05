/**
 * Layer 8a: the footprints.
 *
 * Each print is a <use> of the one hand-drawn sole glyph, mirrored for the
 * other foot, rotated to the bearing of travel and offset to the correct side.
 * The fade in and the six-second dissolve are CSS animations, so a trail
 * dissolving costs React nothing at all — the component re-renders only when a
 * print is added or swept, never per frame.
 */
import { memo } from 'react';
import type { Print, TrailState } from '../../lib/trails';
import type { Wanderer } from '../../store/live';

interface FootprintsProps {
  readonly wanderers: Record<string, Wanderer>;
  readonly trails: Record<string, TrailState>;
  readonly reducedMotion: boolean;
}

function PrintGlyph({
  print,
  self,
  reducedMotion,
}: {
  print: Print;
  self: boolean;
  reducedMotion: boolean;
}): JSX.Element {
  const mirror = print.foot === 'left' ? -1 : 1;
  const className = print.stationary
    ? reducedMotion
      ? 'mm-print mm-print--still-static'
      : 'mm-print mm-print--still'
    : reducedMotion
      ? 'mm-print mm-print--static'
      : 'mm-print mm-print--walk';

  // The scale comes from --mm-foot, which MapCanvas rewrites inside its
  // animation frame. Zooming therefore resizes every print on the page without
  // React seeing a thing. It has to be a CSS transform rather than the SVG
  // attribute, because only CSS can read a custom property.
  return (
    <use
      href="#mm-foot-r"
      className={className}
      color={self ? 'var(--ember)' : 'var(--ink)'}
      style={{
        transform:
          `translate(${print.x.toFixed(2)}px, ${print.y.toFixed(2)}px) ` +
          `rotate(${print.angle.toFixed(1)}deg) ` +
          `scale(calc(var(--mm-foot, 2.5) * ${mirror}), var(--mm-foot, 2.5))`,
      }}
    />
  );
}

function FootprintsImpl({ wanderers, trails, reducedMotion }: FootprintsProps): JSX.Element {
  return (
    // No ink filter on this layer, on purpose: the sole is already a
    // hand-drawn shape, and running a displacement filter over every print on
    // every frame of a pan is the expensive way to achieve something nobody can
    // see at this size.
    <g className="mm-layer mm-layer--prints" aria-hidden="true">
      {Object.entries(trails).map(([userId, trail]) => {
        const wanderer = wanderers[userId];
        if (!wanderer) return null;
        return (
          // A lapsed trail is a memory, not a sighting, so it is drawn faintly
          // and fades further the longer it has been since they were seen.
          <g
            key={userId}
            opacity={
              wanderer.staleSince
                ? Math.max(0.16, 0.5 - (Date.now() - wanderer.staleSince) / 900_000)
                : wanderer.precise
                  ? 1
                  : 0.72
            }
          >
            {trail.prints.map((print) => (
              <PrintGlyph
                key={print.id}
                print={print}
                self={wanderer.isSelf}
                reducedMotion={reducedMotion}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

export const Footprints = memo(FootprintsImpl);
