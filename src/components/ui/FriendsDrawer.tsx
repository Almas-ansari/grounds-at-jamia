/**
 * Friends: your own handle to share, a search to find theirs, and the state of
 * every request in both directions.
 *
 * Whether a friend is on the map right now is read from the live store, which
 * is to say from the rows the server chose to send. Somebody in ghost mode
 * simply is not there, and this list says "not on the map" without explaining
 * why — that distinction is theirs to disclose, not ours.
 */
import { useEffect, useMemo, useState } from 'react';
import { Drawer } from './Drawer';
import { useFriendsStore } from '../../store/friends';
import { useLiveStore } from '../../store/live';
import { useSessionStore } from '../../store/session';
import { zoneName } from '../../data/zones';
import type { Profile } from '../../lib/schemas';

interface FriendsDrawerProps {
  readonly open: boolean;
  readonly selfId: string | null;
  readonly onClose: () => void;
  readonly onLocate: (lat: number, lng: number) => void;
}

function Person({
  profile,
  subtitle,
  children,
}: {
  readonly profile: Profile;
  readonly subtitle: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-ink/15 py-2 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="hand block truncate text-base leading-tight text-ink">
          {profile.display_name}
        </span>
        <span className="block truncate text-sm text-ink-faded">{subtitle}</span>
      </span>
      <span className="flex shrink-0 gap-1.5">{children}</span>
    </li>
  );
}

export function FriendsDrawer({ open, selfId, onClose, onLocate }: FriendsDrawerProps): JSX.Element {
  const { edges, blocked, error, searchResults, searching, load, search, request, accept, remove, block, unblock } =
    useFriendsStore();
  const wanderers = useLiveStore((s) => s.wanderers);
  const myHandle = useSessionStore((s) => s.profile?.handle ?? null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && selfId) void load(selfId);
  }, [open, selfId, load]);

  useEffect(() => {
    if (!selfId) return undefined;
    const t = setTimeout(() => void search(query, selfId), 220);
    return () => clearTimeout(t);
  }, [query, selfId, search]);

  const accepted = useMemo(() => edges.filter((e) => e.status === 'accepted'), [edges]);
  const incoming = useMemo(() => edges.filter((e) => e.status === 'pending' && !e.outgoing), [edges]);
  const outgoing = useMemo(() => edges.filter((e) => e.status === 'pending' && e.outgoing), [edges]);
  const known = useMemo(() => new Set(edges.map((e) => e.other.id)), [edges]);
  const unseen = searchResults.filter((p) => !known.has(p.id));

  const copyHandle = async (): Promise<void> => {
    if (!myHandle) return;
    try {
      await navigator.clipboard.writeText(`@${myHandle}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard refused; the handle is on screen to read */
    }
  };

  return (
    <Drawer open={open} title="Friends" onClose={onClose}>
      {!selfId ? (
        <p className="text-base text-ink-faded">
          Sign in to keep a list of friends. Nothing about you is stored until you do.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {error && (
            <p role="alert" className="rounded-seal border border-ember/50 px-3 py-2 text-sm text-ember">
              {error}
            </p>
          )}

          {/* --- your own handle, so there is something to share --------- */}
          {myHandle && (
            <section className="rounded-seal border border-ink/25 bg-parchment-deep/25 px-3 py-2.5">
              <p className="text-sm text-ink-faded">People find you by your handle</p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="hand truncate text-xl text-ink">@{myHandle}</span>
                <button
                  type="button"
                  onClick={() => void copyHandle()}
                  className="brass shrink-0 rounded-seal px-3 py-1.5 text-sm"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </section>
          )}

          {/* --- add someone --------------------------------------------- */}
          <section>
            <label htmlFor="friend-search" className="hand block text-lg text-ink">
              Add a friend by handle
            </label>
            <div className="mt-2 flex items-center rounded-seal border border-ink/40 bg-parchment pl-3">
              <span aria-hidden="true" className="hand select-none text-lg text-ink-faded">
                @
              </span>
              <input
                id="friend-search"
                data-autofocus
                value={query}
                onChange={(e) => setQuery(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="their_handle"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                className="w-full min-w-0 bg-transparent px-1 py-2.5 text-base text-ink outline-none placeholder:text-ink-faded/60"
              />
            </div>

            {query.length > 0 && query.length < 2 && (
              <p className="mt-2 text-sm text-ink-faded">Keep typing — at least two characters.</p>
            )}
            {searching && <p className="mt-2 text-sm text-ink-faded">Looking…</p>}
            {!searching && query.length >= 2 && unseen.length === 0 && (
              <p className="mt-2 text-sm text-ink-faded">
                {searchResults.length > 0
                  ? 'You already know everyone matching that.'
                  : `Nobody here is called @${query}.`}
              </p>
            )}

            <ul className="mt-1">
              {unseen.map((profile) => (
                <Person
                  key={profile.id}
                  profile={profile}
                  subtitle={`@${profile.handle}${profile.faculty ? ` · ${profile.faculty}` : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => void request(selfId, profile.id)}
                    className="brass rounded-seal px-3 py-1.5 text-sm"
                  >
                    Add
                  </button>
                </Person>
              ))}
            </ul>
          </section>

          {/* --- requests waiting on you --------------------------------- */}
          {/* Always rendered, even when empty. A section that only appears once
              somebody has written to you is a section nobody can find, and
              "where are my friend requests" is then a fair question. */}
          <section>
            <h3 className="hand text-lg text-ink">
              Friend requests{' '}
              {incoming.length > 0 && <span className="text-ink-faded">({incoming.length})</span>}
            </h3>
            {incoming.length === 0 ? (
              <p className="mt-1 text-sm text-ink-faded">
                Nobody has asked to be your friend yet. When they do, they will appear here to
                accept or decline.
              </p>
            ) : (
              <ul className="mt-1">
                {incoming.map((edge) => (
                  <Person key={edge.other.id} profile={edge.other} subtitle={`@${edge.other.handle}`}>
                    <button
                      type="button"
                      onClick={() => void accept(selfId, edge.other.id)}
                      className="brass rounded-seal px-3 py-1.5 text-sm"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(selfId, edge.other.id)}
                      className="brass rounded-seal px-3 py-1.5 text-sm"
                    >
                      Decline
                    </button>
                  </Person>
                ))}
              </ul>
            )}
          </section>

          {/* --- your friends -------------------------------------------- */}
          <section>
            <h3 className="hand text-lg text-ink">
              Your friends {accepted.length > 0 && <span className="text-ink-faded">({accepted.length})</span>}
            </h3>
            {accepted.length === 0 ? (
              <p className="mt-1 text-sm text-ink-faded">
                Nobody yet. Share your handle above, or add someone by theirs.
              </p>
            ) : (
              <ul className="mt-1">
                {accepted.map((edge) => {
                  const wanderer = wanderers[edge.other.id];
                  const where = wanderer ? (zoneName(wanderer.zoneId) ?? 'somewhere on the grounds') : null;
                  return (
                    <Person
                      key={edge.other.id}
                      profile={edge.other}
                      subtitle={where ? `On the map — ${where}` : 'Not on the map'}
                    >
                      <button
                        type="button"
                        disabled={!wanderer}
                        onClick={() => {
                          if (!wanderer) return;
                          onLocate(wanderer.point.lat, wanderer.point.lng);
                          onClose();
                        }}
                        className="brass rounded-seal px-3 py-1.5 text-sm"
                      >
                        Find
                      </button>
                      <details className="relative">
                        <summary className="brass flex cursor-pointer list-none items-center rounded-seal px-2.5 py-1.5 text-sm">
                          <span aria-hidden="true">···</span>
                          <span className="sr-only">More actions for {edge.other.display_name}</span>
                        </summary>
                        <div className="sheet absolute right-0 z-10 mt-1 flex w-40 flex-col gap-1 rounded-seal p-1.5">
                          <button
                            type="button"
                            onClick={() => void remove(selfId, edge.other.id)}
                            className="brass rounded-seal px-3 py-1.5 text-left text-sm"
                          >
                            Remove friend
                          </button>
                          <button
                            type="button"
                            onClick={() => void block(selfId, edge.other.id)}
                            className="brass rounded-seal px-3 py-1.5 text-left text-sm text-ember"
                          >
                            Block
                          </button>
                        </div>
                      </details>
                    </Person>
                  );
                })}
              </ul>
            )}
          </section>

          {/* --- requests you sent --------------------------------------- */}
          {outgoing.length > 0 && (
            <section>
              <h3 className="hand text-lg text-ink">Asked, no answer yet</h3>
              <ul className="mt-1">
                {outgoing.map((edge) => (
                  <Person key={edge.other.id} profile={edge.other} subtitle={`@${edge.other.handle}`}>
                    <button
                      type="button"
                      onClick={() => void remove(selfId, edge.other.id)}
                      className="brass rounded-seal px-3 py-1.5 text-sm"
                    >
                      Withdraw
                    </button>
                  </Person>
                ))}
              </ul>
            </section>
          )}

          {/* --- blocked -------------------------------------------------- */}
          {blocked.length > 0 && (
            <section className="border-t border-ink/20 pt-4">
              <h3 className="hand text-lg text-ink">Blocked</h3>
              <p className="mt-0.5 text-sm text-ink-faded">
                They cannot see you and you cannot see them. Any friendship between you was dissolved.
              </p>
              <ul className="mt-1">
                {blocked.map((profile) => (
                  <Person key={profile.id} profile={profile} subtitle={`@${profile.handle}`}>
                    <button
                      type="button"
                      onClick={() => void unblock(selfId, profile.id)}
                      className="brass rounded-seal px-3 py-1.5 text-sm"
                    >
                      Unblock
                    </button>
                  </Person>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
