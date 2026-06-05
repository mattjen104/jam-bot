import {
  configureEnrichmentSpotify,
  setEnrichmentLogger,
} from "@workspace/song-enrichment/wiring";
import { cataloguePort } from "../spotify/appClient.js";

/**
 * Wire the shared enrichment lib's injectable seams for the API server. Unlike
 * jam-bot, the API server keeps the lib's default in-memory cache and skips the
 * LLM summarizer (the dossier renders the structured facts directly). We only
 * inject the client-credentials Spotify catalogue port and a console logger.
 *
 * Imported for its side effect once, the first time a song route module loads.
 */
let wired = false;

export function wireSongEnrichment(): void {
  if (wired) return;
  wired = true;
  configureEnrichmentSpotify(cataloguePort);
  setEnrichmentLogger({
    debug: (msg, meta) => console.debug("[enrichment]", msg, meta ?? ""),
    info: (msg, meta) => console.info("[enrichment]", msg, meta ?? ""),
    warn: (msg, meta) => console.warn("[enrichment]", msg, meta ?? ""),
    error: (msg, meta) => console.error("[enrichment]", msg, meta ?? ""),
  });
}
