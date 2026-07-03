import { Router, type IRouter } from "express";
import {
  GetPickersDialResponse,
  ListPickersResponse,
  GetPickerArchiveParams,
  GetPickerArchiveResponse,
  GetPickerStationOverlapsParams,
  GetPickerStationOverlapsResponse,
  LookupPickedMbidsQueryParams,
  LookupPickedMbidsResponse,
} from "@workspace/api-zod";
import {
  db,
  pickersTable,
  picksTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import { eq, ne, and, asc, isNotNull, inArray, sql } from "drizzle-orm";
import { getPickerByHandle } from "../../lore/picks.js";
import { resolvePickRunIds } from "../../lore/runs.js";
import { h } from "../../middlewares/asyncHandler.js";
import { toPicker } from "./shared.js";

const router: IRouter = Router();

// GET /api/pickers/dial — all active pickers with latest-run mosaic data.
// Returns one item per picker: run metadata + first 4 tracks for the artwork
// mosaic. Single CTE query; no per-picker round trips.
router.get("/pickers/dial", h(async (_req, res) => {
  type DialRow = {
    picker_id: number;
    name: string;
    handle: string;
    picker_type: string;
    trust_tier: number;
    home_url: string | null;
    description: string | null;
    run_id: number | null;
    run_title: string | null;
    track_count: number | null;
    resolved_count: number | null;
    source_url: string | null;
    picked_at: Date | null;
    mbid: string | null;
    track_title: string | null;
    track_artist: string | null;
    artwork_url: string | null;
    rn: number | null;
  };

  const result = await db.execute<DialRow>(sql`
    WITH grouped AS (
      SELECT picker_id, source_url,
        MIN(id)::int      AS run_id,
        MAX(context)      AS title,
        COUNT(*)::int     AS track_count,
        COUNT(mbid)::int  AS resolved_count,
        MAX(picked_at)    AS latest_at,
        MIN(picked_at)    AS first_at
      FROM picks
      WHERE source_url IS NOT NULL
      GROUP BY picker_id, source_url
    ),
    latest AS (
      SELECT DISTINCT ON (picker_id) *
      FROM grouped
      ORDER BY picker_id, latest_at DESC NULLS LAST, run_id ASC
    ),
    preview AS (
      SELECT
        p.picker_id,
        COALESCE(r.title,  p.raw_title,  '') AS track_title,
        COALESCE(r.artist, p.raw_artist, '') AS track_artist,
        r.artwork_url,
        p.mbid,
        ROW_NUMBER() OVER (
          PARTITION BY p.picker_id
          ORDER BY COALESCE(p.ordinal, 2147483647), p.id
        ) AS rn
      FROM picks p
      INNER JOIN latest lr ON p.picker_id = lr.picker_id
                          AND p.source_url = lr.source_url
      LEFT JOIN recordings r ON p.mbid = r.mbid
    )
    SELECT
      pk.id          AS picker_id,
      pk.name,
      pk.handle,
      pk.picker_type,
      pk.trust_tier,
      pk.home_url,
      pk.description,
      lr.run_id,
      lr.title       AS run_title,
      lr.track_count,
      lr.resolved_count,
      lr.source_url,
      lr.first_at    AS picked_at,
      pr.mbid,
      pr.track_title,
      pr.track_artist,
      pr.artwork_url,
      pr.rn
    FROM pickers pk
    LEFT JOIN latest  lr ON lr.picker_id = pk.id
    LEFT JOIN preview pr ON pr.picker_id = pk.id AND pr.rn <= 4
    WHERE pk.active = true
    ORDER BY pk.trust_tier, pk.name, pr.rn ASC NULLS LAST
  `);

  // Group rows into one item per picker.
  const itemMap = new Map<number, {
    picker: { id: number; pickerType: string; name: string; handle: string; homeUrl: string | null; trustTier: number; description: string | null };
    run: { runId: number; title: string | null; sourceUrl: string; trackCount: number; resolvedCount: number; pickedAt: string | null } | null;
    previewTracks: { mbid: string | null; title: string; artist: string; artworkUrl: string | null }[];
  }>();

  for (const row of result.rows) {
    if (!itemMap.has(row.picker_id)) {
      itemMap.set(row.picker_id, {
        picker: {
          id: row.picker_id,
          pickerType: row.picker_type,
          name: row.name,
          handle: row.handle,
          homeUrl: row.home_url,
          trustTier: row.trust_tier,
          description: row.description,
        },
        run: row.run_id != null && row.source_url != null
          ? {
              runId: row.run_id,
              title: row.run_title,
              sourceUrl: row.source_url,
              trackCount: row.track_count ?? 0,
              resolvedCount: row.resolved_count ?? 0,
              pickedAt: row.picked_at ? new Date(row.picked_at).toISOString() : null,
            }
          : null,
        previewTracks: [],
      });
    }
    const item = itemMap.get(row.picker_id)!;
    if (row.rn != null) {
      item.previewTracks.push({
        mbid: row.mbid,
        title: row.track_title ?? "",
        artist: row.track_artist ?? "",
        artworkUrl: row.artwork_url,
      });
    }
  }

  // Only return pickers that have at least one documented run.
  const items = [...itemMap.values()].filter((it) => it.run != null);

  return res.json(GetPickersDialResponse.parse({ items }));
}));

// GET /api/pickers — public list of taste sources beyond radio DJs.
// Optional ?type= filter narrows to a specific pickerType (e.g. "editorial").
router.get("/pickers", h(async (req, res) => {
  const typeFilter =
    typeof req.query["type"] === "string" ? req.query["type"].trim() : null;
  const rows = await db
    .select()
    .from(pickersTable)
    .where(
      typeFilter
        ? and(eq(pickersTable.active, true), eq(pickersTable.pickerType, typeFilter))
        : eq(pickersTable.active, true),
    )
    .orderBy(asc(pickersTable.trustTier), asc(pickersTable.name));

  // Resolve the latest runId per picker (min pick.id of the most-recently-ingested sourceUrl).
  const latestRunById = new Map<number, number>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const runRows = await db
      .select({
        pickerId: picksTable.pickerId,
        latestAt: sql<Date>`max(${picksTable.pickedAt})`,
        runId: sql<number>`min(${picksTable.id})`,
      })
      .from(picksTable)
      .where(and(inArray(picksTable.pickerId, ids), isNotNull(picksTable.sourceUrl)))
      .groupBy(picksTable.pickerId, picksTable.sourceUrl);

    const latestAtByPicker = new Map<number, Date>();
    for (const r of runRows) {
      if (r.pickerId == null || r.latestAt == null) continue;
      const prev = latestAtByPicker.get(r.pickerId);
      if (!prev || r.latestAt > prev) {
        latestAtByPicker.set(r.pickerId, r.latestAt);
        latestRunById.set(r.pickerId, r.runId);
      }
    }
  }

  return res.json(
    ListPickersResponse.parse({
      pickers: rows.map((r) => toPicker(r, latestRunById.get(r.id) ?? null)),
    }),
  );
}));

// GET /api/pickers/:handle/archive — a picker's documented runs, newest first.
router.get("/pickers/:handle/archive", h(async (req, res) => {
  const parsed = GetPickerArchiveParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Picker not found" });
  }

  const picker = await getPickerByHandle(parsed.data.handle);
  if (!picker) {
    return res.status(404).json({ error: "Picker not found" });
  }

  const runs = await db
    .select({
      runId: sql<number>`min(${picksTable.id})`,
      sourceUrl: picksTable.sourceUrl,
      title: sql<string | null>`max(${picksTable.context})`,
      pickedAt: sql<string | null>`min(${picksTable.pickedAt})`,
      trackCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${picksTable.mbid} is not null)::int`,
    })
    .from(picksTable)
    .where(
      and(eq(picksTable.pickerId, picker.id), isNotNull(picksTable.sourceUrl)),
    )
    .groupBy(picksTable.sourceUrl)
    .orderBy(
      sql`min(${picksTable.pickedAt}) desc nulls last`,
      sql`min(${picksTable.id}) desc`,
    )
    .limit(200);

  return res.json(
    GetPickerArchiveResponse.parse({
      picker: toPicker(picker),
      runs: runs.map((r) => ({
        runId: r.runId,
        title: r.title ?? null,
        sourceUrl: r.sourceUrl as string,
        pickedAt: r.pickedAt ? new Date(r.pickedAt).toISOString() : null,
        trackCount: r.trackCount,
        resolvedCount: r.resolvedCount,
      })),
    }),
  );
}));

// GET /api/pickers/:handle/overlaps/stations — "On the radio too":
// stations whose logged spin history contains recordings this picker has picked.
// Exact MBID overlap only — never similarity.
router.get("/pickers/:handle/overlaps/stations", h(async (req, res) => {
  const parsed = GetPickerStationOverlapsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Picker not found" });
  }

  const picker = await getPickerByHandle(parsed.data.handle);
  if (!picker) {
    return res.status(404).json({ error: "Picker not found" });
  }

  const pickerMbids = db
    .select({ mbid: picksTable.mbid })
    .from(picksTable)
    .where(and(eq(picksTable.pickerId, picker.id), isNotNull(picksTable.mbid)));

  const sharedExpr = sql<number>`count(distinct ${spinsTable.mbid})::int`;
  const rows = await db
    .select({
      slug: stationsTable.slug,
      name: stationsTable.name,
      stationClass: stationsTable.stationClass,
      sharedCount: sharedExpr,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .where(and(isNotNull(spinsTable.mbid), inArray(spinsTable.mbid, pickerMbids)))
    .groupBy(stationsTable.id, stationsTable.slug, stationsTable.name, stationsTable.stationClass)
    .orderBy(
      sql`count(distinct ${spinsTable.mbid}) desc`,
      asc(stationsTable.name),
    )
    .limit(12);

  return res.json(
    GetPickerStationOverlapsResponse.parse({
      picker: {
        name: picker.name,
        handle: picker.handle,
        pickerType: picker.pickerType,
        trustTier: picker.trustTier,
      },
      items: rows.map((r) => ({
        station: {
          slug: r.slug,
          name: r.name,
          stationClass: r.stationClass,
        },
        sharedCount: r.sharedCount,
      })),
    }),
  );
}));

/**
 * In-memory cache for the dial's "also picked" lookup. The dial polls every
 * 30s with the same handful of MBIDs, so a short TTL keeps this endpoint off
 * the database almost entirely. Entries cache misses too (null) so unpicked
 * tracks don't re-query. Bounded: cleared wholesale if it ever grows past cap.
 */
type PickedHit = {
  mbid: string;
  picker: { name: string; handle: string; pickerType: string; trustTier: number };
  runId: number | null;
  listTitle: string | null;
};
const pickedLookupCache = new Map<string, { at: number; hit: PickedHit | null }>();
const PICKED_CACHE_TTL_MS = 60_000;
const PICKED_CACHE_MAX = 5_000;
const PICKED_BATCH_MAX = 30;

// GET /api/picks/contains?mbids=a,b,c — which of these recordings appear in an
// editorial (non-DJ) picker's list. Batched + cached so it never slows the
// live dial poll; MBIDs with no editorial pick are simply absent from items.
router.get("/picks/contains", h(async (req, res) => {
  const parsed = LookupPickedMbidsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "mbids is required" });
  }
  const mbids = [
    ...new Set(
      parsed.data.mbids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, PICKED_BATCH_MAX);

  const now = Date.now();
  const items: PickedHit[] = [];
  const misses: string[] = [];
  for (const mbid of mbids) {
    const cached = pickedLookupCache.get(mbid);
    if (cached && now - cached.at < PICKED_CACHE_TTL_MS) {
      if (cached.hit) items.push(cached.hit);
    } else {
      misses.push(mbid);
    }
  }

  if (misses.length > 0) {
    const rows = await db
      .select({
        mbid: picksTable.mbid,
        pickerId: picksTable.pickerId,
        sourceUrl: picksTable.sourceUrl,
        context: picksTable.context,
        name: pickersTable.name,
        handle: pickersTable.handle,
        pickerType: pickersTable.pickerType,
        trustTier: pickersTable.trustTier,
      })
      .from(picksTable)
      .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
      .where(
        and(
          inArray(picksTable.mbid, misses),
          eq(pickersTable.active, true),
          ne(pickersTable.pickerType, "dj"),
        ),
      )
      .orderBy(
        asc(pickersTable.trustTier),
        sql`${picksTable.pickedAt} desc nulls last`,
        asc(picksTable.id),
      );

    // Strongest pick per mbid = first row in the trust-ordered scan.
    const bestByMbid = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.mbid && !bestByMbid.has(r.mbid)) bestByMbid.set(r.mbid, r);
    }

    // Resolve run anchors for the chosen picks in one grouped query.
    const chosen = [...bestByMbid.values()].filter((r) => r.sourceUrl != null);
    const runByKey = await resolvePickRunIds(
      chosen.map((r) => ({ pickerId: r.pickerId, sourceUrl: r.sourceUrl! })),
    );

    if (pickedLookupCache.size > PICKED_CACHE_MAX) pickedLookupCache.clear();
    for (const mbid of misses) {
      const best = bestByMbid.get(mbid);
      const hit: PickedHit | null = best
        ? {
            mbid,
            picker: {
              name: best.name,
              handle: best.handle,
              pickerType: best.pickerType,
              trustTier: best.trustTier,
            },
            runId:
              best.sourceUrl != null
                ? runByKey.get(`${best.pickerId}|${best.sourceUrl}`) ?? null
                : null,
            listTitle: best.context ?? null,
          }
        : null;
      pickedLookupCache.set(mbid, { at: now, hit });
      if (hit) items.push(hit);
    }
  }

  return res.json(LookupPickedMbidsResponse.parse({ items }));
}));

export default router;
