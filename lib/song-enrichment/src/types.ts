/**
 * Shared input types for the enrichment modules that previously lived outside
 * the turntable enrichment files. They are duplicated here (structurally
 * identical to their jam-bot originals) so the lib has no dependency on jam-bot's
 * ACRCloud / Spotify modules. Structural typing keeps jam-bot's call sites
 * (which pass its own `AcrMatch` / `SearchResultTrack`) assignable.
 */

/** A fingerprint match, the input to track-level enrichment. */
export interface AcrMatch {
  /** ACRCloud's own id for the recording — stable per fingerprint. */
  acrid: string;
  title: string;
  artist: string;
  album: string;
  /** International Standard Recording Code, when present. */
  isrc?: string;
  /** Offset (ms) into the master recording the submitted clip's start maps to. */
  playOffsetMs: number;
  /** ACRCloud match confidence score (0-100), when present. */
  score?: number;
}

/** A resolved Spotify track, an alternative input to enrichment. */
export interface SearchResultTrack {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}
