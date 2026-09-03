/**
 * Find a place on the grounds.
 *
 * The zone list is short and known, so this is a plain substring match with a
 * combobox around it — no index, no fuzzy library. Arrow keys move through the
 * results and Enter takes you there, because a search box you cannot drive from
 * the keyboard is half a search box.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { zones, type Zone } from '../../data/zones';

interface PlaceSearchProps {
  readonly onChoose: (zone: Zone) => void;
  readonly selectedZoneId: string | null;
}

const KIND_LABEL: Record<Zone['kind'], string> = {
  faculty: 'Faculty',
  library: 'Library',
  hall: 'Hall',
  gallery: 'Gallery',
  ground: 'Ground',
  refectory: 'Canteen',
  masjid: 'Masjid',
  infirmary: 'Clinic',
  residence: 'Residence',
  gate: 'Gate',
};

export function PlaceSearch({ onChoose, selectedZoneId }: PlaceSearchProps): JSX.Element {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? zones.filter(
          (z) => z.name.toLowerCase().includes(needle) || KIND_LABEL[z.kind].toLowerCase().includes(needle),
        )
      : zones;
    // Whole-word starts first: typing "law" should not put "Ekistics" above it.
    return [...pool]
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
        const bs = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
        if (as !== bs) return as - bs;
        if (a.importance !== b.importance) return b.importance - a.importance;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (zone: Zone | undefined): void => {
    if (!zone) return;
    onChoose(zone);
    setQuery(zone.name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="pointer-events-auto relative w-full max-w-sm">
      <div className="sheet flex items-center gap-2 rounded-seal px-3 py-2">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0 text-ink-faded">
          <circle cx="10.5" cy="10.5" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15.4 15.4 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active]!.id}` : undefined}
          value={query}
          placeholder="Find a place on the grounds"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(results[active]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-faded/70"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="shrink-0 rounded px-1 text-ink-faded hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Places on the grounds"
          className="sheet absolute inset-x-0 top-full z-10 mt-1.5 max-h-72 overflow-y-auto rounded-seal py-1"
        >
          {results.map((zone, index) => (
            <li key={zone.id}>
              <button
                type="button"
                id={`${listId}-${zone.id}`}
                role="option"
                aria-selected={zone.id === selectedZoneId}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(zone)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left ${
                  index === active ? 'bg-parchment-deep/60' : ''
                }`}
              >
                <span className="hand min-w-0 truncate text-base text-ink">{zone.name}</span>
                <span className="shrink-0 text-xs text-ink-faded">
                  {KIND_LABEL[zone.kind]}
                  {zone.approximate ? ' · approx.' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { KIND_LABEL };
