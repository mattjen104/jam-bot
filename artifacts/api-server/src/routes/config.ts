import { Router, type IRouter } from "express";
import { db, loreSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAppleMusicClientConfig } from "../lore/appleMusic.js";

/**
 * GET /api/config — lightweight feature-flag config that does NOT require auth.
 * Add new flags here as the product grows; keep values primitive and small.
 *
 * Settings are read from the `lore_settings` database table; the env var
 * SPOTIFY_IMPORT_ENABLED is used only as a fallback default when no DB row
 * exists yet.  Use the admin panel (/admin/settings) to toggle at runtime.
 */
const router: IRouter = Router();

/** Simple TTL cache so every page render doesn't hit the DB. */
const CONFIG_CACHE_TTL_MS = 30_000;
let configCache: { spotifyImportEnabled: boolean; expiresAt: number } | null = null;

async function readSpotifyImportEnabled(): Promise<boolean> {
  const now = Date.now();
  if (configCache && now < configCache.expiresAt) {
    return configCache.spotifyImportEnabled;
  }
  const [row] = await db
    .select()
    .from(loreSettingsTable)
    .where(eq(loreSettingsTable.key, "spotifyImportEnabled"))
    .limit(1);
  const value = row != null ? row.value : (process.env["SPOTIFY_IMPORT_ENABLED"] === "true");
  configCache = { spotifyImportEnabled: value, expiresAt: now + CONFIG_CACHE_TTL_MS };
  return value;
}

/** Bust the in-process config cache so changes from the admin panel take effect
 *  within the next request rather than waiting for the TTL to expire. */
export function bustConfigCache() {
  configCache = null;
}

router.get("/config", async (_req, res) => {
  const appleMusic = getAppleMusicClientConfig();
  try {
    const spotifyImportEnabled = await readSpotifyImportEnabled();
    res.json({ spotifyImportEnabled, appleMusic });
  } catch {
    // Fail open with env var fallback so a DB hiccup doesn't break page load.
    res.json({ spotifyImportEnabled: process.env["SPOTIFY_IMPORT_ENABLED"] === "true", appleMusic });
  }
});

export default router;
