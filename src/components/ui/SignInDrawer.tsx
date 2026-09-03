/**
 * Signing in.
 *
 * Two ways in, both plainly labelled, and an honest sentence about what
 * changes when you do: the map itself is the same either way — what changes is
 * whether the people on it are real.
 */
import { useState, type FormEvent } from 'react';
import { Drawer } from './Drawer';
import { isConfigured, supabase } from '../../lib/supabase';

interface SignInDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function SignInDrawer({ open, onClose }: SignInDrawerProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withGoogle = async (): Promise<void> => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/map` },
    });
    if (err) setError(err.message);
    setBusy(false);
  };

  const withEmail = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/map` },
    });
    if (err) setError(err.message);
    else setSent(true);
    setBusy(false);
  };

  return (
    <Drawer open={open} title="Sign in" onClose={onClose}>
      {!isConfigured ? (
        <div className="flex flex-col gap-3 text-base text-ink">
          <p>
            This copy of the map has no database behind it, so there is nobody to sign in as. The
            campus is real and the wanderers are invented.
          </p>
          <p className="text-sm text-ink-faded">
            To connect one: copy <span className="hand">.env.example</span> to{' '}
            <span className="hand">.env.local</span>, fill in your Supabase project URL and anon
            key, and reload.
          </p>
        </div>
      ) : sent ? (
        <p className="text-base text-ink">
          A sign-in link is on its way to <span className="hand">{email}</span>. Open it on this
          device and you will land back on the map.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base text-ink">
            Signing in lets you see friends who are really on the grounds, and lets them see you —
            but only once you say so. New accounts start as ghosts.
          </p>

          <button
            type="button"
            data-autofocus
            onClick={() => void withGoogle()}
            disabled={busy}
            className="brass flex items-center justify-center gap-2.5 rounded-seal px-4 py-3 text-base"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M21.6 12.2c0-.7-.06-1.35-.18-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.75 3-4.32 3-7.3Z"
                fill="currentColor"
                opacity="0.9"
              />
              <path
                d="M12 22c2.7 0 4.96-.9 6.6-2.43l-3.2-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.8-1.76-5.6-4.12H3.1v2.58A10 10 0 0 0 12 22Z"
                fill="currentColor"
                opacity="0.65"
              />
              <path
                d="M6.4 13.9a6 6 0 0 1 0-3.8V7.52H3.1a10 10 0 0 0 0 8.96l3.3-2.58Z"
                fill="currentColor"
                opacity="0.45"
              />
              <path
                d="M12 5.9c1.47 0 2.79.5 3.83 1.5l2.84-2.84C16.95 2.98 14.7 2 12 2A10 10 0 0 0 3.1 7.52l3.3 2.58C7.2 7.74 9.4 5.9 12 5.9Z"
                fill="currentColor"
                opacity="0.8"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 text-sm text-ink-faded">
            <span className="h-px flex-1 bg-ink/25" />
            or
            <span className="h-px flex-1 bg-ink/25" />
          </div>

          <form onSubmit={(e) => void withEmail(e)} className="flex flex-col gap-2">
            <label htmlFor="signin-email" className="hand text-lg text-ink">
              Sign in by email
            </label>
            <div className="flex gap-2">
              <input
                id="signin-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@jmi.ac.in"
                className="min-w-0 flex-1 rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
              />
              <button type="submit" disabled={busy} className="brass shrink-0 rounded-seal px-4 py-2.5 text-base">
                Send link
              </button>
            </div>
          </form>

          {error && (
            <p role="alert" className="text-sm text-ember">
              {error}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
