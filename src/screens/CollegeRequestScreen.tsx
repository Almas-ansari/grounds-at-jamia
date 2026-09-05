/**
 * "Bring this to your college."
 *
 * Somebody types their college in, and the page drafts a note asking for the
 * map to be built there. There is no server behind this and no table it writes
 * to: the draft is composed in the browser and handed to whichever mail client
 * the reader already has, so nothing is collected from anybody who changes
 * their mind and closes the tab. That also means it works on a static host with
 * no backend at all.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { draftMessage, mailtoLink, type CollegeRequest } from '../data/author';
import { MakerCredit } from '../components/ui/MakerCredit';

const EMPTY: CollegeRequest = { college: '', city: '', name: '', contact: '', note: '' };

export default function CollegeRequestScreen(): JSX.Element {
  const [form, setForm] = useState<CollegeRequest>(EMPTY);
  const [drafted, setDrafted] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const ready = form.college.trim().length >= 2;
  const message = useMemo(() => draftMessage(form, origin), [form, origin]);

  const set = (key: keyof CollegeRequest) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused; the message is on screen to select by hand */
    }
  };

  return (
    <main className="mm-desk min-h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-6 px-4 py-6 sm:py-10">
        <nav>
          <Link
            to="/"
            className="brass inline-block rounded-seal px-3 py-1.5 text-sm no-underline"
          >
            ← Back to the map
          </Link>
        </nav>

        <header className="sheet rounded-xl px-5 py-5">
          <h1 className="hand text-2xl text-ink sm:text-3xl">Bring this to your college</h1>
          <p className="mt-2 text-base text-ink">
            This map was drawn for Jamia Millia Islamia. The plan is to draw one for every campus in
            India — the same parchment, the same rule that nobody appears on it unless they choose
            to, and the streets and buildings of your own college underneath.
          </p>
          <p className="mt-2 text-base text-ink-faded">
            Tell me where you study and this page will write the note for you. Nothing is sent from
            here and nothing is stored: the draft opens in your own email, and you decide whether
            to send it.
          </p>
        </header>

        {/* --- the form --------------------------------------------------- */}
        <form
          className="sheet flex flex-col gap-4 rounded-xl px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) setDrafted(true);
          }}
        >
          <div>
            <label htmlFor="college" className="hand block text-lg text-ink">
              Your college <span className="text-ember">*</span>
            </label>
            <input
              id="college"
              required
              autoFocus
              value={form.college}
              onChange={(e) => set('college')(e.target.value)}
              placeholder="e.g. IIT Delhi"
              maxLength={120}
              className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="city" className="hand block text-lg text-ink">
                City
              </label>
              <input
                id="city"
                value={form.city}
                onChange={(e) => set('city')(e.target.value)}
                placeholder="New Delhi"
                maxLength={80}
                className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
              />
            </div>
            <div>
              <label htmlFor="your-name" className="hand block text-lg text-ink">
                Your name
              </label>
              <input
                id="your-name"
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                placeholder="Optional"
                maxLength={80}
                className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
              />
            </div>
          </div>

          <div>
            <label htmlFor="contact" className="hand block text-lg text-ink">
              How to reach you
            </label>
            <input
              id="contact"
              value={form.contact}
              onChange={(e) => set('contact')(e.target.value)}
              placeholder="Optional — email or phone"
              maxLength={120}
              className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
            />
          </div>

          <div>
            <label htmlFor="note" className="hand block text-lg text-ink">
              Anything else
            </label>
            <textarea
              id="note"
              value={form.note}
              onChange={(e) => set('note')(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="Optional — how many students, which gates matter, anything that would help."
              className="mt-1.5 w-full resize-y rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!ready} className="brass rounded-seal px-4 py-2.5 text-base">
              Write the note
            </button>
            {!ready && <span className="text-sm text-ink-faded">A college name is all it needs.</span>}
          </div>
        </form>

        {/* --- the drafted note -------------------------------------------- */}
        {drafted && ready && (
          <section className="sheet flex flex-col gap-3 rounded-xl px-5 py-5" aria-live="polite">
            <h2 className="hand text-xl text-ink">Your note</h2>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-seal border border-ink/25 bg-parchment-deep/25 px-3 py-2.5 font-ui text-sm text-ink">
              {message}
            </pre>
            <p className="text-sm text-ink-faded">
              Nothing has been sent. Pick how you would like to send it.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={mailtoLink(form, origin)}
                className="brass rounded-seal px-4 py-2.5 text-base no-underline"
              >
                Open in email
              </a>
              <button type="button" onClick={() => void copy()} className="brass rounded-seal px-4 py-2.5 text-base">
                {copied ? 'Copied' : 'Copy the note'}
              </button>
            </div>
          </section>
        )}

        {/* --- who you are writing to --------------------------------------- */}
        <section className="sheet rounded-xl px-5 py-5">
          <MakerCredit />
          <p className="mt-3 text-sm text-ink-faded">
            Or write directly, if you would rather skip the form.
          </p>
        </section>

        <p className="pb-4 text-center text-xs text-parchment-deep">
          Campus outlines after OpenStreetMap contributors, ODbL. Every other mark on the map was
          drawn for it.
        </p>
      </div>
    </main>
  );
}
