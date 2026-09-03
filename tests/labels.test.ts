import { describe, expect, it } from 'vitest';
import {
  CLUSTER_RADIUS,
  CLUSTER_THRESHOLD,
  bannerWidth,
  layoutBanners,
  type BannerAnchor,
} from '../src/lib/labels';

const anchor = (id: string, x: number, y: number, isSelf = false): BannerAnchor => ({
  id,
  x,
  y,
  label: id,
  isSelf,
});

function overlapping(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

describe('banner layout', () => {
  it('leaves a lone banner directly above its feet', () => {
    const { banners, clusters } = layoutBanners([anchor('a', 500, 500)]);
    expect(clusters).toHaveLength(0);
    expect(banners).toHaveLength(1);
    expect(banners[0]!.x).toBeCloseTo(500, 5);
    expect(banners[0]!.y).toBeLessThan(500);
  });

  it('pushes overlapping banners apart', () => {
    const anchors = [anchor('alia', 500, 500), anchor('bilal', 508, 504), anchor('chandni', 516, 508)];
    const { banners } = layoutBanners(anchors);
    expect(banners).toHaveLength(3);
    for (let i = 0; i < banners.length; i++) {
      for (let j = i + 1; j < banners.length; j++) {
        expect(overlapping(banners[i]!, banners[j]!)).toBe(false);
      }
    }
  });

  it('collapses a crowd into one marker', () => {
    const anchors = Array.from({ length: CLUSTER_THRESHOLD + 2 }, (_, i) =>
      anchor(`p${i}`, 500 + i * 4, 500 + i * 3),
    );
    const { banners, clusters } = layoutBanners(anchors);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(anchors.length);
    expect(banners).toHaveLength(0);
  });

  it('leaves a sparse group as individual banners', () => {
    const anchors = Array.from({ length: CLUSTER_THRESHOLD + 2 }, (_, i) =>
      anchor(`p${i}`, 200 + i * (CLUSTER_RADIUS + 60), 400),
    );
    const { banners, clusters } = layoutBanners(anchors);
    expect(clusters).toHaveLength(0);
    expect(banners).toHaveLength(anchors.length);
  });

  it('places your own banner first, so nobody displaces you', () => {
    const anchors = [anchor('other', 500, 500), anchor('me', 504, 502, true)];
    const { banners } = layoutBanners(anchors);
    const mine = banners.find((b) => b.isSelf)!;
    expect(mine.x).toBeCloseTo(504, 5);
    expect(mine.y).toBeCloseTo(502 - 62, 5);
  });

  it('is deterministic for the same input', () => {
    const anchors = [anchor('a', 400, 400), anchor('b', 410, 405), anchor('c', 420, 402)];
    expect(layoutBanners(anchors)).toEqual(layoutBanners(anchors));
  });

  it('sizes a ribbon to its name', () => {
    expect(bannerWidth('Yusuf')).toBeLessThan(bannerWidth('Rukhsana Ahmed-Khan'));
  });
});
