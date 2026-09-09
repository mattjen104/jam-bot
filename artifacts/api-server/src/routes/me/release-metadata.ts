/**
 * POST /api/me/library/release-metadata — batched release metadata for
 * Library crate rows.
 *
 * Replaces the crate's old browser→musicbrainz.org trickle: the browser POSTs
 * the MBIDs it still needs (max 100), the server serves `recording_release_groups`
 * primary rows and hydrates misses itself in paced batches (persisted, so the
 * cost is paid once globally, not per listener per page load).
 *
 * Plain-JSON route (not orval-generated) — same fast-lane convention as
 * /api/me/library/set-contexts.
 *
 * Request:  { mbids: string[] }  (max 100)
 * Response: { metadata: { [mbid]: { title, releaseGroupMbid } | null } }
 *   Every requested MBID gets an explicit entry; null means "no data" (or
 *   "still unknown") and is safe to cache for the session.
 */
import { Router, type IRouter } from "express";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import { resolveReleaseMetadata } from "../../lore/release-metadata.js";

const router: IRouter = Router();

const MAX_MBIDS = 100;

router.post("/me/library/release-metadata", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const body = req.body as { mbids?: unknown };
  if (!Array.isArray(body?.mbids) || body.mbids.length > MAX_MBIDS) {
    return res.status(400).json({ error: `mbids must be an array of at most ${MAX_MBIDS}` });
  }
  const mbids: string[] = [];
  for (const raw of body.mbids) {
    if (typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({ error: "each mbid must be a non-empty string" });
    }
    mbids.push(raw.trim());
  }

  const metadata = await resolveReleaseMetadata(mbids);
  return res.json({ metadata });
}));

export default router;
