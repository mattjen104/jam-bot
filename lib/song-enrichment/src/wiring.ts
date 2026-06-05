/**
 * Narrow wiring entry: ONLY the injectable seams a host configures at boot
 * (cache, Spotify catalogue port, LLM summarizer, logger). It deliberately does
 * NOT pull in the enrichment subject modules (knowledge/context/insights/...),
 * unlike the barrel `index.ts`.
 *
 * Why this exists: a host (jam-bot, api-server) wires its concrete deps via this
 * entry. Importing the barrel would eagerly evaluate every subject module, which
 * — in the jam-bot vitest setup — pinned the subjects' collaborator bindings
 * before the per-file `vi.mock` calls could replace them, so the source mocks
 * never reached the code under test. Wiring through this leaf-only entry keeps
 * the subjects unevaluated until each test imports them (after its mocks).
 */
export {
  configureEnrichmentCache,
  type EnrichmentCacheStore,
} from "./cache.js";
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
