/**
 * Who is holding the map, and what they have consented to.
 *
 * `visibility` is mirrored here for the UI, but it is never the authority: the
 * authority is the row in `live_presence`, and the policies that read it.
 */
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { clearAuthErrorFromUrl, initialAuthError, isConfigured, supabase } from '../lib/supabase';
import { profileSchema, safeRow, type Profile, type VisibilityMode } from '../lib/schemas';

export type MotionPreference = 'system' | 'full' | 'reduced';

interface SessionState {
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  visibility: VisibilityMode;
  soundEnabled: boolean;
  motionPreference: MotionPreference;
  /**
   * True when nobody is signed in — no project configured, or signed out.
   * Strictly about identity, not about whether the backend works: a signed-in
   * user with a broken database is *not* in demo mode, and must not be shown
   * invented people as though they were real.
   */
  demo: boolean;
  /**
   * Signed in, but the database has no schema — the migration was never run.
   * Worth its own state because the symptom otherwise is a silently half-working
   * app rather than an error anybody can act on.
   */
  schemaMissing: boolean;
  /** What the identity provider said, when a sign-in came back refused. */
  authError: string | null;
  error: string | null;
  dismissAuthError: () => void;

  init: () => Promise<void>;
  setVisibility: (visibility: VisibilityMode) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setMotionPreference: (preference: MotionPreference) => void;
  updateProfile: (patch: {
    display_name?: string;
    faculty?: string | null;
    handle?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const MOTION_KEY = 'mm.motion';
const SOUND_KEY = 'mm.sound';

function readLocal<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing; the preference simply does not persist */
  }
}

interface ProfileLookup {
  readonly profile: Profile | null;
  /** True when the `profiles` table does not exist — the migration has not run. */
  readonly schemaMissing: boolean;
}

/**
 * Make a profile for somebody who has none.
 *
 * The `on_auth_user_created` trigger does this for every new sign-up, but it
 * cannot help an account that already existed when the migration was applied —
 * and an account with no profile row is a mostly-dead app: Settings renders
 * nothing, the friend list cannot load, and nobody can find you by handle.
 * So the client repairs it. RLS allows exactly this insert and no other:
 * `profiles_insert_self` requires id = auth.uid().
 */
async function createMissingProfile(user: User): Promise<Profile | null> {
  if (!supabase) return null;

  const base =
    (user.email ?? 'wanderer')
      .split('@')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 16) || 'wanderer';
  const displayName =
    (user.user_metadata?.['full_name'] as string | undefined) ??
    (user.user_metadata?.['name'] as string | undefined) ??
    (user.email ?? 'A Wanderer').split('@')[0]!;

  // The handle is unique, so a collision is expected rather than exceptional.
  for (let attempt = 0; attempt < 6; attempt++) {
    const handle = attempt === 0 ? base : `${base.slice(0, 15)}${attempt}`;
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        display_name: displayName.slice(0, 32) || 'A Wanderer',
        handle: handle.length >= 3 ? handle : `${handle}ink`,
      })
      .select()
      .maybeSingle();

    if (!error && data) {
      // Ghost, like every other new account. Nobody appears without saying so.
      await supabase
        .from('live_presence')
        .upsert({ user_id: user.id, visibility: 'ghost' }, { onConflict: 'user_id' });
      return safeRow(profileSchema, data, 'profile');
    }
    if (error?.code !== '23505') return null;
  }
  return null;
}

async function loadProfile(userId: string): Promise<ProfileLookup> {
  if (!supabase) return { profile: null, schemaMissing: false };
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  // PGRST205 is PostgREST's "no such table". Worth distinguishing from "no such
  // row": one means the project was never set up, the other is a real bug.
  const schemaMissing = error?.code === 'PGRST205' || /schema cache/i.test(error?.message ?? '');
  if (error || !data) return { profile: null, schemaMissing };
  return { profile: safeRow(profileSchema, data, 'profile'), schemaMissing: false };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  ready: false,
  user: null,
  profile: null,
  visibility: 'ghost',
  soundEnabled: readLocal<'on' | 'off'>(SOUND_KEY, 'off') === 'on',
  motionPreference: readLocal<MotionPreference>(MOTION_KEY, 'system'),
  demo: true,
  schemaMissing: false,
  authError: initialAuthError,
  error: null,

  init: async () => {
    // A dev preview has already put a fake session in place; do not race it.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')) {
      set({ ready: true });
      return;
    }
    if (!isConfigured || !supabase) {
      set({ ready: true, demo: true });
      return;
    }

    const apply = async (session: Session | null): Promise<void> => {
      const user = session?.user ?? null;
      if (!user) {
        set({ ready: true, user: null, profile: null, demo: true, visibility: 'ghost', schemaMissing: false });
        return;
      }
      const lookup = await loadProfile(user.id);
      const schemaMissing = lookup.schemaMissing;
      // Signed in, schema present, but no row: repair it rather than leaving a
      // half-working app.
      const profile = lookup.profile ?? (schemaMissing ? null : await createMissingProfile(user));
      // Read back the row rather than assuming: the account may have been
      // ghosted from another device.
      const { data: presence } = await supabase!
        .from('live_presence')
        .select('visibility')
        .eq('user_id', user.id)
        .maybeSingle();
      set({
        ready: true,
        user,
        profile,
        schemaMissing,
        // Signed in, so not a demo — even if the schema is missing. The map
        // stays empty and says why, rather than filling up with invented
        // people who look exactly like real ones.
        demo: false,
        soundEnabled: profile?.sound_enabled ?? get().soundEnabled,
        visibility: (presence?.visibility as VisibilityMode | undefined) ?? 'ghost',
      });
    };

    const { data } = await supabase.auth.getSession();
    await apply(data.session);
    supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session);
    });
  },

  dismissAuthError: () => {
    clearAuthErrorFromUrl();
    set({ authError: null });
  },

  setVisibility: (visibility) => set({ visibility }),

  setSoundEnabled: (enabled) => {
    writeLocal(SOUND_KEY, enabled ? 'on' : 'off');
    set({ soundEnabled: enabled });
    const { user } = get();
    if (user && supabase) {
      void supabase.from('profiles').update({ sound_enabled: enabled }).eq('id', user.id);
    }
  },

  setMotionPreference: (preference) => {
    writeLocal(MOTION_KEY, preference);
    set({ motionPreference: preference });
  },

  updateProfile: async (patch) => {
    const { user, profile } = get();
    if (!user || !supabase || !profile) return { ok: false, message: 'Not signed in.' };
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (error) {
      // 23505 is a unique violation, which for this table means the handle is
      // taken. Saying so beats surfacing the raw constraint name.
      const message =
        error.code === '23505'
          ? `The handle @${patch.handle ?? ''} is already taken.`
          : error.code === '23514'
            ? 'Handles are 3–20 characters: lower-case letters, digits and underscore.'
            : error.message;
      set({ error: message });
      return { ok: false, message };
    }
    set({ profile: { ...profile, ...patch }, error: null });
    return { ok: true };
  },

  signOut: async () => {
    if (!supabase) return;
    // Leave no trace on the map on the way out.
    const { user } = get();
    if (user) {
      await supabase.from('live_fixes').delete().eq('user_id', user.id);
      // Deleted rather than set to ghost, so watchers are pushed a DELETE and
      // drop you at once. An update to ghost is invisible to them by policy.
      await supabase.from('live_presence').delete().eq('user_id', user.id);
    }
    await supabase.auth.signOut();
    set({ user: null, profile: null, demo: true, visibility: 'ghost', schemaMissing: false });
  },

  deleteAccount: async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc('delete_own_account');
    if (error) {
      set({ error: error.message });
      return;
    }
    await supabase.auth.signOut();
    set({ user: null, profile: null, demo: true, visibility: 'ghost' });
  },
}));

/** Resolved motion preference: the user's override wins over the OS setting. */
export function useReducedMotion(): boolean {
  const preference = useSessionStore((s) => s.motionPreference);
  if (preference === 'reduced') return true;
  if (preference === 'full') return false;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
