import { Router, type IRouter } from "express";
import { GetReplayManifestParams, GetReplayManifestResponse } from "@workspace/api-zod";
import { getReplayManifest } from "../../lore/replay.js";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

// GET /api/replay/:id — canonical Ghost Replay manifest.
router.get("/replay/:id", h(async (req, res) => {
  const parsed = GetReplayManifestParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Replay not found" });

  const manifest = await getReplayManifest(parsed.data.id);
  if (!manifest) return res.status(404).json({ error: "Replay not found" });

  return res.json(GetReplayManifestResponse.parse(manifest));
}));

export default router;