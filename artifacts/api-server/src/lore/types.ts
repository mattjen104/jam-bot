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

/** Show + DJ attribution for a spin, when the source exposes it. */
export interface ShowAttribution {
  name: string;
  djName?: string;
}

/**
 * A single play from a station's history feed. Extends the now-playing shape
 * with the fields the ingestion pipeline needs to log continuously and
 * idempotently: the source's stable id (dedup + cursor), the timestamp the
 * source reported, and show/DJ attribution.
 */
export interface RawSpin extends NowPlayingRaw {
  /** Source's stable id for this play, when it exposes one. */
  externalId?: string;
  /** When the source says it was played. Defaults to ingest time when absent. */
  playedAt?: Date;
  /** Show/DJ attribution, when the source exposes program metadata. */
  show?: ShowAttribution;
}

/**
 * A now-playing adapter fetches + normalizes one station's current track. It is
 * best-effort: returns null when nothing is on air, the source is silent, or on
 * any failure. Adapters must never throw — the poller depends on that.
 *
 * Kept for change-detection sources (Radio Paradise) that only expose "the
 * current track" with no timestamp or stable id.
 */
export type NowPlayingAdapter = (
  config: Record<string, unknown>,
) => Promise<NowPlayingRaw | null>;

/** Options for a batch history fetch. */
export interface FetchRecentOptions {
  /** Max plays to return per page (backfill uses a larger value than a live poll). */
  limit?: number;
  /**
   * Zero-based page offset for cursor-driven paging. The poller walks pages
   * back from newest until it reaches the last-seen cursor, so no plays are
   * dropped after downtime longer than one page. Adapters translate this to
   * whatever their API uses (KEXP: `offset` = page*limit; Spinitron: `page`,
   * 1-based). Sources with no history/pagination (BBC latest) ignore it.
   */
  page?: number;
  /**
   * Only return plays strictly OLDER than this ISO timestamp. This is the
   * deep-history lever: the backfill job walks backwards by moving `before`
   * to the oldest play of each ingested slice. Only sources whose API supports
   * time-anchored history honor it (KEXP: `airdate_before`); others ignore it
   * and must not be enrolled for backfill (see `supportsBackfill`).
   */
  before?: string;
}

/**
 * A history adapter fetches a station's recent plays (newest-first or
 * oldest-first — the pipeline sorts before ingesting) as a batch. Sources with
 * a proper play-history feed (KEXP, Spinitron, BBC) implement this; the
 * pipeline dedups by `externalId` and advances a per-station cursor. Like
 * now-playing adapters, these are best-effort and must never throw.
 */
export type HistoryAdapter = (
  config: Record<string, unknown>,
  opts?: FetchRecentOptions,
) => Promise<RawSpin[]>;
