/**
 * "Report a bug."
 *
 * Two different things get called bugs here and they have two different fixes,
 * so the page says which is which. A building in the wrong place is not this
 * app's mistake to correct — the basemap is OpenStreetMap's, copied pixel for
 * pixel, so the fix belongs in OSM where it helps everybody. Anything else is
 * mine, and there is a form for it.
 *
 * Like the college page, nothing is sent from here: the note is drafted in the
 * browser and handed to the reader's own mail client.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUTHOR, bugMailtoLink, type BugReport } from '../data/author';
import { MakerCredit } from '../components/ui/MakerCredit';

const EMPTY: BugReport = { what: '', where: '', device: '' };

export default function BugReportScreen(): JSX.Element {
  const [form, setForm] = useState<BugReport>(EMPTY);
  const [copied, setCopied] = useState(false);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const ready = form.what.trim().length >= 8;
  const mailto = useMemo(() => bugMailtoLink(form, origin), [form, origin]);

  const set = (key: keyof BugReport) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(decodeURIComponent(mailto.split('body=')[1] ?? ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused */
    }
  };

  return (
    <main className="mm-desk min-h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-6 px-4 py-6 sm:py-10">
        <nav>
          <Link to="/" className="brass inline-block rounded-seal px-3 py-1.5 text-sm no-underline">
            ← Back to the map
          </Link>
        </nav>

        <header className="sheet rounded-xl px-5 py-5">
          <h1 className="hand text-2xl text-ink sm:text-3xl">Report a bug</h1>
          <p className="mt-2 text-base text-ink">
            Something not working, or somewhere drawn wrong? Tell me. But two different things get
            called bugs here, and one of them has a much better fix than emailing me.
          </p>
        </header>

        {/* --- the map data is not mine to correct ------------------------ */}
        <section className="sheet rounded-xl px-5 py-5">
          <h2 className="hand text-xl text-ink">A building is missing, misplaced or misspelled</h2>
          <p className="mt-2 text-base text-ink">
            That one is not really a bug in this app. The map underneath is OpenStreetMap, copied
            exactly — the only thing changed is the colour. Buildings, footpaths and names are all
            OSM’s, and Jamia is only partly surveyed there: of the 165 buildings mapped on campus,
            twelve have names.
          </p>
          <p className="mt-2 text-base text-ink-faded">
            So the fix is to correct it at the source, where it also improves every other map and
            app built on the same data — not just this one. It is a free account and an editor in
            the browser.
          </p>
          <a
            href={AUTHOR.osmEdit}
            target="_blank"
            rel="noreferrer noopener"
            className="brass mt-3 inline-block rounded-seal px-4 py-2.5 text-base no-underline"
          >
            Fix it on OpenStreetMap
          </a>
          <p className="mt-2 text-sm text-ink-faded">
            Edits show up here the next time the basemap is refreshed.
          </p>
        </section>

        {/* --- everything else is mine ------------------------------------ */}
        <section className="sheet flex flex-col gap-4 rounded-xl px-5 py-5">
          <div>
            <h2 className="hand text-xl text-ink">Anything else</h2>
            <p className="mt-1 text-sm text-ink-faded">
              A button that does nothing, a friend who will not appear, sign-in trouble, something
              that looks broken on your phone.
            </p>
          </div>

          <div>
            <label htmlFor="what" className="hand block text-lg text-ink">
              What happened? <span className="text-ember">*</span>
            </label>
            <textarea
              id="what"
              required
              autoFocus
              rows={4}
              maxLength={800}
              value={form.what}
              onChange={(e) => set('what')(e.target.value)}
              placeholder="What you did, and what happened instead of what you expected."
              className="mt-1.5 w-full resize-y rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="where" className="hand block text-lg text-ink">
                Where in the app
              </label>
              <input
                id="where"
                value={form.where}
                onChange={(e) => set('where')(e.target.value)}
                placeholder="Optional — Friends, Settings, the map…"
                maxLength={120}
                className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
              />
            </div>
            <div>
              <label htmlFor="device" className="hand block text-lg text-ink">
                Phone or browser
              </label>
              <input
                id="device"
                value={form.device}
                onChange={(e) => set('device')(e.target.value)}
                placeholder="Optional — iPhone Safari, Chrome…"
                maxLength={120}
                className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={ready ? mailto : undefined}
              aria-disabled={!ready}
              className={`brass rounded-seal px-4 py-2.5 text-base no-underline ${ready ? '' : 'pointer-events-none opacity-45'}`}
            >
              Send it to me
            </a>
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!ready}
              className="brass rounded-seal px-4 py-2.5 text-base"
            >
              {copied ? 'Copied' : 'Copy the report'}
            </button>
            {!ready && <span className="text-sm text-ink-faded">A sentence or two is enough.</span>}
          </div>
        </section>

        {/* --- for anybody who would rather just fix it -------------------- */}
        <section className="sheet rounded-xl px-5 py-5">
          <h2 className="hand text-xl text-ink">Developer? Fix it yourself</h2>
          <p className="mt-2 text-base text-ink">
            The whole thing is open — the map rendering, the privacy model, the migrations and the
            tests. Fork it, fix it, send a pull request. Issues are welcome too if you would rather
            just describe the problem.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={AUTHOR.repo}
              target="_blank"
              rel="noreferrer noopener"
              className="brass rounded-seal px-4 py-2.5 text-base no-underline"
            >
              The source on GitHub
            </a>
            <a
              href={`${AUTHOR.repo}/issues/new`}
              target="_blank"
              rel="noreferrer noopener"
              className="brass rounded-seal px-4 py-2.5 text-base no-underline"
            >
              Open an issue
            </a>
          </div>
        </section>

        <section className="sheet rounded-xl px-5 py-5">
          <MakerCredit />
        </section>

        <p className="pb-4 text-center text-xs text-parchment-deep">
          Basemap © OpenStreetMap contributors, ODbL.
        </p>
      </div>
    </main>
  );
}
