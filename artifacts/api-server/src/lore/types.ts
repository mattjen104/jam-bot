/**
 * Normalized now-playing metadata from a station's own now-playing source. This
 * is the raw shape *before* it touches the MusicBrainz spine — some sources
 * (KEXP) hand us a recording MBID directly, others (Radio Paradise) give only
 * artist + title and we resolve later.
 */
export interface NowPlayingRaw {
  rawArtist: string;
  rawTitle: string;
  album?: string;
  artworkUrl?: string;
  /** MusicBrainz Recording ID, when the source provides one (e.g. KEXP). */
  recordingId?: string;
  /** ISRC, when the source provides one. */
  isrc?: string;
  durationMs?: number;
}

/**
 * A now-playing adapter fetches + normalizes one station's current track. It is
 * best-effort: returns null when nothing is on air, the source is silent, or on
 * any failure. Adapters must never throw — the poller depends on that.
 */
export type NowPlayingAdapter = (
  config: Record<string, unknown>,
) => Promise<NowPlayingRaw | null>;
