/**
 * Invented people share the map with real ones — and must always be told apart.
 *
 * Three invented residents walk the campus whether or not anybody is signed in,
 * because an empty map is a broken-looking map. That makes two things load
 * bearing. They must be marked, so that a made-up name beside a real one is
 * never mistaken for somebody who is actually there. And they must be kept in
 * their own slot, because the live list is replaced wholesale every time the
 * server says anything — if the two shared a slot, each new fix would wipe the
 * residents and each resident tick would wipe the real people.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useLiveStore, type Wanderer } from '../src/store/live';
import { createResidents } from '../src/lib/demo';
import { isOnEstate } from '../src/data/estate';

const wanderer = (id: string): Wanderer => ({
  userId: id,
  displayName: `Invented ${id}`,
  handle: `demo_${id}`,
  isSelf: false,
  precise: true,
  point: { lat: 28.5625, lng: 77.2815 },
  zoneId: null,
  bearing: 0,
  updatedAt: Date.now(),
  staleSince: null,
});

describe('the invented residents', () => {
  beforeEach(() => {
    useLiveStore.getState().setResidents([]);
    useLiveStore.setState({ wanderers: {}, trails: {} });
  });

  it('leaves nothing behind when the live list is cleared', () => {
    const { setWanderers } = useLiveStore.getState();

    setWanderers([wanderer('a'), wanderer('b'), wanderer('c')]);
    expect(Object.keys(useLiveStore.getState().wanderers)).toHaveLength(3);
    expect(Object.keys(useLiveStore.getState().trails)).toHaveLength(3);

    setWanderers([]);
    expect(useLiveStore.getState().wanderers).toEqual({});
    expect(
      useLiveStore.getState().trails,
      'a stale trail would keep drawing footprints for somebody who is gone',
    ).toEqual({});
  });

  it('drops the trail of anyone who leaves, while keeping the others', () => {
    const { setWanderers } = useLiveStore.getState();
    setWanderers([wanderer('a'), wanderer('b')]);
    setWanderers([wanderer('a')]);

    expect(Object.keys(useLiveStore.getState().wanderers)).toEqual(['a']);
    expect(Object.keys(useLiveStore.getState().trails)).toEqual(['a']);
  });

  it('survives a live update, and does not take the live people with it', () => {
    const { setWanderers, setResidents } = useLiveStore.getState();
    const residents = createResidents().tick(0);

    setResidents(residents);
    setWanderers([wanderer('real')]);

    const ids = Object.keys(useLiveStore.getState().wanderers);
    expect(ids, 'a real arrival must not evict the residents').toContain(residents[0]!.userId);
    expect(ids, 'the residents must not evict a real person').toContain('real');

    // A resident tick is not the server saying the real people have gone.
    setResidents(createResidents().tick(1));
    expect(Object.keys(useLiveStore.getState().wanderers)).toContain('real');
  });

  it('marks every resident as invented', () => {
    const people = createResidents().tick(0);
    expect(people).toHaveLength(3);
    for (const person of people) {
      expect(person.invented, `${person.displayName} is not marked invented`).toBe(true);
    }
  });

  it('walks its people on university land, not through Okhla', () => {
    const flock = createResidents();
    let people = flock.tick(0);
    expect(people).toHaveLength(3);
    // Half an hour of walking, sampled.
    for (let i = 0; i < 120; i++) people = flock.tick(15);
    for (const person of people) {
      expect(
        isOnEstate(person.point, 120),
        `${person.displayName} wandered off the estate to ${person.point.lat.toFixed(5)},${person.point.lng.toFixed(5)}`,
      ).toBe(true);
    }
  });
});
