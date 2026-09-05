/**
 * Whose footprints you want on the map.
 *
 * This is a **view filter, not a privacy control**, and the distinction matters
 * enough to keep the two apart in the interface. Everything this can show was
 * already sent by the server because the reader's policies admitted it; all
 * this does is decide how much of it to draw. Who can see *you* is a different
 * question with real consequences, and it lives in Settings.
 */
export type Audience = 'friends' | 'everyone';

interface AudienceFilterProps {
  readonly value: Audience;
  readonly onChange: (value: Audience) => void;
  readonly friendsShown: number;
  readonly everyoneShown: number;
}

const OPTIONS: readonly { value: Audience; label: string }[] = [
  { value: 'friends', label: 'My friends' },
  { value: 'everyone', label: 'All magicians of Jamia' },
];

export function AudienceFilter({
  value,
  onChange,
  friendsShown,
  everyoneShown,
}: AudienceFilterProps): JSX.Element {
  const index = OPTIONS.findIndex((o) => o.value === value);
  const shown = value === 'friends' ? friendsShown : everyoneShown;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const delta: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = delta[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    if (next) onChange(next.value);
  };

  const summary =
    shown === 0
      ? value === 'friends'
        ? 'none of them are out'
        : 'no one is out'
      : `${shown} on the map`;

  return (
    <div>
      {/* Label and count on one line: the strip is the only thing standing
          between the reader and the map, so it should ask for as little of the
          screen as it can. */}
      <p id="audience-label" className="text-center text-sm text-ink-faded">
        <span className="hand text-base text-ink">Who do you want to see?</span>{' '}
        <span aria-live="polite">· {summary}</span>
      </p>
      <div
        role="radiogroup"
        aria-labelledby="audience-label"
        onKeyDown={onKeyDown}
        className="mt-1.5 flex overflow-hidden rounded-seal border border-ink/40"
      >
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={`brass flex-1 px-2 py-2 text-sm ${active ? 'brass--pressed' : ''}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
