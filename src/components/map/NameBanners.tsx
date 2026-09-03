/**
 * Layer 8b: the name banners.
 *
 * Every banner is tied to its feet by a curved leader line. Overlaps are
 * resolved by pushing a banner outward along that leader until it is clear;
 * a crowd of five or more collapses into a single marker that opens on tap.
 */
import { memo, useMemo } from 'react';
import { layoutBanners, type BannerAnchor } from '../../lib/labels';
import type { TrailState } from '../../lib/trails';
import type { Wanderer } from '../../store/live';
import { project } from '../../lib/projection';

interface NameBannersProps {
  readonly wanderers: Record<string, Wanderer>;
  readonly trails: Record<string, TrailState>;
  readonly expandedClusterId: string | null;
  readonly onToggleCluster: (id: string | null) => void;
}

/** A leader that leaves the feet, curves, and arrives under the ribbon. */
function leaderPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const bow = (toX - fromX) * 0.28 + 9;
  return `M${fromX.toFixed(1)} ${fromY.toFixed(1)} Q${(midX + bow).toFixed(1)} ${midY.toFixed(1)} ${toX.toFixed(1)} ${toY.toFixed(1)}`;
}

function NameBannersImpl({
  wanderers,
  trails,
  expandedClusterId,
  onToggleCluster,
}: NameBannersProps): JSX.Element {
  const layout = useMemo(() => {
    const anchors: BannerAnchor[] = [];
    for (const wanderer of Object.values(wanderers)) {
      const trail = trails[wanderer.userId];
      // Anchor on the newest print so the banner follows the feet, not the
      // raw fix, which keeps ribbon and prints from drifting apart.
      const last = trail?.prints[trail.prints.length - 1];
      const p = last ?? project(wanderer.point.lat, wanderer.point.lng);
      anchors.push({
        id: wanderer.userId,
        x: p.x,
        y: p.y,
        label: wanderer.displayName,
        isSelf: wanderer.isSelf,
      });
    }
    return layoutBanners(anchors);
  }, [wanderers, trails]);

  const expanded = layout.clusters.find((c) => c.id === expandedClusterId) ?? null;

  return (
    <g className="mm-layer mm-layer--banners">
      {layout.banners.map((banner) => (
        <g key={banner.id} className="mm-banner">
          <path
            d={leaderPath(banner.anchorX, banner.anchorY, banner.x, banner.y + banner.height / 2)}
            fill="none"
            stroke={banner.isSelf ? 'var(--ember)' : 'var(--ink-faded)'}
            strokeWidth={1.2}
            strokeOpacity={0.7}
            strokeLinecap="round"
          />
          {/* No ink filter on the ribbons: there is one banner per person and
              they move with the map, so filtering them costs a raster pass per
              frame per person to add a wobble nobody can see at this size. */}
          <g>
            <use
              href="#mm-ribbon"
              x={banner.x - banner.width / 2}
              y={banner.y - banner.height / 2}
              width={banner.width}
              height={banner.height}
            />
            <text
              x={banner.x}
              y={banner.y + 6}
              textAnchor="middle"
              className="mm-label"
              fontSize={19}
              fill={banner.isSelf ? 'var(--ember)' : 'var(--ink)'}
            >
              {banner.label}
            </text>
          </g>
        </g>
      ))}

      {layout.clusters.map((clusterMarker) => (
        <g key={clusterMarker.id} className="mm-cluster">
          <g
            role="button"
            tabIndex={0}
            aria-label={`${clusterMarker.count} people here. Activate to list them.`}
            aria-expanded={expandedClusterId === clusterMarker.id}
            onClick={() =>
              onToggleCluster(expandedClusterId === clusterMarker.id ? null : clusterMarker.id)
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onToggleCluster(expandedClusterId === clusterMarker.id ? null : clusterMarker.id);
              }
            }}
            className="mm-cluster__hit"
          >
            <circle
              cx={clusterMarker.x}
              cy={clusterMarker.y - 54}
              r={26}
              fill="var(--parchment)"
              stroke={clusterMarker.containsSelf ? 'var(--ember)' : 'var(--ink)'}
              strokeWidth={1.6}
              strokeOpacity={0.8}
            />
            <text
              x={clusterMarker.x}
              y={clusterMarker.y - 47}
              textAnchor="middle"
              className="mm-label"
              fontSize={22}
              fill="var(--ink)"
            >
              {clusterMarker.count}
            </text>
          </g>
        </g>
      ))}

      {expanded && (
        <g className="mm-cluster__list">
          <rect
            x={expanded.x - 92}
            y={expanded.y - 34}
            width={184}
            height={26 + expanded.memberIds.length * 24}
            rx={4}
            fill="var(--parchment)"
            stroke="var(--ink)"
            strokeWidth={1.2}
            strokeOpacity={0.7}
          />
          {expanded.memberIds.map((id, i) => {
            const wanderer = wanderers[id];
            if (!wanderer) return null;
            return (
              <text
                key={id}
                x={expanded.x}
                y={expanded.y - 12 + i * 24}
                textAnchor="middle"
                className="mm-label"
                fontSize={18}
                fill={wanderer.isSelf ? 'var(--ember)' : 'var(--ink)'}
              >
                {wanderer.displayName}
              </text>
            );
          })}
        </g>
      )}
    </g>
  );
}

export const NameBanners = memo(NameBannersImpl);
