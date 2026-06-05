/**
 * Wires jam-bot's concrete dependencies into the shared @workspace/song-enrichment
 * library, preserving the bot's exact behavior (sqlite-backed cache, real logger,
 * real Spotify client, OpenRouter summaries) now that the enrichment logic lives
 * in the lib. Call `wireEnrichment()` once before any enrichment runs — from the
 * bot entrypoint and from the vitest setup file.
 */
import { logger } from "../logger.js";
import { askLLM } from "../llm/openrouter.js";
import {
  getTrackKnowledge,
  setTrackKnowledge,
  getTrackContext,
  setTrackContext,
} from "../db.js";
import {
  searchArtist,
  getArtistTopTracksList,
  getArtistAlbumsList,
} from "../spotify/client.js";
// Import the seams from the narrow `/wiring` entry (NOT the barrel) so wiring
// the bot at boot / in tests does not eagerly evaluate the enrichment subject
// modules — that pre-evaluation would defeat the per-file source mocks in the
// knowledge/context/insights vitest suites.
import {
  configureEnrichmentCache,
  configureEnrichmentSpotify,
  configureEnrichmentSummarizer,
  setEnrichmentLogger,
} from "@workspace/song-enrichment/wiring";

let wired = false;

export function wireEnrichment(): void {
  if (wired) return;
  wired = true;

  setEnrichmentLogger(logger);

  configureEnrichmentCache({
    getTrackKnowledge,
    setTrackKnowledge,
    getTrackContext,
    setTrackContext,
  });

  configureEnrichmentSpotify({
    searchArtist,
    getArtistTopTracksList,
    getArtistAlbumsList,
  });

  configureEnrichmentSummarizer((question) => askLLM(question));
}
