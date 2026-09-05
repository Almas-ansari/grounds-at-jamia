/**
 * Publishing your own location — the only place in the app that writes one.
 *
 * The rules it enforces on the way out:
 *   ghost   → both rows cleared, immediately, and nothing is watched.
 *   public  → a zone id, and nothing else. No coordinate is ever sent.
 *   friends → a zone id and a precise fix, which only accepted friends can read.
 *
 * Publishing is throttled by movement, not by a timer, with a 45 s heartbeat so
 * the 90 s server TTL never expires somebody sitting still in the library.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { VisibilityMode } from '../lib/schemas';
import {
  OFF_CAMPUS_ZONE_ID,
  PUBLISH_HEARTBEAT_MS,
  shouldPublish,
  startWatching,
  type Fix,
  type GeoError,
  type PublishState,
  type Watcher,
} from '../lib/geo';
import type { Zone } from '../data/zones';

/** The server rejects precise fixes closer together than this; stay clear of it. */
const MIN_FIX_INTERVAL_MS = 3200;

interface GeoStoreState {
  watching: boolean;
  fix: Fix | null;
  zone: Zone | null;
  offCampus: boolean;
  error: GeoError | null;
  lastPublishedAt: number | null;

  start: (userId: string, visibility: VisibilityMode) => void;
  stop: () => void;
  setVisibility: (userId: string, visibility: VisibilityMode) => Promise<void>;
  clearRows: (userId: string) => Promise<void>;
  /** Fired when one of your own prints lands, so the quill can scratch. */
  onOwnPrint: (() => void) | null;
  setOnOwnPrint: (fn: (() => void) | null) => void;
}

let watcher: Watcher | null = null;
let lastPublish: PublishState | null = null;
let lastFixWriteAt = 0;
let currentVisibility: VisibilityMode = 'ghost';
let currentUserId: string | null = null;
let unloadHandlers: (() => void) | null = null;

/** The slice of the Wake Lock API this needs, without pulling in lib.dom's. */
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
let wakeLock: WakeLockSentinelLike | null = null;

/**
 * A fix older than this is no longer worth publishing. Long enough to ride out
 * a browser throttling a background tab, short enough that nobody is shown
 * somewhere they have already left.
 */
const STALE_FIX_MS = 75_000;

/**
 * Clear both rows on the way out of the page. `fetch(..., { keepalive: true })`
 * is the one request that reliably survives a backgrounded mobile tab, and
 * unlike sendBeacon it can carry the Authorization header PostgREST needs.
 */
function clearRowsBeacon(userId: string, accessToken: string): void {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  void fetch(`${url}/rest/v1/live_fixes?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers,
    keepalive: true,
  }).catch(() => undefined);
  void fetch(`${url}/rest/v1/live_presence?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers,
    keepalive: true,
  }).catch(() => undefined);
}

export const useGeoStore = create<GeoStoreState>((set, get) => ({
  watching: false,
  fix: null,
  zone: null,
  offCampus: false,
  error: null,
  lastPublishedAt: null,
  onOwnPrint: null,

  setOnOwnPrint: (fn) => set({ onOwnPrint: fn }),

  clearRows: async (userId) => {
    if (!supabase) return;
    await supabase.from('live_fixes').delete().eq('user_id', userId);
    // Deleted, not updated to ghost. Realtime evaluates the SELECT policy
    // against the *new* row on an UPDATE, and a ghost row fails it — so an
    // update is filtered out and watchers are never told the person left. A
    // DELETE is authorised against the old row, which they could see, so it
    // reaches them. Measured: watchers drop the person in about 400 ms.
    await supabase.from('live_presence').delete().eq('user_id', userId);
    lastPublish = null;
    set({ lastPublishedAt: null });
  },

  setVisibility: async (userId, visibility) => {
    currentVisibility = visibility;
    if (!supabase) return;

    if (visibility === 'ghost') {
      get().stop();
      await get().clearRows(userId);
      return;
    }

    // Upsert rather than update: a presence row may not exist yet if the
    // account predates the trigger that creates one.
    await supabase.from('live_presence').upsert({ user_id: userId, visibility }, { onConflict: 'user_id' });
    if (visibility === 'public') {
      // Leaving `friends` for `public` must take the coordinates with it.
      await supabase.from('live_fixes').delete().eq('user_id', userId);
    }
    get().start(userId, visibility);
  },

  start: (userId, visibility) => {
    currentUserId = userId;
    currentVisibility = visibility;
    if (visibility === 'ghost') return;
    if (get().watching) return;

    watcher = startWatching({
      onFix: (fix, zone, offCampus) => {
        set({ fix, zone, offCampus, error: null });
        void publish(fix, zone, offCampus, get);
      },
      onError: (error) => set({ error }),
    });

    /**
     * Stay on the map until the tab is actually closed.
     *
     * Backgrounding used to clear the rows on `visibilitychange`, which meant
     * glancing at a message took you off everyone's map. Now only a real
     * departure — `pagehide`, which fires on close, reload and navigation —
     * clears them.
     *
     * The honesty catch: a backgrounded tab often stops receiving fixes at all,
     * especially on mobile. Heartbeating through that would keep a row alive
     * that says somebody is somewhere they may have left ten minutes ago. So
     * `publish` refuses to heartbeat a stale fix, and the 90 s TTL retires the
     * row instead. Being absent from the map is a smaller lie than being in the
     * wrong place on it.
     */
    const handlePageHide = (): void => {
      const id = currentUserId;
      if (!id || !supabase) return;
      void supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        if (token) clearRowsBeacon(id, token);
      });
    };
    window.addEventListener('pagehide', handlePageHide);

    /**
     * Ask the screen to stay awake while sharing. A locked screen suspends the
     * page and with it the position watch, so this is the one lever a web app
     * has to keep itself running. Best effort: it needs a secure context, the
     * browser may refuse it, and it is released automatically when the tab is
     * hidden — hence the re-acquire below.
     */
    const requestWakeLock = async (): Promise<void> => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        wakeLock = await nav.wakeLock.request('screen');
      } catch {
        // Refused, unsupported, or the battery is low. Not worth reporting.
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    void requestWakeLock();

    unloadHandlers = () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
    };

    set({ watching: true });
  },

  stop: () => {
    watcher?.stop();
    watcher = null;
    unloadHandlers?.();
    unloadHandlers = null;
    lastPublish = null;
    set({ watching: false, fix: null, zone: null, offCampus: false });
  },
}));

async function publish(
  fix: Fix,
  zone: Zone | null,
  offCampus: boolean,
  get: () => GeoStoreState,
): Promise<void> {
  if (!supabase || !currentUserId || currentVisibility === 'ghost') return;

  // A heartbeat exists to stop the TTL retiring somebody who is still there.
  // If the last fix is old — a throttled background tab, a lost signal — then
  // we no longer know that they are, and the row should be allowed to expire.
  if (Date.now() - fix.timestamp > STALE_FIX_MS) return;

  const zoneId = offCampus ? OFF_CAMPUS_ZONE_ID : (zone?.id ?? null);
  const candidate: PublishState = { point: fix, zoneId, at: fix.timestamp };
  const decision = shouldPublish(lastPublish, candidate, { heartbeatMs: PUBLISH_HEARTBEAT_MS });
  if (!decision.publish) return;

  const presence = await supabase
    .from('live_presence')
    .upsert({ user_id: currentUserId, visibility: currentVisibility, zone_id: zoneId }, { onConflict: 'user_id' });
  if (presence.error) return;

  // Off campus, or in public mode, no coordinate leaves the device — and any
  // coordinate already on the server is removed rather than left to expire.
  if (offCampus || currentVisibility !== 'friends') {
    if (lastPublish === null || lastPublish.zoneId !== zoneId) {
      await supabase.from('live_fixes').delete().eq('user_id', currentUserId);
    }
  } else {
    const now = Date.now();
    if (now - lastFixWriteAt >= MIN_FIX_INTERVAL_MS) {
      lastFixWriteAt = now;
      const { error } = await supabase.from('live_fixes').upsert(
        {
          user_id: currentUserId,
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy,
          bearing: fix.bearing,
        },
        { onConflict: 'user_id' },
      );
      if (!error) get().onOwnPrint?.();
    }
  }

  lastPublish = candidate;
  get();
  useGeoStore.setState({ lastPublishedAt: Date.now() });
}
