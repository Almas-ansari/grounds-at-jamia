/**
 * Friendships, requests and blocks.
 *
 * Rows are stored canonically — requester_id < addressee_id, enforced by a
 * check constraint — so "who asked whom" is a property of the row, not of the
 * ordering. Everything below derives the direction from that.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import {
  blockSchema,
  friendshipSchema,
  profileSchema,
  safeRow,
  type Friendship,
  type Profile,
} from '../lib/schemas';

export interface FriendEdge {
  readonly other: Profile;
  readonly status: 'pending' | 'accepted';
  /** True when this user sent the request and is waiting on the other. */
  readonly outgoing: boolean;
}

interface FriendsState {
  loading: boolean;
  edges: readonly FriendEdge[];
  blocked: readonly Profile[];
  error: string | null;
  searchResults: readonly Profile[];
  searching: boolean;

  load: (selfId: string) => Promise<void>;
  search: (query: string, selfId: string) => Promise<void>;
  request: (selfId: string, otherId: string) => Promise<void>;
  accept: (selfId: string, otherId: string) => Promise<void>;
  remove: (selfId: string, otherId: string) => Promise<void>;
  block: (selfId: string, otherId: string) => Promise<void>;
  unblock: (selfId: string, otherId: string) => Promise<void>;
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

/**
 * Turn a PostgREST error into something a person can act on. Its own messages
 * name constraints and schema caches, which tell a reader nothing about what
 * they did or what to do next.
 */
function humanise(error: { code?: string; message: string } | null): string | null {
  if (!error) return null;
  if (error.code === 'PGRST205' || /schema cache/i.test(error.message)) {
    return 'This project has no database schema yet, so friends cannot work. Run the migration in supabase/migrations/.';
  }
  if (error.code === '23505') return 'You have already asked them.';
  if (error.code === '23514') return 'That request is not allowed.';
  if (error.code === '42501') return 'That is not yours to change.';
  return error.message;
}

/** The row key for a pair, in the canonical order the table requires. */
function pairKey(a: string, b: string): { requester_id: string; addressee_id: string } {
  return a < b ? { requester_id: a, addressee_id: b } : { requester_id: b, addressee_id: a };
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  loading: false,
  edges: [],
  blocked: [],
  error: null,
  searchResults: [],
  searching: false,

  load: async (selfId) => {
    if (!supabase || drivenByDevPreview()) return;
    set({ loading: true, error: null });

    // No filter needed on friendships: RLS already limits these to rows the
    // reader participates in. The filter here is only to avoid a wasted round
    // trip on a large table.
    const [{ data: rows, error }, { data: blockRows }] = await Promise.all([
      supabase.from('friendships').select('*').or(`requester_id.eq.${selfId},addressee_id.eq.${selfId}`),
      supabase.from('blocks').select('*'),
    ]);

    if (error) {
      set({ loading: false, error: humanise(error) });
      return;
    }

    const friendships = (rows ?? [])
      .map((row) => safeRow(friendshipSchema, row, 'friendship'))
      .filter((row): row is Friendship => row !== null);
    const blocks = (blockRows ?? [])
      .map((row) => safeRow(blockSchema, row, 'block'))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const otherIds = new Set<string>();
    for (const f of friendships) {
      otherIds.add(f.requester_id === selfId ? f.addressee_id : f.requester_id);
    }
    for (const b of blocks) otherIds.add(b.blocked_id);

    const profiles = new Map<string, Profile>();
    if (otherIds.size > 0) {
      const { data } = await supabase.from('profiles').select('*').in('id', [...otherIds]);
      for (const row of data ?? []) {
        const parsed = safeRow(profileSchema, row, 'profile');
        if (parsed) profiles.set(parsed.id, parsed);
      }
    }

    const edges: FriendEdge[] = [];
    for (const f of friendships) {
      const otherId = f.requester_id === selfId ? f.addressee_id : f.requester_id;
      const other = profiles.get(otherId);
      if (!other) continue;
      edges.push({ other, status: f.status, outgoing: f.requester_id === selfId });
    }

    set({
      loading: false,
      edges: edges.sort((a, b) => a.other.display_name.localeCompare(b.other.display_name)),
      blocked: blocks
        .map((b) => profiles.get(b.blocked_id))
        .filter((p): p is Profile => p !== undefined),
    });
  },

  search: async (query, selfId) => {
    if (!supabase || drivenByDevPreview()) return;
    const handle = query.trim().toLowerCase();
    if (handle.length < 2) {
      set({ searchResults: [], searching: false });
      return;
    }
    set({ searching: true });
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .ilike('handle', `${handle}%`)
      .neq('id', selfId)
      .limit(12);
    const results = (data ?? [])
      .map((row) => safeRow(profileSchema, row, 'profile'))
      .filter((row): row is Profile => row !== null);
    set({ searchResults: results, searching: false });
  },

  request: async (selfId, otherId) => {
    if (!supabase) return;
    const key = pairKey(selfId, otherId);
    // The policy only admits a row where you are the requester, so a pair
    // whose canonical requester is the *other* person cannot be created by
    // you — you have to be asked. Detect that and say so plainly.
    if (key.requester_id !== selfId) {
      const { error } = await supabase
        .from('friendships')
        .insert({ requester_id: selfId, addressee_id: otherId });
      set({ error: error ? 'That request must be sent from the other side.' : null });
      if (!error) await get().load(selfId);
      return;
    }
    const { error } = await supabase.from('friendships').insert({ ...key, status: 'pending' });
    set({ error: humanise(error) });
    await get().load(selfId);
  },

  accept: async (selfId, otherId) => {
    if (!supabase) return;
    const key = pairKey(selfId, otherId);
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('requester_id', key.requester_id)
      .eq('addressee_id', key.addressee_id);
    set({ error: humanise(error) });
    await get().load(selfId);
  },

  remove: async (selfId, otherId) => {
    if (!supabase) return;
    const key = pairKey(selfId, otherId);
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('requester_id', key.requester_id)
      .eq('addressee_id', key.addressee_id);
    set({ error: humanise(error) });
    await get().load(selfId);
  },

  block: async (selfId, otherId) => {
    if (!supabase) return;
    // The trigger dissolves any friendship in the same transaction.
    const { error } = await supabase.from('blocks').insert({ blocker_id: selfId, blocked_id: otherId });
    set({ error: humanise(error) });
    await get().load(selfId);
  },

  unblock: async (selfId, otherId) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('blocks')
      .delete()
      .eq('blocker_id', selfId)
      .eq('blocked_id', otherId);
    set({ error: humanise(error) });
    await get().load(selfId);
  },
}));
