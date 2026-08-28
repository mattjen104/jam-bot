import { Router, type IRouter } from "express";
import { GetIndexQueryParams, GetIndexResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type Cursor = { name: string; id: string };

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(decoded) &&
      decoded.length === 2 &&
      typeof decoded[0] === "string" &&
      typeof decoded[1] === "string"
    ) {
      return { name: decoded[0], id: decoded[1] };
    }
  } catch {
    // Invalid cursors are treated as the first page rather than becoming a
    // database error or producing an unbounded request.
  }
  return null;
}

function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name.toLowerCase(), id]), "utf8").toString("base64url");
}

function pageLimit(value: number | undefined): number {
  return Math.max(1, Math.min(MAX_LIMIT, value ?? DEFAULT_LIMIT));
}

type IndexRow = {
  id: string;
  name: string;
  secondary: string | null;
  href: string | null;
  sortName: string;
};

async function readIndex(
  section: "releases" | "artists" | "stations" | "selectors",
  q: string,
  artistMbid: string | null,
  stationSlug: string | null,
  cursor: Cursor | null,
  limit: number,
): Promise<{ items: IndexRow[]; total: number; hasMore: boolean }> {
  const query = q.toLowerCase();
  const cursorName = cursor?.name ?? null;
  const cursorId = cursor?.id ?? null;
  const search = `%${query}%`;

  if (section === "releases") {
    const count = await db.execute<{ total: number }>(sql`
      WITH entities AS (
        SELECT
          rrg.release_group_mbid AS id,
          MAX(COALESCE(rrg.title, '')) AS name,
          MAX(rr.artist) AS artist
        FROM recording_release_groups rrg
        INNER JOIN recordings rr ON rr.mbid = rrg.recording_mbid
        WHERE rrg.title IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM spins sp
            INNER JOIN stations st ON st.id = sp.station_id
            WHERE sp.mbid = rr.mbid
              AND st.active = true
              AND st.hidden = false
              AND st.crossing_eligible = true
              AND (${stationSlug}::text IS NULL OR st.slug = ${stationSlug})
          )
        GROUP BY rrg.release_group_mbid
      )
      SELECT COUNT(*)::int AS total
      FROM entities
      WHERE (lower(name) LIKE ${search} OR lower(COALESCE(artist, '')) LIKE ${search})
    `);
    const rows = await db.execute<IndexRow>(sql`
      WITH entities AS (
        SELECT
          rrg.release_group_mbid AS id,
          MAX(COALESCE(rrg.title, '')) AS name,
          MAX(rr.artist) AS artist
        FROM recording_release_groups rrg
        INNER JOIN recordings rr ON rr.mbid = rrg.recording_mbid
        WHERE rrg.title IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM spins sp
            INNER JOIN stations st ON st.id = sp.station_id
            WHERE sp.mbid = rr.mbid
              AND st.active = true
              AND st.hidden = false
              AND st.crossing_eligible = true
              AND (${stationSlug}::text IS NULL OR st.slug = ${stationSlug})
          )
        GROUP BY rrg.release_group_mbid
      )
      SELECT
        id,
        name,
        artist AS secondary,
        '/album/' || id AS href,
        lower(name) AS "sortName"
      FROM entities
      WHERE (lower(name) LIKE ${search} OR lower(COALESCE(artist, '')) LIKE ${search})
        AND (${cursorName}::text IS NULL OR lower(name) > ${cursorName}
          OR (lower(name) = ${cursorName} AND id > ${cursorId}))
      ORDER BY lower(name) ASC, id ASC
      LIMIT ${limit + 1}
    `);
    return { items: rows.rows.slice(0, limit), total: count.rows[0]?.total ?? 0, hasMore: rows.rows.length > limit };
  }

  if (section === "artists") {
    const count = await db.execute<{ total: number }>(sql`
      WITH entities AS (
        SELECT
          COALESCE(rr.artist_mbid, 'name:' || lower(rr.artist)) AS id,
          MAX(rr.artist) AS name,
          rr.artist_mbid AS artist_mbid
        FROM recordings rr
        WHERE NULLIF(trim(rr.artist), '') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM spins sp
            INNER JOIN stations st ON st.id = sp.station_id
            WHERE sp.mbid = rr.mbid
              AND st.active = true
              AND st.hidden = false
              AND st.crossing_eligible = true
              AND (${stationSlug}::text IS NULL OR st.slug = ${stationSlug})
          )
        GROUP BY COALESCE(rr.artist_mbid, 'name:' || lower(rr.artist)), rr.artist_mbid
      )
      SELECT COUNT(*)::int AS total
      FROM entities
      WHERE lower(name) LIKE ${search}
        AND (${artistMbid}::text IS NULL OR artist_mbid = ${artistMbid})
    `);
    const rows = await db.execute<IndexRow>(sql`
      WITH entities AS (
        SELECT
          COALESCE(rr.artist_mbid, 'name:' || lower(rr.artist)) AS id,
          MAX(rr.artist) AS name,
          rr.artist_mbid AS artist_mbid
        FROM recordings rr
        WHERE NULLIF(trim(rr.artist), '') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM spins sp
            INNER JOIN stations st ON st.id = sp.station_id
            WHERE sp.mbid = rr.mbid
              AND st.active = true
              AND st.hidden = false
              AND st.crossing_eligible = true
              AND (${stationSlug}::text IS NULL OR st.slug = ${stationSlug})
          )
        GROUP BY COALESCE(rr.artist_mbid, 'name:' || lower(rr.artist)), rr.artist_mbid
      )
      SELECT
        id,
        name,
        NULL::text AS secondary,
        CASE WHEN artist_mbid IS NULL THEN NULL ELSE '/artist/' || artist_mbid END AS href,
        lower(name) AS "sortName"
      FROM entities
      WHERE lower(name) LIKE ${search}
        AND (${artistMbid}::text IS NULL OR artist_mbid = ${artistMbid})
        AND (${cursorName}::text IS NULL OR lower(name) > ${cursorName}
          OR (lower(name) = ${cursorName} AND id > ${cursorId}))
      ORDER BY lower(name) ASC, id ASC
      LIMIT ${limit + 1}
    `);
    return { items: rows.rows.slice(0, limit), total: count.rows[0]?.total ?? 0, hasMore: rows.rows.length > limit };
  }

  if (section === "stations") {
    const count = await db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total
      FROM stations st
      WHERE st.active = true
        AND st.hidden = false
        AND st.crossing_eligible = true
        AND (${query} = '' OR lower(st.name) LIKE ${search} OR lower(COALESCE(st.org, '')) LIKE ${search})
        AND (
          ${artistMbid}::text IS NULL OR EXISTS (
            SELECT 1
            FROM spins sp
            INNER JOIN recordings rr ON rr.mbid = sp.mbid
            WHERE sp.station_id = st.id
              AND rr.artist_mbid = ${artistMbid}
          )
        )
        AND (${stationSlug}::text IS NULL OR st.slug = ${stationSlug})
    `);
    const rows = await db.execute<IndexRow>(sql`
      SELECT
        st.slug AS id,
        st.name,
        COALESCE(NULLIF(trim(st.org), ''), NULLIF(trim(st.city), ''), NULLIF(trim(st.country), '')) AS secondary,
        '/archive/stations/' || st.slug AS href,
        lower(st.name) AS "sortName"
      FROM stations st
      WHERE st.active = true
        AND st.hidden = false
        AND st.crossing_eligible = true
        AND (${query} = '' OR lower(st.name) LIKE ${search} OR lower(COALESCE(st.org, '')) LIKE ${search})
        AND (
          ${artistMbid}::text IS NULL OR EXISTS (
            SELECT 1
            FROM spins sp
            INNER JOIN recordings rr ON rr.mbid = sp.mbid
            WHERE sp.station_id = st.id
              AND rr.artist_mbid = ${artistMbid}
          )
        )
        AND (${stationSlug}::text IS NULL OR st.slug = ${stationSlug})
        AND (${cursorName}::text IS NULL OR lower(st.name) > ${cursorName}
          OR (lower(st.name) = ${cursorName} AND st.slug > ${cursorId}))
      ORDER BY lower(st.name) ASC, st.slug ASC
      LIMIT ${limit + 1}
    `);
    return { items: rows.rows.slice(0, limit), total: count.rows[0]?.total ?? 0, hasMore: rows.rows.length > limit };
  }

  const count = await db.execute<{ total: number }>(sql`
    SELECT COUNT(*)::int AS total
    FROM pickers pk
    WHERE pk.active = true
      AND pk.picker_type = 'dj'
      AND NOT EXISTS (
        SELECT 1
        FROM selector_claims sc
        WHERE sc.picker_id = pk.id
          AND sc.opted_out = true
      )
      AND (${query} = '' OR lower(pk.name) LIKE ${search})
  `);
  const rows = await db.execute<IndexRow>(sql`
    SELECT
      pk.handle AS id,
      pk.name,
      NULL::text AS secondary,
      '/archive/selectors/' || pk.handle AS href,
      lower(pk.name) AS "sortName"
    FROM pickers pk
    WHERE pk.active = true
      AND pk.picker_type = 'dj'
      AND NOT EXISTS (
        SELECT 1
        FROM selector_claims sc
        WHERE sc.picker_id = pk.id
          AND sc.opted_out = true
      )
      AND (${query} = '' OR lower(pk.name) LIKE ${search})
      AND (${cursorName}::text IS NULL OR lower(pk.name) > ${cursorName}
        OR (lower(pk.name) = ${cursorName} AND pk.handle > ${cursorId}))
    ORDER BY lower(pk.name) ASC, pk.handle ASC
    LIMIT ${limit + 1}
  `);
  return { items: rows.rows.slice(0, limit), total: count.rows[0]?.total ?? 0, hasMore: rows.rows.length > limit };
}

router.get("/index", h(async (req, res) => {
  if (typeof req.query.section !== "string") {
    res.status(400).json({ error: "section is required" });
    return;
  }
  const parsed = GetIndexQueryParams.safeParse({
    ...req.query,
    limit: req.query.limit,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Index query" });
    return;
  }

  const { section, q = "", artistMbid = null, stationSlug = null, cursor, limit } = parsed.data;
  const page = await readIndex(
    section,
    q.trim(),
    artistMbid ?? null,
    stationSlug ?? null,
    decodeCursor(cursor),
    pageLimit(limit),
  );
  const last = page.items.at(-1);
  const nextCursor = last && page.hasMore
    ? encodeCursor(last.sortName, last.id)
    : null;

  return res.json(GetIndexResponse.parse({
    section,
    items: page.items.map(({ sortName: _sortName, ...item }) => item),
    total: page.total,
    nextCursor,
  }));
}));

export default router;