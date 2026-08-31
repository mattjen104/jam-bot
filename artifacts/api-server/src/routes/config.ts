import { Router, type IRouter } from "express";
import { db, loreSettingsTable } from "@workspace/db";
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
let configCache: { spotifyImportEnabled: boolean; listenerArchiveNavEnabled: boolean; expiresAt: number } | null = null;

async function readConfigSettings(): Promise<{ spotifyImportEnabled: boolean; listenerArchiveNavEnabled: boolean }> {
  const now = Date.now();
  if (configCache && now < configCache.expiresAt) {
    return configCache;
  }
  const rows = await db.select().from(loreSettingsTable);
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const settings = {
    spotifyImportEnabled: values.get("spotifyImportEnabled") ?? process.env["SPOTIFY_IMPORT_ENABLED"] === "true",
    listenerArchiveNavEnabled: values.get("listenerArchiveNavEnabled") ?? false,
  };
  configCache = { ...settings, expiresAt: now + CONFIG_CACHE_TTL_MS };
  return settings;
}

/** Bust the in-process config cache so changes from the admin panel take effect
 *  within the next request rather than waiting for the TTL to expire. */
export function bustConfigCache() {
  configCache = null;
}

router.get("/config", async (_req, res) => {
  const appleMusic = getAppleMusicClientConfig();
  try {
    const settings = await readConfigSettings();
    res.json({ ...settings, appleMusic });
  } catch {
    // Fail open with env var fallback so a DB hiccup doesn't break page load.
    res.json({
      spotifyImportEnabled: process.env["SPOTIFY_IMPORT_ENABLED"] === "true",
      listenerArchiveNavEnabled: false,
      appleMusic,
    });
  }
});

export default router;
