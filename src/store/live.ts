/**
 * Everyone currently abroad on the grounds.
 *
 * The client performs NO visibility filtering. It selects `live_presence` and
 * `live_fixes` without a `where` clause and subscribes to both tables, and the
 * database returns exactly the rows the reader is entitled to — the initial
 * SELECT through RLS, the live updates through RLS applied to the authenticated
 * realtime subscription. If a row arrives here, the server decided it should.
 *
 * A precise fix outranks a coarse presence: friends see where you are, everyone
 * else sees which building you are in, scattered inside its footprint.
 */
import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useSessionStore } from './session';
import {
  liveFixSchema,
  livePresenceSchema,
  profileSchema,
  safeRow,
  type LiveFix,
  type LivePresence,
  type Profile,
} from '../lib/schemas';
import { OFF_CAMPUS_ZONE_ID, zoneById } from '../data/zones';
import { jitteredZonePoint } from '../lib/geo';
import type { LngLat } from '../lib/projection';
import {
  advanceTrail,
  interpolate,
  plantTrail,
  pruneTrail,
  type Motion,
  type TrailState,
} from '../lib/trails';
import { project } from '../lib/projection';

export interface Wanderer {
  readonly userId: string;
  readonly displayName: string;
  readonly handle: string;
  readonly isSelf: boolean;
  /** True when this came from live_fixes — an actual coordinate from a friend. */
  readonly precise: boolean;
  readonly point: LngLat;
  readonly zoneId: string | null;
  readonly bearing: number | null;
  readonly updatedAt: number;
  /**
   * When their row lapsed, if it has. Null while they are live.
   *
   * A person can leave the map two very different ways, and conflating them
   * loses real information. Going ghost, signing out or closing the tab sends a
   * DELETE — a deliberate departure, and they are gone at once. Simply going
   * quiet — a backgrounded tab, a lost signal, a phone in a pocket — sends
   * nothing at all; the row just expires. That second case is worth showing as
   * a fading "last seen", because a friend who was in the library four minutes
   * ago is still useful to know about.
   *
   * Nothing is retained on the server for this. The row is deleted there on
   * schedule exactly as before; this is the viewer's own screen keeping a
   * decaying memory of something it was already entitled to be told.
   */
  readonly staleSince: number | null;
}

interface LiveState {
  wanderers: Record<string, Wanderer>;
  trails: Record<string, TrailState>;
  connected: boolean;
  start: (selfId: string) => Promise<void>;
  stop: () => void;
  /** Used by demo mode, which has no server to talk to. */
  setWanderers: (list: readonly Wanderer[]) => void;
  /**
   * Lay footprints. Called on a steady tick rather than when positions arrive,
   * so the trail keeps an even cadence however irregularly the updates come.
   */
  tickTrails: () => void;
  prune: () => void;
}

/**
 * Where each person is between the last two positions we were given. Held
 * outside React because it changes several times a second and nothing renders
 * from it directly — the trail does.
 */
const motion = new Map<string, Motion>();
/** A sensible crossing time when we have nothing to go on yet. */
const DEFAULT_CROSSING_MS = 1500;
/** Updates further apart than this are treated as a jump, not a walk. */
const MAX_CROSSING_MS = 6000;

let channel: RealtimeChannel | null = null;
let presenceRows = new Map<string, LivePresence>();
let fixRows = new Map<string, LiveFix>();
let profiles = new Map<string, Profile>();
let selfUserId: string | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
/** When each lapsed row stopped being fresh. */
const staleAt = new Map<string, number>();
/** How long a quiet person keeps fading before the map forgets them. */
const STALE_KEEP_MS = 5 * 60_000;

function toWanderer(userId: string): Wanderer | null {
  const presence = presenceRows.get(userId);
  const fix = fixRows.get(userId);
  const profile = profiles.get(userId);
  if (!profile) return null;

  const base = {
    userId,
    displayName: profile.display_name,
    handle: profile.handle,
    isSelf: userId === selfUserId,
  };

  if (fix) {
    return {
      ...base,
      precise: true,
      point: { lat: fix.lat, lng: fix.lng },
      zoneId: presence?.zone_id ?? null,
      bearing: fix.bearing,
      updatedAt: Date.parse(fix.updated_at),
      staleSince: staleAt.get(userId) ?? null,
    };
  }

  if (!presence || presence.visibility === 'ghost') return null;
  if (!presence.zone_id || presence.zone_id === OFF_CAMPUS_ZONE_ID) return null;
  const zone = zoneById.get(presence.zone_id);
  if (!zone) return null;

  return {
    ...base,
    precise: false,
    // Public mode never puts a coordinate on the server. This scatter is
    // computed here, from the zone everyone is already entitled to see.
    point: jitteredZonePoint(zone, userId),
    zoneId: presence.zone_id,
    bearing: null,
    updatedAt: Date.parse(presence.updated_at),
    staleSince: staleAt.get(userId) ?? null,
  };
}

/**
 * The dev preview supplies its own state. A real fetch would overwrite it with
 * whatever the project says about a user id that does not exist there, so the
 * network stands down while it is driving. `import.meta.env.DEV` is a constant
 * at build time, so this whole check disappears from a production bundle.
 */
function drivenByDevPreview(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('preview')
  );
}

export const useLiveStore = create<LiveState>((set, get) => ({
  wanderers: {},
  trails: {},
  connected: false,

  setWanderers: (list) => {
    const now = Date.now();
    const wanderers: Record<string, Wanderer> = {};
    const trails = { ...get().trails };

    for (const w of list) {
      wanderers[w.userId] = w;
      const to = project(w.point.lat, w.point.lng);
      const previous = motion.get(w.userId);

      if (!previous) {
        // Somebody new: plant them where they are, rather than sliding them in
        // from wherever the map happens to have its origin.
        motion.set(w.userId, { from: to, to, startedAt: now, duration: 0 });
        trails[w.userId] = plantTrail(to, now, w.userId);
        continue;
      }

      // Carry on from where they are *now*, not from the last reported point,
      // so a late update does not make anybody jump backwards.
      const from = interpolate(previous, now);
      const elapsed = now - previous.startedAt;
      motion.set(w.userId, {
        from,
        to,
        startedAt: now,
        duration: Math.min(MAX_CROSSING_MS, Math.max(400, elapsed || DEFAULT_CROSSING_MS)),
      });
      if (!trails[w.userId]) trails[w.userId] = plantTrail(to, now, w.userId);
    }

    for (const id of Object.keys(trails)) {
      if (!wanderers[id]) {
        delete trails[id];
        motion.delete(id);
      }
    }
    for (const id of [...motion.keys()]) {
      if (!wanderers[id]) motion.delete(id);
    }

    set({ wanderers, trails });
  },

  tickTrails: () => {
    const now = Date.now();
    const { wanderers, trails } = get();
    let changed = false;
    const next: Record<string, TrailState> = {};

    for (const [id, trail] of Object.entries(trails)) {
      if (!wanderers[id]) continue;
      const m = motion.get(id);
      const advanced = m ? advanceTrail(trail, interpolate(m, now), now, id) : pruneTrail(trail, now);
      if (advanced !== trail) changed = true;
      next[id] = advanced;
    }

    if (changed || Object.keys(next).length !== Object.keys(trails).length) set({ trails: next });
  },

  prune: () => {
    const now = Date.now();
    const trails = get().trails;
    let changed = false;
    const next: Record<string, TrailState> = {};
    for (const [id, trail] of Object.entries(trails)) {
      const pruned = pruneTrail(trail, now);
      if (pruned !== trail) changed = true;
      next[id] = pruned;
    }
    if (changed) set({ trails: next });
  },

  start: async (selfId) => {
    if (!supabase || drivenByDevPreview()) return;
    get().stop();
    selfUserId = selfId;
    presenceRows = new Map();
    fixRows = new Map();
    profiles = new Map();

    const refresh = (): void => {
      const ids = new Set([...presenceRows.keys(), ...fixRows.keys()]);
      const list: Wanderer[] = [];
      for (const id of ids) {
        const w = toWanderer(id);
        if (w) list.push(w);
      }
      get().setWanderers(list);
    };

    const ensureProfiles = async (ids: readonly string[]): Promise<void> => {
      const missing = ids.filter((id) => !profiles.has(id));
      if (missing.length === 0) return;
      const { data } = await supabase!.from('profiles').select('*').in('id', missing);
      for (const row of data ?? []) {
        const parsed = safeRow(profileSchema, row, 'profile');
        if (parsed) profiles.set(parsed.id, parsed);
      }
    };

    // No filters, deliberately: the policies are the filter.
    const [presenceResult, fixResult] = await Promise.all([
      supabase.from('live_presence').select('*'),
      supabase.from('live_fixes').select('*'),
    ]);

    for (const row of presenceResult.data ?? []) {
      const parsed = safeRow(livePresenceSchema, row, 'presence');
      if (parsed) presenceRows.set(parsed.user_id, parsed);
    }
    for (const row of fixResult.data ?? []) {
      const parsed = safeRow(liveFixSchema, row, 'fix');
      if (parsed) fixRows.set(parsed.user_id, parsed);
    }
    await ensureProfiles([...presenceRows.keys(), ...fixRows.keys()]);
    refresh();

    channel = supabase
      .channel('marauders-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_presence' },
        (payload) => {
          void (async () => {
            if (payload.eventType === 'DELETE') {
              const id = (payload.old as { user_id?: string }).user_id;
              if (id) {
                presenceRows.delete(id);
                staleAt.delete(id);
              }
            } else {
              const parsed = safeRow(livePresenceSchema, payload.new, 'presence');
              if (parsed) {
                presenceRows.set(parsed.user_id, parsed);
                await ensureProfiles([parsed.user_id]);
              }
            }
            refresh();
          })();
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_fixes' }, (payload) => {
        void (async () => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { user_id?: string }).user_id;
            if (id) {
              fixRows.delete(id);
              staleAt.delete(id);
            }
          } else {
            const parsed = safeRow(liveFixSchema, payload.new, 'fix');
            if (parsed) {
              fixRows.set(parsed.user_id, parsed);
              await ensureProfiles([parsed.user_id]);
            }
          }
          refresh();
        })();
      })
      .subscribe((status) => set({ connected: status === 'SUBSCRIBED' }));

    // Expiry pushes nothing — the row simply lapses — so it is swept locally.
    // A lapse is not a departure: it is marked stale and left to fade, and only
    // forgotten once it is old enough to be no use to anybody.
    pruneTimer = setInterval(() => {
      const now = Date.now();
      let dirty = false;

      // Off by default: without it a lapsed row is simply forgotten, which is
      // how this behaved before and is the more private of the two.
      const keepLastSeen = useSessionStore.getState().showLastSeen;

      const lapsed = (id: string, expiresAt: string): boolean => {
        if (Date.parse(expiresAt) > now) {
          if (staleAt.delete(id)) dirty = true;
          return false;
        }
        if (!keepLastSeen) return true;
        if (!staleAt.has(id)) {
          staleAt.set(id, now);
          dirty = true;
        }
        return now - (staleAt.get(id) ?? now) > STALE_KEEP_MS;
      };

      for (const [id, row] of presenceRows) {
        if (lapsed(id, row.expires_at)) {
          presenceRows.delete(id);
          staleAt.delete(id);
          dirty = true;
        }
      }
      for (const [id, row] of fixRows) {
        if (lapsed(id, row.expires_at)) {
          fixRows.delete(id);
          staleAt.delete(id);
          dirty = true;
        }
      }
      if (dirty) refresh();
      get().prune();
    }, 1000);
  },

  stop: () => {
    if (channel && supabase) {
      void supabase.removeChannel(channel);
      channel = null;
    }
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    selfUserId = null;
    motion.clear();
    staleAt.clear();
    set({ wanderers: {}, trails: {}, connected: false });
  },
}));
