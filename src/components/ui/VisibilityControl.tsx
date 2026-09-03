/**
 * Three states, and a plain sentence about what each one actually means.
 *
 * The wording is deliberately concrete — "your 12 friends", "anyone at Jamia" —
 * because "friends only" tells nobody anything about who is looking.
 */
import type { VisibilityMode } from '../../lib/schemas';

interface VisibilityControlProps {
  readonly value: VisibilityMode;
  readonly friendCount: number;
  readonly disabled?: boolean;
  readonly onChange: (value: VisibilityMode) => void;
}

const OPTIONS: readonly { value: VisibilityMode; label: string }[] = [
  { value: 'ghost', label: 'Ghost' },
  { value: 'friends', label: 'Friends' },
  { value: 'public', label: 'Campus' },
];

export function describeVisibility(value: VisibilityMode, friendCount: number): string {
  switch (value) {
    case 'ghost':
      return 'Nobody can see you.';
    case 'friends':
      return friendCount === 0
        ? 'You have no friends yet, so nobody can see you.'
        : `Your ${friendCount} ${friendCount === 1 ? 'friend' : 'friends'} can see exactly where you are.`;
    case 'public':
      return 'Anyone at Jamia can see which building you are in.';
  }
}

export function VisibilityControl({
  value,
  friendCount,
  disabled = false,
  onChange,
}: VisibilityControlProps): JSX.Element {
  const index = OPTIONS.findIndex((o) => o.value === value);

  /** Arrow keys move between the three states, as a radio group should. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = OPTIONS[(index + delta + OPTIONS.length) % OPTIONS.length];
    if (next) onChange(next.value);
  };

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Who can see you"
        onKeyDown={onKeyDown}
        className="flex overflow-hidden rounded-seal border border-ink/40"
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
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`brass flex-1 px-3 py-2 text-sm ${active ? 'brass--pressed' : ''}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="mt-1.5 text-center text-sm text-ink-faded">
        {describeVisibility(value, friendCount)}
      </p>
    </div>
  );
}
