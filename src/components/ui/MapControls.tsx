/**
 * The instruments that sit on the map itself: zoom, and find me.
 *
 * A map you cannot zoom without a trackpad is not usable on a phone, so these
 * are ordinary buttons with ordinary focus rings — brass-pressed rather than
 * circular grey chips, but doing exactly what a reader expects them to do.
 */
import type { BasemapStyle } from '../map/MapCanvas';

interface MapControlsProps {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onRecentre: () => void;
  readonly onFit: () => void;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly locateLabel: string;
  readonly style: BasemapStyle;
  readonly onToggleStyle: () => void;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onRecentre,
  onFit,
  canZoomIn,
  canZoomOut,
  locateLabel,
  style,
  onToggleStyle,
}: MapControlsProps): JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-[11.5rem] right-3 z-20 flex flex-col items-end gap-1.5 sm:bottom-[9.5rem]">
      <div className="pointer-events-auto flex flex-col overflow-hidden rounded-seal border border-ink/40">
        <button
          type="button"
          onClick={onZoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in"
          className="brass h-10 w-10 text-xl leading-none"
        >
          +
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out"
          className="brass h-10 w-10 border-t border-ink/30 text-xl leading-none"
        >
          −
        </button>
      </div>

      <button
        type="button"
        onClick={onRecentre}
        aria-label={locateLabel}
        title={locateLabel}
        className="brass pointer-events-auto flex h-10 w-10 items-center justify-center rounded-seal"
      >
        {/* A surveyor's mark: crosshair with an open centre. */}
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="1.9" fill="var(--ember)" />
          <path
            d="M12 1.6v4.2M12 18.2v4.2M1.6 12h4.2M18.2 12h4.2"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        onClick={onToggleStyle}
        aria-pressed={style === 'inked'}
        aria-label={style === 'surveyed' ? 'Switch to the inked drawing' : 'Switch to the surveyed map'}
        title={style === 'surveyed' ? 'Inked drawing' : 'Surveyed map'}
        className={`brass pointer-events-auto flex h-10 w-10 items-center justify-center rounded-seal ${
          style === 'inked' ? 'brass--pressed' : ''
        }`}
      >
        {/* A quill nib: the switch between the surveyed map and the drawn one. */}
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <path
            d="M4.5 19.5 8 16M19 4.6c-3.4.5-7.6 2.4-9.9 4.7-1.7 1.7-2.3 3.9-2.5 5.4l3 3c1.5-.2 3.7-.8 5.4-2.5 2.3-2.3 4.2-6.5 4.7-9.9-.2-.5-.4-.6-.7-.7Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        type="button"
        onClick={onFit}
        aria-label="Show the whole sheet"
        title="Show the whole sheet"
        className="brass pointer-events-auto flex h-10 w-10 items-center justify-center rounded-seal"
      >
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <rect
            x="3.5"
            y="4.5"
            width="17"
            height="15"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path d="M9 4.5v15M15 4.5v15" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2.5 2.5" />
        </svg>
      </button>
    </div>
  );
}
