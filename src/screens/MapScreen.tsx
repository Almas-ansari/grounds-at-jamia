/**
 * The map screen. Everything meets here: the parchment, the live rows, the
 * publisher, and the brass strip along the bottom.
 */
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapCanvas, type MapCanvasHandle } from '../components/map/MapCanvas';
import { MapBase, MapOverlay } from '../components/map/MapScene';
import type { BasemapStyle } from '../components/map/MapCanvas';
import { Drawer } from '../components/ui/Drawer';
import { FriendsDrawer } from '../components/ui/FriendsDrawer';
import { SettingsDrawer } from '../components/ui/SettingsDrawer';
import { SignInDrawer } from '../components/ui/SignInDrawer';
import { describeVisibility } from '../components/ui/VisibilityControl';
import { AudienceFilter, type Audience } from '../components/ui/AudienceFilter';
import { MapControls } from '../components/ui/MapControls';
import { KIND_LABEL, PlaceSearch } from '../components/ui/PlaceSearch';
import { useSessionStore, useReducedMotion } from '../store/session';
import { useLiveStore } from '../store/live';
import { useGeoStore } from '../store/geo';
import { useFriendsStore } from '../store/friends';
import { createDemoFlock } from '../lib/demo';
import { playQuillScratch } from '../lib/audio';
import { zoneName, type Zone } from '../data/zones';
import { MakerCredit } from '../components/ui/MakerCredit';
import type { VisibilityMode } from '../lib/schemas';
import type { GeoError } from '../lib/geo';

/**
 * A refused location permission is worth one line, not a wall of platform
 * instructions. The steps are there for whoever wants them, folded away for
 * everybody else — and they are already narrowed to the device in hand.
 */
function LocationTrouble({ error }: { readonly error: GeoError }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div
      role="alert"
      className="sheet pointer-events-auto max-w-[19rem] rounded-seal px-3.5 py-2 text-sm text-ink"
    >
      <p className="text-ember">{error.message}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-0.5 text-ink-faded underline decoration-dotted underline-offset-2"
      >
        {open ? 'Hide' : 'How do I allow it?'}
      </button>
      {open && (
        <ul className="mt-1.5 list-disc pl-4 text-ink-faded">
          {error.recovery.map((step) => (
            <li key={step} className="mt-0.5">
              {step}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const OPENING_MS = 1400;

export default function MapScreen(): JSX.Element {
  const canvas = useRef<MapCanvasHandle | null>(null);

  const { user, profile, demo, visibility, setVisibility, soundEnabled, ready, schemaMissing } =
    useSessionStore();
  const authError = useSessionStore((s) => s.authError);
  const dismissAuthError = useSessionStore((s) => s.dismissAuthError);
  const reducedMotion = useReducedMotion();

  const wanderers = useLiveStore((s) => s.wanderers);
  const trails = useLiveStore((s) => s.trails);
  const setWanderers = useLiveStore((s) => s.setWanderers);
  const tickTrails = useLiveStore((s) => s.tickTrails);
  const startLive = useLiveStore((s) => s.start);
  const stopLive = useLiveStore((s) => s.stop);

  const geo = useGeoStore();
  const friendEdges = useFriendsStore((s) => s.edges);
  const loadFriends = useFriendsStore((s) => s.load);

  const [opening, setOpening] = useState(true);
  const [drawer, setDrawer] = useState<'none' | 'friends' | 'settings' | 'help' | 'signin'>('none');
  const [cluster, setCluster] = useState<string | null>(null);
  // Synced once per gesture, never per frame.
  const [zoom, setZoom] = useState(1.6);
  // A view filter, not a privacy control: everything it can show was already
  // sent because the reader was entitled to it. Persisted because it is a
  // preference about looking, not about who may look at you.
  // The strip can be folded away, leaving only the seal. Somebody who came to
  // look at the map should be able to look at the map.
  const [stripOpen, setStripOpen] = useState(true);
  const [audience, setAudienceState] = useState<Audience>(() => {
    try {
      return localStorage.getItem('mm.audience') === 'friends' ? 'friends' : 'everyone';
    } catch {
      return 'everyone';
    }
  });
  const setAudience = useCallback((next: Audience) => {
    setAudienceState(next);
    try {
      localStorage.setItem('mm.audience', next);
    } catch {
      /* private browsing; the choice simply does not persist */
    }
  }, []);
  const [place, setPlace] = useState<Zone | null>(null);
  const [zoomLimits, setZoomLimits] = useState({ in: true, out: true });
  const [style, setStyle] = useState<BasemapStyle>('surveyed');

  const friendCount = friendEdges.filter((e) => e.status === 'accepted').length;

  /* --- the opening sequence, once ------------------------------------- */
  useEffect(() => {
    const t = setTimeout(() => setOpening(false), reducedMotion ? 420 : OPENING_MS);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  /* --- live rows, when signed in -------------------------------------- */
  useEffect(() => {
    if (!ready) return undefined;
    if (user) {
      void startLive(user.id);
      void loadFriends(user.id);
      return () => stopLive();
    }
    return undefined;
  }, [ready, user, startLive, stopLive, loadFriends]);

  /* --- the footprint clock --------------------------------------------- */
  useEffect(() => {
    // Prints are laid on a cadence, from a position interpolated between the
    // last two updates. Ticking faster than the cadence keeps the spacing even
    // without laying more prints; the store only re-renders when one lands.
    const id = setInterval(() => tickTrails(), 260);
    return () => clearInterval(id);
  }, [tickTrails]);

  /* --- invented wanderers, and only while signed out ------------------- */
  useEffect(() => {
    // Gated on the user rather than on `demo`, and cleared on the way out:
    // the moment somebody signs in the invented people have to go, or the map
    // is showing made-up names next to real ones with nothing to tell them
    // apart.
    if (user) return undefined;
    const flock = createDemoFlock(6);
    // A slow tick, and each tick advances the walkers by exactly its own
    // length, so the pace on screen is the pace in the model.
    const TICK_MS = 1500;
    setWanderers(flock.tick(0));
    const id = setInterval(() => setWanderers(flock.tick(TICK_MS / 1000)), TICK_MS);
    return () => {
      clearInterval(id);
      setWanderers([]);
    };
  }, [user, setWanderers]);

  /* --- publishing ------------------------------------------------------ */
  useEffect(() => {
    if (!user) return undefined;
    if (visibility === 'ghost') {
      geo.stop();
      return undefined;
    }
    geo.start(user.id, visibility);
    return () => geo.stop();
    // `geo` is a stable zustand store object; only these two drive the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, visibility]);

  useEffect(() => {
    useGeoStore.getState().setOnOwnPrint(soundEnabled ? () => playQuillScratch() : null);
    return () => useGeoStore.getState().setOnOwnPrint(null);
  }, [soundEnabled]);

  const onVisibilityChange = useCallback(
    (next: VisibilityMode) => {
      setVisibility(next);
      if (user) void useGeoStore.getState().setVisibility(user.id, next);
    },
    [setVisibility, user],
  );

  const onZoomChange = useCallback((next: number) => {
    setZoom(next);
    setZoomLimits({
      in: canvas.current?.canZoomIn() ?? true,
      out: canvas.current?.canZoomOut() ?? true,
    });
  }, []);

  const showPlace = useCallback((zone: Zone) => {
    setPlace(zone);
    canvas.current?.fitTo(zone.polygon);
  }, []);

  const recentre = useCallback(() => {
    const self = user ? wanderers[user.id] : undefined;
    const point = self?.point ?? geo.fix;
    if (point) canvas.current?.flyTo(point.lat, point.lng, 3.4);
    else canvas.current?.reset();
  }, [geo.fix, user, wanderers]);

  const friendIds = useMemo(
    () => new Set(friendEdges.filter((e) => e.status === 'accepted').map((e) => e.other.id)),
    [friendEdges],
  );

  /** What the map actually draws, after the reader's own filter. */
  const shown = useMemo(() => {
    if (audience === 'everyone') return wanderers;
    const kept: Record<string, (typeof wanderers)[string]> = {};
    for (const [id, w] of Object.entries(wanderers)) {
      if (w.isSelf || friendIds.has(id)) kept[id] = w;
    }
    return kept;
  }, [audience, wanderers, friendIds]);

  const everyoneCount = Object.keys(wanderers).length;
  const friendsCount = useMemo(
    () => Object.values(wanderers).filter((w) => w.isSelf || friendIds.has(w.userId)).length,
    [wanderers, friendIds],
  );
  const visibleCount = Object.keys(shown).length;
  const marginNote = useMemo(() => {
    if (visibleCount > 0) return null;
    return 'No one is abroad on the grounds tonight.';
  }, [visibleCount]);

  const selfZoneId = user ? (wanderers[user.id]?.zoneId ?? geo.zone?.id ?? null) : null;
  const litZoneId = place?.id ?? selfZoneId;

  return (
    <div className="mm-desk relative h-full w-full overflow-hidden">
      <MapCanvas
        ref={canvas}
        style={style}
        opening={opening}
        reducedMotion={reducedMotion}
        onZoomChange={onZoomChange}
        label="Map of the Jamia Millia Islamia campus. Drag to pan, pinch or scroll to zoom."
        base={<MapBase marginNote={marginNote} />}
        overlay={
          <MapOverlay
            wanderers={shown}
            trails={trails}
            highlightZoneId={litZoneId}
            marginNote={marginNote}
            reducedMotion={reducedMotion}
            expandedClusterId={cluster}
            onToggleCluster={setCluster}
            opening={opening}
            zoom={zoom}
            surveyed={style === 'surveyed'}
          />
        }
      />

      <p id="mm-canvas-help" className="sr-only">
        Use the arrow keys to pan, plus and minus to zoom, and 0 to fit the whole campus.
      </p>

      {/* --- notices ---------------------------------------------------- */}
      {/* Kept off the centre so the cartouche at the head of the sheet stays readable. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-start gap-2 p-3">
        <div className="pointer-events-none flex w-full max-w-sm items-start gap-2">
          <PlaceSearch onChoose={showPlace} selectedZoneId={place?.id ?? null} />
          <Link
            to="/report"
            title="Report a bug"
            aria-label="Report a bug"
            className="brass pointer-events-auto flex h-[46px] w-11 shrink-0 items-center justify-center rounded-seal no-underline"
          >
            {/* A bug, drawn rather than fetched, like everything else here. */}
            <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
              <ellipse cx="12" cy="13.5" rx="4.6" ry="5.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M12 7.9V6.2M9.4 6.1 8.2 4.7M14.6 6.1l1.2-1.4M7.4 11.2 4.5 10M7.2 14.4H4.2M7.6 17.6l-2.6 1.6M16.6 11.2l2.9-1.2M16.8 14.4h3M16.4 17.6l2.6 1.6M12 8.4v10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Link>
        </div>
        {demo && (
          <p className="sheet pointer-events-auto max-w-[17rem] rounded-seal px-3 py-1.5 text-xs text-ink">
            Demonstration: the campus is real, the wanderers are invented, and no one’s location is
            involved.{' '}
            <button
              type="button"
              onClick={() => setDrawer('signin')}
              className="underline decoration-dotted underline-offset-2"
            >
              Sign in
            </button>{' '}
            to see people who are really here.
          </p>
        )}
        {authError && (
          <div
            role="alert"
            className="sheet pointer-events-auto max-w-[19rem] rounded-seal px-3.5 py-2 text-sm text-ink"
          >
            <p className="text-ember">Sign-in was refused.</p>
            <p className="mt-1 break-words text-ink-faded">{authError}</p>
            <button
              type="button"
              onClick={dismissAuthError}
              className="brass mt-2 rounded-seal px-3 py-1 text-xs"
            >
              Dismiss
            </button>
          </div>
        )}
        {schemaMissing && (
          <div
            role="alert"
            className="sheet pointer-events-auto max-w-[19rem] rounded-seal px-3.5 py-2 text-sm text-ink"
          >
            <p className="text-ember">You are signed in, but this project has no database schema.</p>
            <p className="mt-1 text-ink-faded">
              Run the migration in <span className="hand">supabase/migrations/</span> from the SQL
              editor, then reload. Until then nobody can appear on the map.
            </p>
          </div>
        )}
        {geo.offCampus && (
          <p
            role="status"
            className="sheet pointer-events-auto max-w-[19rem] rounded-seal px-3.5 py-2 text-sm text-ink"
          >
            This map only covers the campus. While you are beyond it, your coordinates are not being
            sent anywhere.
          </p>
        )}
        {geo.error && <LocationTrouble error={geo.error} />}
      </div>

      <MapControls
        stripOpen={stripOpen}
        onZoomIn={() => canvas.current?.zoomBy(0.8)}
        onZoomOut={() => canvas.current?.zoomBy(-0.8)}
        onRecentre={recentre}
        onFit={() => canvas.current?.reset()}
        canZoomIn={zoomLimits.in}
        canZoomOut={zoomLimits.out}
        style={style}
        onToggleStyle={() => setStyle((s) => (s === 'surveyed' ? 'inked' : 'surveyed'))}
        locateLabel={user && visibility !== 'ghost' ? 'Find me on the map' : 'Return to the centre of the grounds'}
      />

      {/* The card for a chosen place. Google Maps taught everyone to expect
          this, and there is no reason a parchment should not oblige. */}
      {place && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[9.5rem] z-20 flex justify-center px-3 sm:bottom-[8.5rem]">
          <div className="sheet pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-seal px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="hand truncate text-lg text-ink">{place.name}</h2>
              <p className="text-sm text-ink-faded">
                {KIND_LABEL[place.kind]}
                {place.approximate && ' · outline drawn by hand, not surveyed'}
              </p>
              {Object.values(shown).some((w) => w.zoneId === place.id) && (
                <p className="mt-1 text-sm text-ink">
                  {Object.values(shown)
                    .filter((w) => w.zoneId === place.id)
                    .map((w) => w.displayName)
                    .join(', ')}{' '}
                  <span className="text-ink-faded">here now</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPlace(null)}
              aria-label="Dismiss"
              className="brass shrink-0 rounded-seal px-2.5 py-1 text-sm"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* --- the instrument strip --------------------------------------- */}
      <div className="absolute inset-x-0 bottom-0 z-30 p-3">
        <div className={`relative mx-auto max-w-lg ${stripOpen ? '' : 'h-9'}`}>
          {/* The seal both fastens the strip down and lifts it away again. It
              is the only thing left on screen when the strip is folded, so it
              has to read as a handle rather than as decoration. */}
          <button
            type="button"
            onClick={() => setStripOpen((v) => !v)}
            aria-expanded={stripOpen}
            aria-controls="mm-strip"
            aria-label={stripOpen ? 'Hide the controls' : 'Show the controls'}
            title={stripOpen ? 'Hide the controls' : 'Show the controls'}
            className={`wax-seal absolute left-1/2 z-10 h-9 w-9 -translate-x-1/2 rounded-full ${stripOpen ? '-top-4' : 'bottom-0'}`}
          >
            <span aria-hidden="true" className="block text-sm leading-none text-parchment">
              {stripOpen ? '▾' : '▴'}
            </span>
          </button>

          <div
            id="mm-strip"
            hidden={!stripOpen}
            className="sheet rounded-xl px-3 pb-2.5 pt-4"
          >

          {user ? (
            <>
              {/* Who can see *you* lives in Settings, but never being told is
                  worse than the extra tap: the status stays here, and it is the
                  way in. */}
              <button
                type="button"
                onClick={() => setDrawer('settings')}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-seal px-2 py-1 text-sm text-ink-faded hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 rounded-full ${visibility === 'ghost' ? 'bg-ink/35' : 'bg-ember'}`}
                />
                {describeVisibility(visibility, friendCount)}
                <span className="underline decoration-dotted underline-offset-2">Change</span>
              </button>
              <AudienceFilter
                value={audience}
                onChange={setAudience}
                friendsShown={friendsCount}
                everyoneShown={everyoneCount}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setDrawer('signin')}
              className="brass w-full rounded-seal px-4 py-2 text-base"
            >
              Sign in to see who is really here
            </button>
          )}

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <button type="button" onClick={recentre} className="brass rounded-seal px-1 py-2 text-sm">
              Find me
            </button>
            <button
              type="button"
              onClick={() => setDrawer('friends')}
              className="brass rounded-seal px-1 py-2 text-sm"
            >
              Friends{friendCount > 0 ? ` (${friendCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setDrawer('settings')}
              className="brass rounded-seal px-1 py-2 text-sm"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setDrawer('help')}
              className="brass rounded-seal px-1 py-2 text-sm"
            >
              About
            </button>
          </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-ink/15 pt-2">
              <Link
                to="/your-college"
                className="text-sm text-ember underline decoration-dotted underline-offset-4 hover:text-ink"
              >
                Want this for your college?
              </Link>
              <MakerCredit variant="compact" />
            </div>
          </div>
        </div>
      </div>

      <FriendsDrawer
        open={drawer === 'friends'}
        selfId={user?.id ?? null}
        onClose={() => setDrawer('none')}
        onLocate={(lat, lng) => canvas.current?.flyTo(lat, lng, 3.6)}
      />
      <SettingsDrawer
        open={drawer === 'settings'}
        onClose={() => setDrawer('none')}
        onVisibilityChange={onVisibilityChange}
      />
      <SignInDrawer open={drawer === 'signin'} onClose={() => setDrawer('none')} />

      <Drawer open={drawer === 'help'} title="What this map knows" onClose={() => setDrawer('none')}>
        <div className="flex flex-col gap-3 text-base text-ink">
          <p>
            {user
              ? describeVisibility(visibility, friendCount)
              : 'You are not signed in. Nothing about you is stored.'}
          </p>
          <p>
            There is one row for where you are, and it is replaced in place every time it changes.
            No trail is kept, so there is no history of your movements to read, sell or hand over.
          </p>
          <p>
            That row expires 90 seconds after your last update. Close this tab and you fade off
            every other map within a minute and a half.
          </p>
          <p>
            In <span className="hand">Campus</span> mode your exact position never leaves this
            device — only the name of the building. In <span className="hand">Friends</span> mode
            your coordinates are readable by accepted friends and by nobody else, and that is
            enforced by the database, not by this app.
          </p>
          {profile && <p className="text-ink-faded">You are @{profile.handle} here.</p>}

          <div className="border-t border-ink/20 pt-4">
            <MakerCredit />
            <Link
              to="/your-college"
              onClick={() => setDrawer('none')}
              className="brass mt-3 inline-block rounded-seal px-4 py-2.5 text-base no-underline"
            >
              Bring this to your college
            </Link>
          </div>
        </div>
      </Drawer>

      {/* An accessible summary of who is on the map, for screen readers. */}
      <p aria-live="polite" className="sr-only">
        {visibleCount === 0
          ? 'No one is on the map.'
          : `${visibleCount} ${visibleCount === 1 ? 'person is' : 'people are'} on the map: ${Object.values(
              shown,
            )
              .map((w) => `${w.displayName}${w.zoneId ? ` near ${zoneName(w.zoneId) ?? 'the grounds'}` : ''}`)
              .join(', ')}.`}
      </p>
    </div>
  );
}
