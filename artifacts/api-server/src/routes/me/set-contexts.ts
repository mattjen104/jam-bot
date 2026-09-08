/**
 * POST /api/me/library/set-contexts — batched "what played around it" context
 * for Library crate rows.
 *
 * Each anchor is either:
 *   { mbid }   — a kept/imported recording. When the keep retains its spin
 *                (library_items.spin_id), the set is that exact broadcast;
 *                otherwise we fall back to the artist path below.
 *   { artist } — an Artist Document / artist-file save with no kept tracks.
 *                The set is the most recent RESOLVED spin of that artist on
 *                any visible station.
 *
 * For every resolved anchor we return the spins immediately before and after
 * the anchor spin on the same station (keyset on (played_at, id)), plus the
 * station's homepage URL so cards can link out directly.
 *
 * Plain-JSON route (not orval-generated) — same fast-lane convention as the
 * track-expiry advisory payloads.
 *
 * Request:  { anchors: Array<{ mbid?: string; artist?: string }> }  (max 100)
 * Response: { contexts: { [key]: SetContext | null } }
 *   key = `mbid:<mbid>` or `artist:<lower(trimmed name)>`
 *   SetContext = { station, anchor, before, after } — before/after may be
 *   null at set boundaries; the whole value is null when no set was found.
 */
import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  recordingsTable,
  spinsTable,
  spotifyLibraryItemsTable,
  tasteSeedsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

const MAX_ANCHORS = 100;

interface SetContextTrack {
  spinId: number;
  mbid: string | null;
  title: string | null;
  artist: string | null;
  albumTitle: string | null;
  artworkUrl: string | null;
  releaseGroupMbid: string | null;
  playedAt: string;
}

interface SetContext {
  station: { slug: string; name: string; homepageUrl: string | null };
  /**
   * "kept-spin": the anchor is the exact broadcast the keep came from.
   * "artist-fallback": the anchor is the artist's most recent resolved spin —
   * a DIFFERENT song than any kept track. Clients must label this honestly.
   */
  anchorKind: "kept-spin" | "artist-fallback";
  anchor: SetContextTrack;
  before: SetContextTrack | null;
  after: SetContextTrack | null;
}

type AnchorInput = { mbid?: unknown; artist?: unknown };

/** One neighbor/anchor track sub-select against spins + recordings. */
function trackColumns(alias: string, out: string) {
  return sql`
    ${sql.raw(alias)}.id AS ${sql.raw(out)}_spin_id,
    ${sql.raw(alias)}.mbid AS ${sql.raw(out)}_mbid,
    ${sql.raw(alias)}.played_at AS ${sql.raw(out)}_played_at,
    coalesce(r_${sql.raw(out)}.title, ${sql.raw(alias)}.raw_title) AS ${sql.raw(out)}_title,
    coalesce(r_${sql.raw(out)}.artist, ${sql.raw(alias)}.raw_artist) AS ${sql.raw(out)}_artist,
    r_${sql.raw(out)}.artwork_url AS ${sql.raw(out)}_artwork_url,
    (
      SELECT title FROM recording_release_groups
      WHERE recording_mbid = ${sql.raw(alias)}.mbid AND is_primary = true LIMIT 1
    ) AS ${sql.raw(out)}_album_title,
    (
      SELECT release_group_mbid FROM recording_release_groups
      WHERE recording_mbid = ${sql.raw(alias)}.mbid AND is_primary = true LIMIT 1
    ) AS ${sql.raw(out)}_release_group_mbid
  `;
}

router.post("/me/library/set-contexts", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const body = req.body as { anchors?: unknown };
  if (!Array.isArray(body?.anchors) || body.anchors.length > MAX_ANCHORS) {
    return res.status(400).json({ error: `anchors must be an array of at most ${MAX_ANCHORS}` });
  }

  const mbidAnchors: string[] = [];
  const artistAnchors: string[] = [];
  for (const raw of body.anchors as AnchorInput[]) {
    if (typeof raw !== "object" || raw === null) {
      return res.status(400).json({ error: "each anchor must be an object" });
    }
    if (typeof raw.mbid === "string" && raw.mbid.trim()) {
      mbidAnchors.push(raw.mbid.trim());
    } else if (typeof raw.artist === "string" && raw.artist.trim()) {
      artistAnchors.push(raw.artist.trim());
    } else {
      return res.status(400).json({ error: "each anchor needs an mbid or artist" });
    }
  }

  const contexts: Record<string, SetContext | null> = {};
  for (const mbid of mbidAnchors) contexts[`mbid:${mbid}`] = null;
  for (const artist of artistAnchors) contexts[`artist:${artist.toLowerCase()}`] = null;

  // key → anchor spin identity
  const anchorSpins = new Map<string, { spinId: number; stationId: number; playedAt: Date }>();
  // context keys resolved from the keep's own retained spin
  const spinBackedKeys = new Set<string>();
  // artist keys (lower(trim)) still needing a fallback set lookup
  const fallbackArtists = new Map<string, string[]>(); // akey → context keys

  // ── 1. Spin-backed keeps: library_items.spin_id is the exact broadcast ────
  if (mbidAnchors.length > 0) {
    const keepRows = await db
      .select({
        mbid: libraryItemsTable.mbid,
        spinId: libraryItemsTable.spinId,
        artist: recordingsTable.artist,
      })
      .from(libraryItemsTable)
      .leftJoin(recordingsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
      .where(and(
        eq(libraryItemsTable.userId, user.id),
        inArray(libraryItemsTable.mbid, mbidAnchors),
        isNull(libraryItemsTable.removedAt),
      ));

    const spinIds = [...new Set(
      keepRows.map((r) => r.spinId).filter((id): id is number => id != null),
    )];
    const spinRows = spinIds.length > 0
      ? await db
          .select({ id: spinsTable.id, stationId: spinsTable.stationId, playedAt: spinsTable.playedAt })
          .from(spinsTable)
          .where(inArray(spinsTable.id, spinIds))
      : [];
    const spinById = new Map(spinRows.map((s) => [s.id, s]));

    for (const row of keepRows) {
      const key = `mbid:${row.mbid}`;
      const spin = row.spinId != null ? spinById.get(row.spinId) : undefined;
      if (spin) {
        anchorSpins.set(key, { spinId: spin.id, stationId: spin.stationId, playedAt: spin.playedAt });
        spinBackedKeys.add(key);
      } else if (row.artist?.trim()) {
        // Kept without a retained spin (imports, manual keeps) — fall back to
        // the artist's most recent resolved set.
        const akey = row.artist.trim().toLowerCase();
        fallbackArtists.set(akey, [...(fallbackArtists.get(akey) ?? []), key]);
      }
    }
  }

  // ── 2. Artist-file saves (and spinless keeps): most recent resolved spin ──
  // Artist anchors must belong to the requesting listener's own taste
  // universe — artist-file seeds, active library tracks, or unresolved
  // imports — otherwise the endpoint would resolve arbitrary artists for
  // anyone. Unowned artists stay an explicit null context.
  if (artistAnchors.length > 0) {
    const [seedRows, libArtistRows, softArtistRows] = await Promise.all([
      db
        .selectDistinct({ akey: sql<string>`lower(trim(${tasteSeedsTable.artistName}))` })
        .from(tasteSeedsTable)
        .where(eq(tasteSeedsTable.userId, user.id)),
      db
        .selectDistinct({ akey: sql<string>`lower(trim(${recordingsTable.artist}))` })
        .from(libraryItemsTable)
        .innerJoin(recordingsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
        .where(and(eq(libraryItemsTable.userId, user.id), isNull(libraryItemsTable.removedAt))),
      db
        .selectDistinct({ akey: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
        .from(spotifyLibraryItemsTable)
        .where(and(
          eq(spotifyLibraryItemsTable.userId, user.id),
          isNull(spotifyLibraryItemsTable.mbid),
          isNull(spotifyLibraryItemsTable.removedAt),
          ne(spotifyLibraryItemsTable.artist, ""),
        )),
    ]);
    const allowed = new Set([...seedRows, ...libArtistRows, ...softArtistRows].map((r) => r.akey));
    for (const artist of artistAnchors) {
      const akey = artist.toLowerCase();
      if (!allowed.has(akey)) continue;
      fallbackArtists.set(akey, [...(fallbackArtists.get(akey) ?? []), `artist:${akey}`]);
    }
  }

  if (fallbackArtists.size > 0) {
    const akeys = [...fallbackArtists.keys()];
    const values = sql.join(akeys.map((k) => sql`(${k})`), sql`, `);
    const latest = await db.execute(sql`
      SELECT DISTINCT ON (v.akey)
        v.akey, s.id AS spin_id, s.station_id, s.played_at
      FROM (VALUES ${values}) AS v(akey)
      JOIN recordings r ON lower(trim(r.artist)) = v.akey
      JOIN spins s ON s.mbid = r.mbid
      JOIN stations st ON st.id = s.station_id AND st.hidden = false
      ORDER BY v.akey, s.played_at DESC, s.id DESC
    `);
    for (const row of latest.rows as Array<{
      akey: string; spin_id: number; station_id: number; played_at: string;
    }>) {
      for (const key of fallbackArtists.get(String(row.akey)) ?? []) {
        anchorSpins.set(key, {
          spinId: Number(row.spin_id),
          stationId: Number(row.station_id),
          playedAt: new Date(row.played_at),
        });
      }
    }
  }

  if (anchorSpins.size === 0) return res.json({ contexts });

  // ── 3. Neighbors: one query, lateral keyset lookups on (played_at, id) ────
  const anchorList = [...anchorSpins.entries()];
  const anchorValues = sql.join(
    anchorList.map(([key, a]) =>
      sql`(${key}, ${a.spinId}::integer, ${a.stationId}::integer, ${a.playedAt.toISOString()}::timestamptz)`
    ),
    sql`, `,
  );

  const result = await db.execute(sql`
    SELECT
      a.key,
      st.slug AS station_slug,
      st.name AS station_name,
      st.homepage_url AS station_homepage_url,
      ${trackColumns("s", "a")},
      b.b_spin_id, b.b_mbid, b.b_played_at, b.b_title, b.b_artist, b.b_artwork_url, b.b_album_title, b.b_release_group_mbid,
      af.af_spin_id, af.af_mbid, af.af_played_at, af.af_title, af.af_artist, af.af_artwork_url, af.af_album_title, af.af_release_group_mbid
    FROM (VALUES ${anchorValues}) AS a(key, spin_id, station_id, played_at)
    JOIN stations st ON st.id = a.station_id
    JOIN spins s ON s.id = a.spin_id
    LEFT JOIN recordings r_a ON r_a.mbid = s.mbid
    LEFT JOIN LATERAL (
      SELECT ${trackColumns("s2", "b")}
      FROM spins s2
      LEFT JOIN recordings r_b ON r_b.mbid = s2.mbid
      WHERE s2.station_id = a.station_id
        AND (s2.played_at, s2.id) < (a.played_at, a.spin_id)
        -- Set-boundary guard: a gap over 20 minutes means a show change, ad
        -- break, or metadata outage — omit the neighbor rather than imply it
        -- belonged to the same set.
        AND s2.played_at > a.played_at - interval '20 minutes'
      ORDER BY s2.played_at DESC, s2.id DESC
      LIMIT 1
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT ${trackColumns("s3", "af")}
      FROM spins s3
      LEFT JOIN recordings r_af ON r_af.mbid = s3.mbid
      WHERE s3.station_id = a.station_id
        AND (s3.played_at, s3.id) > (a.played_at, a.spin_id)
        AND s3.played_at < a.played_at + interval '20 minutes'
      ORDER BY s3.played_at ASC, s3.id ASC
      LIMIT 1
    ) af ON true
  `);

  type Row = Record<string, unknown>;
  const trackFrom = (row: Row, p: string): SetContextTrack | null => {
    const spinId = row[`${p}_spin_id`];
    if (spinId == null) return null;
    return {
      spinId: Number(spinId),
      mbid: (row[`${p}_mbid`] as string | null) ?? null,
      title: (row[`${p}_title`] as string | null) ?? null,
      artist: (row[`${p}_artist`] as string | null) ?? null,
      albumTitle: (row[`${p}_album_title`] as string | null) ?? null,
      artworkUrl: (row[`${p}_artwork_url`] as string | null) ?? null,
      releaseGroupMbid: (row[`${p}_release_group_mbid`] as string | null) ?? null,
      playedAt: new Date(row[`${p}_played_at`] as string).toISOString(),
    };
  };

  for (const row of result.rows as Row[]) {
    const anchor = trackFrom(row, "a");
    if (!anchor) continue;
    const key = String(row.key);
    contexts[key] = {
      anchorKind: spinBackedKeys.has(key) ? "kept-spin" : "artist-fallback",
      station: {
        slug: String(row.station_slug),
        name: String(row.station_name),
        homepageUrl: (row.station_homepage_url as string | null) ?? null,
      },
      anchor,
      before: trackFrom(row, "b"),
      after: trackFrom(row, "af"),
    };
  }

  return res.json({ contexts });
}));

export default router;
