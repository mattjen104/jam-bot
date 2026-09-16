import { Router, type IRouter } from "express";
import { h } from "../../middlewares/asyncHandler.js";
import { getArtistWikidataMetadata } from "../../lore/artist-wikidata.js";

const router: IRouter = Router();

/**
 * Authenticated mirror of the public artist metadata route.  Authentication
 * is intentionally session/device based like the rest of /me; the payload is
 * the same public provider evidence and contains no listener data.
 */
router.get("/me/artist/:mbid/metadata", h(async (req, res) => {
  const artistMbid = String(req.params.mbid ?? "").trim();
  if (!artistMbid) return res.status(400).json({ error: "mbid required" });
  return res.json(await getArtistWikidataMetadata(artistMbid));
}));

export default router;