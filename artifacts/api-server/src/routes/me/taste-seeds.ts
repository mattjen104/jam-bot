/**
 * /me/taste-seeds — artist name seeds for zero-friction onboarding.
 *
 * GET  /api/me/taste-seeds     → { artists: string[] }
 * PUT  /api/me/taste-seeds     → body { artists: string[] } → { artists: string[] }
 *
 * Seeds flow through the crossing-score pipeline exactly like unresolved
 * Spotify soft-artist rows: stations playing a seeded artist appear in Zone 1.
 * A PUT atomically replaces the full list and busts both caches.
 */
import { Router, type IRouter } from "express";
import { db, tasteSeedsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import { bustCrossingsCache } from "./crossings.js";
import { bustLibraryHitCache } from "../../lore/library-hits.js";

const router: IRouter = Router();

// Raised from 10: the Also-On-Air "+" buttons append seeds one artist at a
// time, so the onboarding path needs headroom beyond the manual entry box.
const MAX_SEEDS = 50;
const MAX_ARTIST_LEN = 100;

/** Ordered list of seeded artist names for the authenticated user. */
router.get("/me/taste-seeds", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rows = await db
    .select({ artistName: tasteSeedsTable.artistName })
    .from(tasteSeedsTable)
    .where(eq(tasteSeedsTable.userId, user.id))
    .orderBy(tasteSeedsTable.createdAt);
  return res.json({ artists: rows.map((r) => r.artistName) });
}));

/**
 * Browsable, read-only catalogue for the undated artist membership section.
 * It uses only already-resolved Lore recordings/release groups; missing
 * catalogue data is represented by an empty release stack.
 */
router.get("/me/taste-seeds/catalog", h(async (req, res) => {
  const requested = String(req.query.artists ?? "")
    .split(",")
    .map((name) => decodeURIComponent(name).trim())
    .filter(Boolean)
    .slice(0, 20);
  const keys = [...new Set(requested.map((name) => name.toLocaleLowerCase()))];
  if (keys.length === 0) return res.json({ artists: {} });

  const result = await db.execute(sql`
    SELECT DISTINCT ON (lower(trim(r.artist)), rrg.release_group_mbid)
      lower(trim(r.artist)) AS "artistKey",
      r.artist_mbid AS "artistMbid",
      rrg.release_group_mbid AS "releaseGroupMbid",
      rrg.title,
      rrg.primary_type AS "primaryType",
      rrg.release_year AS "releaseYear",
      art.artwork_url AS "artworkUrl"
    FROM recordings r
    JOIN recording_release_groups rrg
      ON rrg.recording_mbid = r.mbid
     AND rrg.is_primary = true
    LEFT JOIN LATERAL (
      SELECT rec.artwork_url
      FROM recording_release_groups member
      JOIN recordings rec ON rec.mbid = member.recording_mbid
      WHERE member.release_group_mbid = rrg.release_group_mbid
        AND rec.artwork_url IS NOT NULL
      LIMIT 1
    ) art ON true
    WHERE lower(trim(r.artist)) IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
    ORDER BY lower(trim(r.artist)), rrg.release_group_mbid, rrg.release_year DESC NULLS LAST
  `);

  type Row = {
    artistKey: string;
    artistMbid: string | null;
    releaseGroupMbid: string;
    title: string | null;
    primaryType: string | null;
    releaseYear: number | null;
    artworkUrl: string | null;
  };
  const artists: Record<string, {
    artistMbid: string | null;
    releases: Array<{
      releaseGroupMbid: string;
      title: string | null;
      primaryType: string | null;
      releaseYear: number | null;
      artworkUrl: string | null;
    }>;
  }> = Object.fromEntries(keys.map((key) => [key, { artistMbid: null, releases: [] }]));

  for (const row of result.rows as unknown as Row[]) {
    const entry = artists[row.artistKey];
    if (!entry) continue;
    entry.artistMbid ??= row.artistMbid;
    entry.releases.push({
      releaseGroupMbid: row.releaseGroupMbid,
      title: row.title,
      primaryType: row.primaryType,
      releaseYear: row.releaseYear,
      artworkUrl: row.artworkUrl,
    });
  }
  for (const entry of Object.values(artists)) {
    entry.releases.sort((a, b) =>
      (b.releaseYear ?? -Infinity) - (a.releaseYear ?? -Infinity) ||
      (a.title ?? "").localeCompare(b.title ?? ""),
    );
  }
  return res.json({ artists });
}));

/**
 * Replace the full seed list atomically.
 * - Max 50 seeds; each name max 100 chars.
 * - Names are normalised (trim + deduplicate case-insensitively) before persist.
 * - Busts crossings + library-hit caches so Zone 1 reflects seeds immediately.
 */
router.put("/me/taste-seeds", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const raw: unknown = req.body?.artists;
  if (
    !Array.isArray(raw) ||
    !raw.every((v) => typeof v === "string")
  ) {
    return res.status(400).json({ error: "artists must be an array of strings" });
  }
  const incoming = raw as string[];
  if (incoming.length > MAX_SEEDS) {
    return res.status(400).json({ error: `Maximum ${MAX_SEEDS} seeds allowed` });
  }

  // Normalise: trim, drop empties, deduplicate case-insensitively, cap length.
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of incoming) {
    const display = raw.trim();
    if (display.length > MAX_ARTIST_LEN) {
      return res.status(400).json({ error: `Artist names must be ${MAX_ARTIST_LEN} characters or fewer` });
    }
    const key = display.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(display);
  }

  await db.transaction(async (tx) => {
    await tx.delete(tasteSeedsTable).where(eq(tasteSeedsTable.userId, user.id));
    if (normalized.length > 0) {
      await tx.insert(tasteSeedsTable).values(
        normalized.map((artistName) => ({ userId: user.id, artistName })),
      );
    }
  });

  // Bust both caches so the next poll returns fresh crossing scores.
  bustCrossingsCache(user.id);
  bustLibraryHitCache(user.id);

  // Re-read to return the canonical persisted order.
  const rows = await db
    .select({ artistName: tasteSeedsTable.artistName })
    .from(tasteSeedsTable)
    .where(eq(tasteSeedsTable.userId, user.id))
    .orderBy(tasteSeedsTable.createdAt);
  return res.json({ artists: rows.map((r) => r.artistName) });
}));

export default router;
