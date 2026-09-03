# The Grounds at Jamia

A live map of the **Jamia Millia Islamia** campus in New Delhi, drawn as an aged
parchment. People who choose to appear are drawn on it as ink footprints that
dissolve behind them. Everyone else is not on it at all.

The map is real. The basemap is OpenStreetMap raster tiles, downloaded once at
build time and **served by this app** — no tile provider is contacted while
anybody is using it, which is what lets the whole thing work offline. Everything
beyond the university's own land is masked off: the map shows Jamia and nothing
else.

Everything laid over that basemap is drawn in code: the paper grain, the ink
wash, the foot glyphs, the name ribbons, the compass rose and the app icon.

---

## The privacy model, in plain language

This is the part worth reading.

**Nobody is on the map until they say so.** A new account is created in *ghost*
mode. Ghost means there is nothing to see: no zone, no coordinate, no row that
any policy will hand to anybody.

**There are three states, and they mean different things:**

| State | What other people can see |
| --- | --- |
| **Ghost** | Nothing. You are not on the map. |
| **Friends** | Your accepted friends see where you actually are. Nobody else sees anything. |
| **Campus** | Any signed-in person sees *which building you are in*. Your coordinates never leave your phone. |

In Campus mode the app writes a zone name — `zakir-husain-library` — and nothing
else. The scatter you see inside a building on other people's screens is
computed in *their* browser from the zone, not sent by you. There is no row
anywhere containing your coordinates for a non-friend to find.

**No location history is kept, anywhere.** There is one row per person, replaced
in place each time it changes. There is no trail table, no append-only log, no
analytics on movement. Even if the whole database were handed to somebody, there
would be nothing in it but where people were in the last ninety seconds.

**Rows expire in 90 seconds.** The server sets that timestamp, ignoring whatever
the client sends, so no client can pin itself to the map. Close the tab and you
fade off every other screen within a minute and a half. The app also clears both
rows outright on `pagehide`, so usually it is instant.

**Blocking is absolute.** A block hides you from them and them from you, in both
directions, immediately — and it deletes any friendship between you rather than
hiding it. The blocked person is not told.

**Every one of these rules is enforced in Postgres, not in the browser.** The
client subscribes to the live tables *without a filter* and receives only the
rows its policies admit. That is deliberate: filtering on the client would mean
the data had already been sent, and a determined reader could simply open the
network tab. `supabase/tests/rls.sql` asserts all of it against a real database —
including that two people who are not friends cannot read each other's
coordinates by direct query.

**Nothing else is collected.** No analytics, no third-party scripts, no error
reporting service, and no tile requests. The only network calls are to your own
Supabase project and to Google Fonts for the two typefaces.

---

## Running it

### 1. Install

```bash
npm install
npm run dev      # http://localhost:5173
```

That is enough to see the whole thing. With no database configured the app runs
in **demonstration mode**: the campus is real, six invented people walk the real
footpaths, and no location is involved at all. There is no gate in front of the
map and no phrase to type — the map is the front door, and signing in is a
button on it.

### 2. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (the free tier is
   enough).
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**.

   Both are safe in a browser bundle. The anon key grants nothing on its own,
   because every table is behind row-level security.

3. Check what is left at any time:

   ```bash
   npm run doctor
   ```

   It reads your `.env` and asks your project what is configured, then prints
   exactly what remains with the link to do it. It only ever reads.

### Google sign-in

This is two halves, and the usual mistake is doing only the Supabase one. The
Google console needs to know **Supabase's** callback, not the app's — the
browser goes app → Google → Supabase → app, and Google only ever sees the
middle hop.

**Half one — Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com/apis/credentials))

1. Create or pick a project.
2. **APIs & Services → OAuth consent screen**. External, fill in the app name
   and your email. Add yourself under **Test users** while it is unpublished,
   or sign-in will refuse anyone else.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
4. Under **Authorised redirect URIs**, add exactly this — your project ref,
   nothing else, no trailing slash:

   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```

5. Copy the **Client ID** and **Client secret**.

**Half two — Supabase** (`Authentication → Providers → Google`)

6. Turn Google on, paste the client ID and secret, save.
7. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173`
   - Redirect URLs: `http://localhost:5173/**`, plus your deployed URL when you
     have one.

   The dev server is pinned to port 5173 (`strictPort` in `vite.config.ts`)
   precisely so this entry stays valid — a dev server that quietly moves to
   :5174 breaks the redirect.

Then `npm run doctor` should report Google as enabled. Nothing in the repo needs
editing for any of this; the app already calls `signInWithOAuth({ provider:
'google' })` in `src/components/ui/SignInDrawer.tsx`.

**Email sign-in** needs none of the above and is on by default: the same drawer
sends a magic link with `signInWithOtp`.

### 3. Migrations

With the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Or paste `supabase/migrations/20260101000000_init.sql` into the SQL editor and
run it. It is one file, and it is worth reading top to bottom before you run it —
it is the entire security model.

Afterwards, check **Database → Replication** shows `live_presence` and
`live_fixes` in the `supabase_realtime` publication. The migration adds them.

**The sweeper.** The migration schedules a `pg_cron` job to delete expired rows
every minute where the extension is available. If it is not, it prints a notice,
and you should deploy the fallback instead:

```bash
supabase functions deploy reap
# then schedule it every 60 seconds under Edge Functions → Cron
```

Expired rows are invisible before the sweeper ever runs — the policies check
`expires_at > now()`. The sweeper is housekeeping, not a security control.

### 4. The map data

Both pieces are already committed. Neither is fetched at runtime.

```bash
npm run fetch:campus   # → src/data/campus.geojson   (OSM vector features)
npm run fetch:tiles    # → public/tiles/             (OSM raster basemap)
```

`fetch:campus` finds the campus **by name** in OSM around Jamia Nagar rather
than trusting a hardcoded bounding box, expands until it has the whole thing,
verifies the span is sane, prints the bounds, and separates the result into
layers. It is what the zone polygons, the walk network and the projection are
built from. Current extract:

```
campus bounds   1259 m E-W × 1303 m N-S  (relation/3695425)
render window    975 m E-W × 1021 m N-S  (the university estate)
489 features: 257 roads, 165 buildings, 44 points, 14 pitches, 3 footpaths
```

`fetch:tiles` downloads the basemap for that window, zoom 15–18, from the
standard OpenStreetMap raster style — **186 tiles, 1.7 MB** — into a
git-ignored `.tiles-raw/`, then `npm run wash:tiles` bakes the parchment
palette into them and writes `public/tiles/`. That is deliberately
under the 250-tile threshold the [OSM tile usage
policy](https://operations.osmfoundation.org/policies/tiles/) treats as bulk
downloading; the script identifies itself, runs two requests at a time, and
refuses outright if the maths ever says more than 250. Leaflet upscales z18 for
the last couple of zoom levels.

The wash is baked rather than applied at runtime. The tiles are 8-bit palette
PNGs, so `wash:tiles` rewrites the 256-entry PLTE chunk and fixes the CRC — it
never touches a pixel, and the files come out byte-for-byte the same size. Doing
it here means the app needs no filter at all while the map is moving, which is
the difference between smooth and unusable on a phone. Change the ramp in
`scripts/wash-tiles.ts` and re-run; no re-download.

Attribution — **© OpenStreetMap contributors** — is shown on the map and in the
About panel, and is required.

### 5. Phantom wanderers

Developing a live map alone is difficult, so:

```bash
npm run seed:phantoms
```

Six invented people walk the real path network between real zones, half in
Friends mode and half in Campus mode. Ctrl-C clears their rows.

It needs `SUPABASE_SERVICE_ROLE_KEY` (it creates auth users) and **refuses to run
against production** — set `PRODUCTION_SUPABASE_REF` in `.env.local` and it will
abort if the target matches, or if the URL merely looks like production.

---

## Tests

```bash
npm test          # projection, zones, zone accuracy, publish throttling, banners
npm run test:rls  # the RLS policies, against a throwaway local Postgres
npm run test:all
```

`npm run test:rls` needs PostgreSQL 14+ and `pgtap` on the local machine. It
creates a scratch cluster, applies the migration and runs the suite. Against a
real project, `supabase test db` runs the same `supabase/tests/rls.sql`
(`supabase/tests/00_supabase_shim.sql` is a local-only stand-in for the `auth`
schema Supabase provides natively, and is never applied to a project).

`tests/zone-accuracy.test.ts` is worth calling out: it checks every zone binding
against `src/data/osm-names.json`, a committed snapshot of all 56 named features
on campus, so an edit to `zones.ts` cannot silently move the library across the
road. Zones OSM does not name are exempt — but only if they admit it by carrying
`approximate: true`.

The RLS suite covers the whole privacy model in 36 assertions: non-friends cannot
read each other's `live_fixes`; public mode discloses a zone and never a
coordinate; going ghost deletes the precise row server-side; blocking is
bidirectional, immediate and dissolves the friendship; the TTL and rate limit
are set by the server whatever the client sends; and there is nowhere for
history to accumulate.

---

## Deploying

`render.yaml` is a Render blueprint for a **static site** on the free tier:

1. Push to GitHub.
2. Render → **New → Blueprint** → point it at the repo.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the dashboard.

There is no server of ours anywhere; the browser talks to Supabase directly and
serves its own tiles. Any static host works — Netlify, Vercel, Cloudflare Pages,
GitHub Pages — as long as it rewrites unknown paths to `/index.html` and does not
cache `/sw.js`.

Add the deployed origin to Supabase's redirect allow-list, or sign-in will bounce
back to localhost.

---

## How it is put together

```
scripts/fetch-campus.ts     one-off Overpass fetch → src/data/campus.geojson
scripts/fetch-tiles.ts      one-off basemap fetch  → .tiles-raw/
scripts/wash-tiles.ts       bakes the parchment palette into the tiles
scripts/seed-phantoms.ts    six invented walkers, for solo development
scripts/test-rls.sh         throwaway Postgres + pgTAP

src/data/campus.geojson     the committed OSM extract (489 features)
src/data/osm-names.json     every named feature on campus, for the accuracy test
src/data/zones.ts           hand-curated named zones, bound to OSM footprints
src/data/estate.ts          the outline of the university's own land
src/lib/projection.ts       equirectangular projection over a fixed bbox
src/lib/geo.ts              smoothing, zone resolution, publish throttling
src/lib/trails.ts           footprint placement along a path
src/lib/labels.ts           banner collision avoidance and clustering
src/lib/walkgraph.ts        a walk network built from the surveyed lanes
src/lib/viewport.ts         the live map scale, shared outside React

src/components/map/
  MapCanvas.tsx             Leaflet, self-hosted tiles, no tile provider
  MapDefs.tsx               every filter, pattern and glyph
  EstateMask.tsx            everything that is not Jamia, covered over
  CampusLayers.tsx          the inked style: ground cover, buildings, lanes
  ParchmentBase.tsx         the inked style: the sheet and its creases
  MapFurniture.tsx          the inked style: torn border, compass, scale bar
  ZoneLabels.tsx            lettering, with collision suppression
  Footprints.tsx            the signature element
  NameBanners.tsx           ribbons and cluster markers

supabase/migrations/        the entire security model, in one file
supabase/tests/rls.sql      and the assertions that it holds
```

**Two styles, one map.** *Surveyed* is the real basemap washed into the
parchment palette by an SVG levels-and-tint filter (`mm-tile-wash`), with the
paper grain over it — accurate, and the one to use when you need to find a door.
*Inked* is the hand-drawn scene with no tiles at all, built from the same OSM
vector extract. The quill button switches between them without losing your
position.

**Everything outside Jamia is masked off.** `EstateMask` lays a cover over the
whole sheet and punches the estate out of it — an SVG `<mask>` rather than an
even-odd path, because the campus is in two overlapping pieces and under
even-odd two overlapping holes cancel each other out. The outlines are dilated
by a wide round stroke, so the map keeps about 55 m of its own approaches.

**Footprints converge on the truth as you zoom in.** Pulled back, a print has to
be a symbol — legible across a kilometre on a phone, and therefore far bigger
than a foot. Zoomed in it shrinks towards life size and the stride tightens with
it, so a person becomes a small, precisely-placed mark. The scale is published
to a CSS custom property inside Leaflet's animation frame, so zooming resizes
every print on the page without React seeing a thing.

**Footprint fades are CSS, not JavaScript.** A dissolving trail costs no frames.
React re-renders only when a print is added or swept.

---

## Zones, and which ones are guesses

`src/data/zones.ts` holds 30 zones. **21 are verified**: each sits within 60 m
of the feature OSM gives that name to, asserted by `tests/zone-accuracy.test.ts`,
and most are within a few metres.

**9 are guesses**, because OSM names nothing like them anywhere on campus:
Natural Sciences, the Mass Communication Research Centre, Dayar-e-Mir Taqi Mir,
the M.F. Husain Art Gallery, the Polyclinic, the Girls Hostels, the Faculty of
Law, and the three gates. Every one carries `approximate: true` and an `anchor`
note saying what pinned it, and the map draws approximate outlines dashed so a
reader can tell a surveyed shape from a sketched one.

Zones are what presence is reported in ("someone is in the library"), what the
search box searches, and what the map names when you tap a place. Over the
surveyed basemap they are otherwise silent, because OSM already letters the
campus and saying it twice is clutter.

Correcting one is a one-line change: give the zone the `osmId` of the right way,
or adjust its `box`, and drop the flag.

---

## Where this departs from the original brief

Worth stating plainly, because these were deliberate changes made during the
build at the request of the person commissioning it:

- **A map library and a basemap.** The brief ruled out both. OSM's vector
  coverage of JMI is too thin to draw an accurate campus from — 3 footpaths for
  the whole university — and a hand-rolled gesture layer was never going to feel
  like a map people already know how to use. So Leaflet drives the interaction
  and a downloaded raster basemap carries the terrain. The mitigations: the
  tiles are **self-hosted**, so no provider is contacted at runtime and nobody
  gets a log of a reader's panning; and the hand-drawn scene is kept as a second
  style rather than thrown away.
- **No entry screen.** The brief specified a folded map behind a typed
  incantation. It hid the sign-in button, so it is gone: the map is the front
  door and signing in is a button on it.

Everything else in the brief stands, including all four non-negotiables.

---

## Typefaces and artwork

Two families, both open licence, both from Google Fonts:

- **IM Fell English** — the map's own voice: zone labels and name banners. A
  revival of the 17th-century Fell types; the revival is in the public domain.
- **Crimson Pro** — interface copy that has to be read quickly. SIL Open Font
  License.

Everything drawn by this app is drawn in this repository. The parchment grain
and tooth are `feTurbulence`; the basemap wash is a gamma curve and a colour
ramp in `feComponentTransfer` and `feColorMatrix`; the torn edge is a
`feDisplacementMap` on the border path; the crooked ink is a shared displacement
filter with a seeded per-feature stroke width, so the same building is crooked
the same way on every reload. The foot glyph, the compass rose, the wax seal,
the ribbon and the app icon are all original SVG. No commercial film or
publisher branding, character names or licensed typefaces appear anywhere.

Basemap and campus outlines © OpenStreetMap contributors, ODbL 1.0.
