/**
 * The Supabase client.
 *
 * Two things matter here beyond the usual boilerplate:
 *
 *  1. The realtime socket is authenticated with the user's access token and
 *     re-authenticated on every token refresh. Supabase evaluates RLS against
 *     that token for `postgres_changes`, so an authenticated subscription to
 *     `live_fixes` only ever *receives* rows the reader's policies admit.
 *     An unauthenticated socket receives nothing at all. This is why the app
 *     does no visibility filtering of its own: there is nothing to filter.
 *
 *  2. Missing env vars are not a crash. Without credentials the app runs in
 *     demo mode: the campus renders, invented wanderers walk it, and no real
 *     person's location is involved.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey && !url.includes('your-project-ref'));

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-application-name': 'marauders-map-jamia' } },
    })
  : null;

/**
 * An OAuth round trip that fails comes back as ?error=…&error_description=…
 * rather than as a session. Read it once, before anything strips the URL, so
 * the app can say what went wrong instead of silently landing the user back on
 * the map as though they had never pressed the button.
 */
export const initialAuthError: string | null = (() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const description = params.get('error_description') ?? hash.get('error_description');
  const code = params.get('error') ?? hash.get('error');
  if (!code && !description) return null;
  return description ? decodeURIComponent(description.replace(/\+/g, ' ')) : code;
})();

/** Take the error out of the address bar once it has been read. */
export function clearAuthErrorFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const key of ['error', 'error_code', 'error_description', 'code', 'state']) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, '', url.pathname + url.search);
}

if (supabase) {
  // Keep the websocket's credentials current, or a refreshed token leaves the
  // socket authorised under a stale JWT and RLS starts rejecting live rows.
  supabase.auth.onAuthStateChange((_event, session) => {
    void supabase.realtime.setAuth(session?.access_token ?? null);

    // The PKCE redirect comes back as ?code=…&state=…. supabase-js has already
    // exchanged it by the time this fires, so clear it out of the address bar —
    // leaving it there means a reload tries to redeem a spent code and errors.
    if (session && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('code') || url.searchParams.has('error')) {
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        url.searchParams.delete('error');
        url.searchParams.delete('error_description');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    }
  });
}

/** Narrow `supabase` at a call site that genuinely requires a signed-in backend. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
