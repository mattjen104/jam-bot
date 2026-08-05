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
import { eq } from "drizzle-orm";
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
 * Replace the full seed list atomically.
 * - Max 10 seeds; each name max 100 chars.
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
    const display = raw.trim().slice(0, MAX_ARTIST_LEN);
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
