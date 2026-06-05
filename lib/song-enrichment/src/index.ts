/**
 * @workspace/song-enrichment — the single source of truth for the song-context
 * enrichment that powers jam-bot's track cards and the standalone music-graph
 * web app. The fetch/parse/normalization logic was moved verbatim out of
 * jam-bot; the only change was decoupling its config / cache / logger / Spotify
 * / LLM dependencies behind the injectable seams exported below.
 */

// --- Domain enrichment modules (public API) ---------------------------------
export * from "./musicbrainz.js";
export * from "./discogs.js";
export * from "./lastfm.js";
export * from "./wikipedia.js";
export * from "./genius.js";
export * from "./person.js";
export * from "./knowledge.js";
export * from "./context.js";
export * from "./catalogue.js";
export * from "./odesli.js";
export * from "./insights.js";
export * from "./insights-seed.js";

// --- Shared input types ------------------------------------------------------
export type { AcrMatch, SearchResultTrack } from "./types.js";

// --- Injectable wiring seams (hosts configure these once at boot) ------------
export { configureEnrichmentCache, type EnrichmentCacheStore } from "./cache.js";
export {
  configureEnrichmentSpotify,
  type SpotifyCataloguePort,
  type SpotifyArtistRef,
  type CatalogueTrack,
  type CatalogueAlbum,
} from "./spotify-port.js";
export {
  configureEnrichmentSummarizer,
  type EnrichmentSummarizer,
} from "./summarizer.js";
export { setEnrichmentLogger, type EnrichmentLogger } from "./logger.js";
