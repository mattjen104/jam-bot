/**
 * /me/popular-crossings — "onboarding crossing sort" for the Also-On-Air tab.
 *
 * GET /api/me/popular-crossings →
 *   { items: [{ stationSlug, artists: [{ name, spins, popular, debut, heard, inLibrary }] }] }
 *
 * Instead of crossing live stations with the USER's library (which is empty
 * for new users), this crosses each live-ish station's last-24h spins with
 * Lore's most-played artists overall (180-day spin counts). The global
 * computation is user-independent and cached in-process for 30 minutes; only
 * the cheap per-user flags (heard / inLibrary) are computed per request.
 *
 * Flags:
 *   popular   — artist ranks in Lore's top-played set (lime green client-side)
 *   debut     — artist's first spin on Lore ever was within the last 7 days
 *               (canary yellow: "first time played on Lore at all")
 *   heard     — this user has credited attendance for the artist (any track).
 *               A heard-but-not-kept artist is deliberately NOT surfaced as
 *               new — they listened and chose not to add it.
 *   inLibrary — artist matches the user's library artists, unresolved Spotify
 *               soft rows, or taste seeds (orange-red name client-side)
 */
import { Router, type IRouter } from "express";
import {
  db,
  attendanceRollupsTable,
  libraryItemsTable,
  recordingsTable,
  spotifyLibraryItemsTable,
  tasteSeedsTable,
} from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

// Same junk filter as crossings.ts — keeps URL/domain noise out of sentences.
const JUNK_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

export interface PopularCrossingArtist {
  name: string;
  /** 180-day spin count across all of Lore. */
  spins: number;
  popular: boolean;
  debut: boolean;
  heard: boolean;
  inLibrary: boolean;
}
// Artists per station arrive in spin order (most recent first) and include
// EVERY artist in the station's last-24h set — the client renders the full
// setlist and derives both sort modes (popular-heavy / deep-cuts) locally.
export interface PopularCrossingsItem {
  stationSlug: string;
  artists: PopularCrossingArtist[];
}

// How many top-played artists count as "popular on Lore".
const POPULAR_TOP_N = 100;
// Artists whose first-ever Lore spin is younger than this are "debuts".
// (Approximated within the 180-day stats scan — see crossings perf memory:
// unbounded scans hang, and a 173-day-old "debut" is not a debut anyway.)
const DEBUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GLOBAL_CACHE_TTL_MS = 30 * 60 * 1000;

interface GlobalRow {
  slug: string;
  akey: string;   // lower(trim(artist)) — join/lookup key
  name: string;   // display casing
  spins: number;
  firstPlayed: Date;
  /** Most recent spin of this artist on this station (24h window) — drives setlist order. */
  lastSpin: Date;
}
let globalCache: { builtAt: number; rows: GlobalRow[]; popularKeys: Set<string> } | null = null;
/** Test-only: force the next request to recompute the global window. */
export function _testOnly_clearPopularCrossingsCache(): void { globalCache = null; }

async function loadGlobal(): Promise<NonNullable<typeof globalCache>> {
  if (globalCache && Date.now() - globalCache.builtAt < GLOBAL_CACHE_TTL_MS) return globalCache;

  const dayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const scanCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  // One bounded pass: 24h station/artist window, then 180-day per-artist
  // stats restricted to just the artists seen in that window.
  const res = await db.execute(sql`
    with win as (
      select st.slug,
             lower(trim(r.artist)) as akey,
             min(trim(r.artist))   as name,
             max(s.played_at)      as last_spin
      from spins s
      join stations st on st.id = s.station_id
      join recordings r on r.mbid = s.mbid
      where s.played_at >= ${dayCutoff}
        and s.mbid is not null
        and st.hidden = false
        and r.artist !~* ${JUNK_ARTIST_SQL_RE}
      group by 1, 2
    ),
    stats as (
      select lower(trim(r.artist)) as akey,
             count(*)::int         as spins,
             min(s.played_at)      as first_played
      from spins s
      join recordings r on r.mbid = s.mbid
      where s.played_at >= ${scanCutoff}
        and lower(trim(r.artist)) in (select distinct akey from win)
      group by 1
    )
    select w.slug, w.akey, w.name, w.last_spin, st.spins, st.first_played
    from win w
    join stats st using (akey)
  `);
  const rows: GlobalRow[] = (res.rows as Array<Record<string, unknown>>).map((r) => ({
    slug: String(r.slug),
    akey: String(r.akey),
    name: String(r.name),
    spins: Number(r.spins),
    firstPlayed: new Date(String(r.first_played)),
    lastSpin: new Date(String(r.last_spin)),
  }));

  // Popular set: top N distinct artists by 180-day spins.
  const byArtist = new Map<string, number>();
  for (const r of rows) byArtist.set(r.akey, r.spins);
  const popularKeys = new Set(
    [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, POPULAR_TOP_N).map(([k]) => k),
  );

  globalCache = { builtAt: Date.now(), rows, popularKeys };
  return globalCache;
}

router.get("/me/popular-crossings", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const [{ rows, popularKeys }, heardRows, libRows, softRows, seedRows] = await Promise.all([
    loadGlobal(),
    // Artists this user has credited attendance for (any recording).
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${recordingsTable.artist}))` })
      .from(attendanceRollupsTable)
      .innerJoin(recordingsTable, eq(recordingsTable.mbid, attendanceRollupsTable.recordingMbid))
      .where(eq(attendanceRollupsTable.userId, user.id)),
    // Artist names already in the user's kept/imported library.
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${recordingsTable.artist}))` })
      .from(libraryItemsTable)
      .innerJoin(recordingsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
      .where(eq(libraryItemsTable.userId, user.id)),
    // Unresolved Spotify soft-artist rows.
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
      .from(spotifyLibraryItemsTable)
      .where(and(
        eq(spotifyLibraryItemsTable.userId, user.id),
        isNull(spotifyLibraryItemsTable.mbid),
        ne(spotifyLibraryItemsTable.artist, ""),
      )),
    // Taste seeds (the "+" button writes here).
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${tasteSeedsTable.artistName}))` })
      .from(tasteSeedsTable)
      .where(eq(tasteSeedsTable.userId, user.id)),
  ]);

  const heard = new Set(heardRows.map((r) => r.akey));
  const inLib = new Set([...libRows, ...softRows, ...seedRows].map((r) => r.akey));
  const debutCutoff = Date.now() - DEBUT_WINDOW_MS;

  // Ship EVERY artist in the station's recent set, in spin order (most
  // recent first). The client renders the full setlist and filters/styles
  // by the flags; both sort modes are derived client-side from this payload.
  const byStation = new Map<string, Array<PopularCrossingArtist & { _lastSpin: number }>>();
  for (const r of rows) {
    const artist = {
      name: r.name,
      spins: r.spins,
      popular: popularKeys.has(r.akey),
      debut: r.firstPlayed.getTime() >= debutCutoff,
      heard: heard.has(r.akey),
      inLibrary: inLib.has(r.akey),
      _lastSpin: r.lastSpin.getTime(),
    };
    const list = byStation.get(r.slug) ?? [];
    list.push(artist);
    byStation.set(r.slug, list);
  }

  const items: PopularCrossingsItem[] = [...byStation.entries()].map(([stationSlug, artists]) => ({
    stationSlug,
    // Spin order: most recently played first.
    artists: artists
      .sort((a, b) => b._lastSpin - a._lastSpin)
      .map(({ _lastSpin, ...a }) => a),
  }));

  return res.json({ items });
}));

export default router;
