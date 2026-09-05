/**
 * A lapse and a departure must not look the same.
 *
 * Going ghost is a decision, and it has to be honoured immediately and
 * completely — no fading trail, no "last seen", nothing. Going quiet is not a
 * decision at all: a backgrounded tab or a lost signal, where showing a friend
 * as last seen four minutes ago is genuinely useful. The store tells them apart
 * by *how* the row went away, and this pins that down.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useLiveStore, type Wanderer } from '../src/store/live';
import { useSessionStore } from '../src/store/session';

const person = (id: string, staleSince: number | null): Wanderer => ({
  userId: id,
  displayName: `Person ${id}`,
  handle: `p_${id}`,
  isSelf: false,
  precise: true,
  point: { lat: 28.5625, lng: 77.2815 },
  zoneId: 'zakir-husain-library',
  bearing: 0,
  updatedAt: Date.now(),
  staleSince,
});

describe('last seen', () => {
  beforeEach(() => {
    useLiveStore.setState({ wanderers: {}, trails: {} });
  });

  it('is off unless the reader turns it on', () => {
    expect(useSessionStore.getState().showLastSeen).toBe(false);
  });

  it('a deliberate departure leaves nothing on the map', () => {
    const { setWanderers } = useLiveStore.getState();
    setWanderers([person('a', null), person('b', null)]);
    expect(Object.keys(useLiveStore.getState().wanderers)).toHaveLength(2);

    // What a DELETE does: the person is simply not in the next set.
    setWanderers([person('a', null)]);
    const after = useLiveStore.getState();
    expect(after.wanderers['b'], 'a ghost must not linger as "last seen"').toBeUndefined();
    expect(after.trails['b'], 'and must leave no footprints behind').toBeUndefined();
  });

  it('carries the moment somebody went quiet, so it can be shown and faded', () => {
    const { setWanderers } = useLiveStore.getState();
    const wentQuietAt = Date.now() - 90_000;
    setWanderers([person('c', wentQuietAt)]);
    expect(useLiveStore.getState().wanderers['c']?.staleSince).toBe(wentQuietAt);
  });
});
