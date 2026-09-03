/**
 * A sheet of paper slid up over the map. Modal, dismissible with Escape or the
 * backdrop, and it returns focus where it found it.
 */
import { useEffect, useRef, type ReactNode } from 'react';

interface DrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function Drawer({ open, title, onClose, children }: DrawerProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocus.current = document.activeElement;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('[data-autofocus], button, input, select, a[href]')?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      (restoreFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet relative flex max-h-[86vh] w-full max-w-lg flex-col rounded-t-xl sm:rounded-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink/20 px-5 py-3.5">
          <h2 className="hand text-xl text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="brass rounded-seal px-3 py-1.5 text-sm"
            aria-label={`Close ${title}`}
          >
            Close
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
