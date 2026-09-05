/**
 * Invented people must never share the map with real ones.
 *
 * The demonstration flock exists so the map is worth looking at while signed
 * out. The moment somebody signs in it has to disappear completely — otherwise
 * the map shows made-up names beside real ones with nothing to tell them apart,
 * which is worse than showing nothing at all.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useLiveStore, type Wanderer } from '../src/store/live';
import { createDemoFlock } from '../src/lib/demo';
import { isOnEstate } from '../src/data/estate';

const wanderer = (id: string): Wanderer => ({
  userId: id,
  displayName: `Invented ${id}`,
  handle: `demo_${id}`,
  isSelf: false,
  precise: true,
  point: { lat: 28.5625, lng: 77.2815 },
  zoneId: 'zakir-husain-library',
  bearing: 0,
  updatedAt: Date.now(),
  staleSince: null,
});

describe('the demonstration flock', () => {
  beforeEach(() => {
    useLiveStore.setState({ wanderers: {}, trails: {} });
  });

  it('leaves nothing behind when it is cleared', () => {
    const { setWanderers } = useLiveStore.getState();

    setWanderers([wanderer('a'), wanderer('b'), wanderer('c')]);
    expect(Object.keys(useLiveStore.getState().wanderers)).toHaveLength(3);
    expect(Object.keys(useLiveStore.getState().trails)).toHaveLength(3);

    // What the sign-in teardown does.
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

  it('walks its people on university land, not through Okhla', () => {
    const flock = createDemoFlock(6);
    let people = flock.tick(0);
    expect(people).toHaveLength(6);
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
