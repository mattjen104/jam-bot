import { Router, type IRouter } from "express";

/**
 * GET /api/config — lightweight feature-flag config that does NOT require auth.
 * Add new flags here as the product grows; keep values primitive and small.
 */
const router: IRouter = Router();

router.get("/config", (_req, res) => {
  res.json({
    /**
     * When true, the Spotify direct-import route is enabled for all users.
     * When false (default), POST /api/me/library/import?service=spotify returns 403.
     * Set SPOTIFY_IMPORT_ENABLED=true in the environment to enable.
     */
    spotifyImportEnabled: process.env["SPOTIFY_IMPORT_ENABLED"] === "true",
  });
});

export default router;
