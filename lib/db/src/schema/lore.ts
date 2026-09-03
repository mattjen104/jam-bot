import {
  pgTable,
  pgView,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Lore play-history spine.
 *
 * The universal key is the MusicBrainz Recording ID (MBID) — never a Spotify or
 * internal id. Everything that a track "is" (`recordings`) and everywhere it has
 * been played (`spins`) hangs off that MBID. Stations play their own sanctioned
 * live stream, unmodified; we only cross-reference what's on air against the MBID
 * metadata spine and log a spin.
 */

/** A single cross-platform deep link (Odesli / universal search). */
export interface RecordingLink {
  /** Friendly platform label, e.g. "Apple Music", "YouTube". */
  name: string;
  url: string;
  /**
   * "exact" when the link points at this precise recording (resolved via
   * Odesli), "search" when it's a best-effort artist+title search on that
   * service. Kept so the UI can be honest about the gradient.
   */
  kind: "exact" | "search";
}

/**
 * MBID-keyed metadata for a recording that has been heard on air. This is the
 * spine's node table: knowledge, spins, and (later) annotations attach here.
 */
export const recordingsTable = pgTable("recordings", {
  /** MusicBrainz Recording ID — the canonical spine key. */
  mbid: text("mbid").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  /** MusicBrainz Artist ID, when resolved. */
  artistMbid: text("artist_mbid"),
  isrc: text("isrc"),
  durationMs: integer("duration_ms"),
  /** Cross-service deep links (Odesli exact + universal search fallback). */
  links: jsonb("links").$type<RecordingLink[]>(),
  /** Album cover / artwork URL from the now-playing source, when available. */
  artworkUrl: text("artwork_url"),
  /**
   * Ranked genre tags (MusicBrainz `inc=genres` primary, Last.fm artist tags
   * fallback), most-relevant first. Null means never enriched — degrade to
   * "unknown" in the UI, never fabricate a genre.
   */
  genres: text("genres").array(),
  /**
   * First-release year (MusicBrainz `first-release-date`), used for the
   * discovery-score age comparison against a spin/pick's air date. Null
   * means never enriched or MusicBrainz had no dated release.
   */
  releaseYear: integer("release_year"),
  /**
   * Full first-release date in MusicBrainz's own partial-ISO form (`YYYY`,
   * `YYYY-MM`, or `YYYY-MM-DD`), validated at write time. Null means never
   * enriched or MusicBrainz had no dated release. Preserved at MB's native
   * granularity so coarse data stays honest; the Dial's First (premiere)
   * tier reads partial dates permissively (year-only counts to year-end).
   */
  releaseDate: text("release_date"),
  /**
   * When a release-date lookup last received a definitive answer from
   * MusicBrainz (date found OR genuine "no date"). NOT set on 5xx/network
   * errors so transient failures are retried on the next backfill tick.
   * Mirrors `yearCheckedAt` semantics.
   */
  releaseDateCheckedAt: timestamp("release_date_checked_at"),
  /**
   * When genre/year enrichment was last attempted for this recording (set
   * regardless of whether MusicBrainz/Last.fm actually returned data). Null
   * means never attempted — the backfill target set. This is distinct from
   * `genres`/`releaseYear` being null, which can be a legitimate "looked it
   * up, nothing there" result and must not be retried forever.
   */
  genreEnrichedAt: timestamp("genre_enriched_at"),
  /**
   * Current genre-enrichment funnel state:
   *   pending          — never attempted
   *   transient_failure — provider/network failure; retryable
   *   no_result        — providers answered but supplied no genre
   *   found            — at least one genre was supplied
   *   ineligible       — synthetic/provider-only identity; never call MB
   *
   * Kept as text (rather than a PostgreSQL enum) so boot migrations can add
   * states without coupling deploy order to a database enum migration.
   */
  genreEnrichmentStatus: text("genre_enrichment_status")
    .notNull()
    .default("pending"),
  /** When the most recent genre-enrichment attempt started/completed. */
  genreEnrichmentAttemptedAt: timestamp("genre_enrichment_attempted_at"),
  /** Short provider error context for the admin funnel; null after success. */
  genreEnrichmentError: text("genre_enrichment_error"),
  /**
   * When an ISRC lookup (MusicBrainz `inc=isrcs`) was last attempted for this
   * recording. Set regardless of whether an ISRC was found, so misses aren't
   * re-fetched forever. Null means never attempted.
   */
  isrcCheckedAt: timestamp("isrc_checked_at"),
  /**
   * LRCLIB evidence state. This is deliberately separate from lyric_lines:
   * an explicit instrumental answer has no lines, while a provider failure
   * must remain retryable and an unattempted recording must remain unknown.
   */
  lyricStatus: text("lyric_status").notNull().default("not_checked"),
  /** Last definitive or transient LRCLIB attempt. Null means not checked. */
  lyricCheckedAt: timestamp("lyric_checked_at"),
  /** Short transient-provider error context; cleared after a non-error answer. */
  lyricError: text("lyric_error"),
  /**
   * When a release-year lookup was last attempted for this recording. Set on
   * every attempt that received a definitive answer from MusicBrainz — whether
   * a year was found or MusicBrainz genuinely had none. NOT set on 5xx/network
   * errors so transient failures are retried on the next backfill tick. Null
   * means never attempted and is the backfill job's target set.
   */
  yearCheckedAt: timestamp("year_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Blended crossings expands active listeners' artist taste into recording
  // MBIDs before probing the spin archive.
  index("recordings_artist_mbid_idx").on(t.artistMbid),
]);

export type Recording = typeof recordingsTable.$inferSelect;
export type InsertRecording = typeof recordingsTable.$inferInsert;

/**
 * A curated, high-quality radio station. `nowPlayingSource` selects the metadata
 * adapter; `nowPlayingConfig` carries per-source params (e.g. Radio Paradise
 * channel). We store the station's own sanctioned `streamUrl` and never proxy or
 * re-encode it.
 */
export const stationsTable = pgTable("stations", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Operating org, e.g. "Radio Paradise", "KEXP", "BBC". */
  org: text("org"),
  country: text("country"),
  /** City the station broadcasts from (e.g. "London", "Berlin"). Populated for CRI-sourced stations. */
  city: text("city"),
  /**
   * IANA timezone identifier inferred from city + country (e.g. "America/Los_Angeles").
   * Stored so the schedule endpoint doesn't re-run the lookup on every request.
   * Null when the inference is not confident enough — UI degrades to "station's local time".
   * Written by the seed on create/update and backfilled for existing rows at startup.
   */
  ianaTimezone: text("iana_timezone"),
  /** The station's own sanctioned live stream URL, played unmodified. */
  streamUrl: text("stream_url").notNull(),
  /** Human quality badge, e.g. "320kbps AAC", "FLAC", "160kbps AAC". */
  streamQuality: text("stream_quality"),
  /** Playback hint for the client: "aac" | "mp3" | "hls" | "flac". */
  streamFormat: text("stream_format").notNull().default("aac"),
  /** Playback mode; "live" for continuous radio. */
  mode: text("mode").notNull().default("live"),
  homepageUrl: text("homepage_url"),
  /**
   * Optional direct URL to this station's weekly-schedule page (e.g.
   * https://kexp.org/schedule/). When set, the schedule scraper fetches this
   * URL directly and skips both the homepage fetch and the link-discovery
   * step — significantly improving extraction success for stations whose
   * schedule link doesn't appear as a plain anchor on the homepage (JS-rendered
   * nav, embedded players, etc.). Null = fall back to homepage + link discovery.
   */
  scheduleUrl: text("schedule_url"),
  donateUrl: text("donate_url"),
  /**
   * Operator-only evidence from the homepage scraper. These fields deliberately
   * distinguish "no store found" from a page that could not be checked.
   */
  storeUrl: text("store_url"),
  storeLabel: text("store_label"),
  storeSignal: text("store_signal"),
  storeStatus: text("store_status"),
  storeCheckedAt: timestamp("store_checked_at"),
  logoUrl: text("logo_url"),
  /**
   * Provenance of logoUrl. "curated" is operator/seed-owned and must never be
   * replaced automatically; "website" was discovered on the official
   * homepage; "radio_browser" is the directory favicon fallback.
   */
  logoSource: text("logo_source"),
  /** Intrinsic raster dimensions recorded by the homepage logo probe. */
  logoWidth: integer("logo_width"),
  logoHeight: integer("logo_height"),
  /** Last completed station-logo discovery attempt. Null = never checked. */
  logoCheckedAt: timestamp("logo_checked_at"),
  /** Now-playing adapter key, e.g. "radio_paradise" | "kexp" | "bbc". */
  nowPlayingSource: text("now_playing_source"),
  /**
   * Per-source config: channel/service id, published now-playing endpoint URL +
   * parser mapping (source="station_page"), and the per-station Spinitron API
   * key (source="spinitron"). Never contains secrets meant to be public.
   */
  nowPlayingConfig:
    jsonb("now_playing_config").$type<Record<string, unknown>>(),
  /**
   * Station class for Segue-mode weighting. Passthrough/curated + community
   * stations rank above commercial sources; a purely commercial feed would be
   * "commercial". Defaults to "curated".
   */
  stationClass: text("station_class").notNull().default("curated"),
  /**
   * Per-station ingest cursor: the external id (or ISO timestamp) of the newest
   * spin already ingested, so polling only logs genuinely new plays.
   */
  lastSeenCursor: text("last_seen_cursor"),
  /**
   * Deep-history backfill cursor: the ISO airdate of the OLDEST play already
   * ingested by the backfill job. The job walks backwards from here in budgeted
   * slices, so it is resumable across restarts. Null = backfill has not started
   * (the first slice begins at "now"). Independent of `lastSeenCursor`, which
   * only ever moves forward with live polling.
   */
  backfillCursor: text("backfill_cursor"),
  /**
   * True once the backfill job walked past the source's oldest play (an empty
   * page came back) or reached the configured floor — nothing older remains.
   */
  backfillDone: boolean("backfill_done").notNull().default(false),
  /** Whether attribution (station/show/DJ links) must be shown. Always true. */
  attribution: boolean("attribution").notNull().default(true),
  /** Display order in the directory (lower first). */
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * Whether this station is active (visible in the directory and polled).
   * Curated flagship stations default to true; radio-browser longtail
   * candidates start as false and are promoted by the health worker.
   */
  active: boolean("active").notNull().default(true),
  /**
   * Curator-level favorite. Favorites are the only stations that get a
   * persistent ICY connection (instant now-playing); non-favorite ICY stations
   * fall back to interval polling. Soft budget ~40 (connection/bandwidth
   * guidance, enforced as a UI warning, never a hard block). Distinct from
   * `active` (health-driven) and from per-listener follows (localStorage-only).
   */
  favorite: boolean("favorite").notNull().default(false),
  /**
   * Soft-hide: removed from the public dial and all listener-facing lists, and
   * polling/watching stops entirely — but the row, spin history, and
   * radio-browser link are kept intact so the station can be reintroduced with
   * one click. Never overload `active` for this (its auto-demotion semantics
   * belong to the health worker).
   */
  hidden: boolean("hidden").notNull().default(false),
  /**
   * Provenance for an automatic catalogue cull. A null value means the row
   * was hidden by an operator (or predates cull provenance tracking).
   */
  automaticCullReason: text("automatic_cull_reason"),
  /**
   * For duplicate-stream culls, the station row that remained visible as the
   * canonical copy. Null for other cull reasons.
   */
  automaticCullCanonicalStationId: integer("automatic_cull_canonical_station_id"),
  /**
   * Legacy ambient-pool classification. When true, the station is excluded
   * from the normal public dial (together with hidden=true) but is available
   * via GET /api/stations?mode=sleep. Only musical ambient channels belong in
   * this pool; non-music sleep/nature/white-noise utilities stay hidden.
   */
  sleepMode: boolean("sleep_mode").notNull().default(false),
  /**
   * Era/genre classification. When true, the station is excluded from the
   * normal public dial (together with hidden=true) but is available via
   * GET /api/stations?mode=era-genre. Intended for era-themed stations
   * (decades/oldies/retro) and single-genre algorithmic brand channels that
   * dilute the human-curated dial. Sleep classification takes precedence — a
   * station already sleep_mode=true is never reclassified. Defaults to false.
   */
  eraGenreMode: boolean("era_genre_mode").notNull().default(false),
  /**
   * Whether this station appears in the listener-facing crossing surface
   * (station list and now-playing dial). When false the station continues to
   * ingest spins (history grows, crossing data accumulates) but is excluded
   * from GET /api/stations and the now-playing pulse, so it does not occupy
   * a crossing slot. Default is true.
   *
   * Distinct from `hidden` (which also stops polling entirely) and `active`
   * (health-driven). Use this for sub-channels and algorithmic feeds that
   * produce valuable history but should not compete for crossing real estate:
   * e.g. FIP thematic sub-channels where only the primary + one wedge channel
   * should surface on the dial.
   */
  crossingEligible: boolean("crossing_eligible").notNull().default(true),
  /**
   * How this station entered the directory: "curated" = hand-curated flagship
   * seed, "radio_browser" = auto-discovered via radio-browser.info.
   */
  source: text("source").notNull().default("curated"),
  /**
   * Discovery tier. "flagship" = curated priority (never auto-demoted to
   * inactive); "longtail" = radio-browser candidate (auto-demoted after 3
   * consecutive health-check failures).
   */
  tier: text("tier").notNull().default("flagship"),
  /**
   * Genre/style tags sourced from radio-browser.info or set manually.
   * Used to filter/rank stations in the for-you ranking API.
   */
  tags: jsonb("tags").$type<string[]>(),
  /**
   * Timestamp of the most recent successful stream health check (HEAD/GET
   * the stream URL returned 2xx or non-empty audio bytes).
   */
  lastAliveAt: timestamp("last_alive_at"),
  /**
   * Fraction of spins (0–1) that resolved to a MusicBrainz recording over
   * the last rolling window. Used for for-you ranking; null until enough
   * data exists.
   */
  resolutionRate: real("resolution_rate"),
  /**
   * radio-browser.info click count at last upsert — a proxy for listener
   * demand across the whole radio-browser network.
   */
  clickcount: integer("clickcount").notNull().default(0),
  /**
   * radio-browser.info vote count at last upsert.
   */
  votes: integer("votes").notNull().default(0),
  /**
   * Stream bitrate in kbps from radio-browser.info or detected by the health
   * worker. Distinct from `streamQuality` (which is a human-readable badge).
   */
  bitrate: integer("bitrate"),
  /**
   * Audio codec identifier from radio-browser.info or detected by the health
   * worker (e.g. "MP3", "AAC"). Distinct from `streamFormat` (the client
   * playback hint).
   */
  codec: text("codec"),
  /**
   * Consecutive health-check failure count. Resets to 0 on success.
   * When this reaches 3 for a longtail station, active is set false.
   */
  healthFailures: integer("health_failures").notNull().default(0),
  /**
   * Consecutive ad-like now-playing signals seen while polling (e.g. ICY
   * metadata reading "Advertisement", "This station will continue after
   * this break", etc — see lore/ads.ts). Resets to 0 on any normal-looking
   * spin. Cheap byproduct of metadata we're already fetching every tick;
   * no extra audio analysis required.
   */
  adSignalStreak: integer("ad_signal_streak").notNull().default(0),
  /**
   * True once `adSignalStreak` has crossed AD_SIGNAL_THRESHOLD at least
   * once. Sticky (never auto-clears) — a station that runs ads sometimes
   * should stay flagged rather than flicker on/off with listener state.
   */
  mayHaveAds: boolean("may_have_ads").notNull().default(false),
  /** When `mayHaveAds` was first set true. Null until then. */
  adDetectedAt: timestamp("ad_detected_at"),
  /**
   * Whether this station's programming is human-curated, automated/algorithmic,
   * or a mix (human during show hours, automated between them).
   *
   *   'human'    — DJ-logged (Spinitron), or a known human-programmed feed
   *                (KEXP, KCRW, BBC, FIP, The Lot Radio). Crossings from these
   *                stations carry full attributed provenance.
   *   'automated' — Known algorithmic playlist (SomaFM, Radio Paradise).
   *                Crossings should not surface in Ether/Stacks.
   *   'mixed'    — Has a scraped DJ schedule but runs an automated rotation
   *                between shows (most community stations overnight). Crossings
   *                are only attributed during (station, hour-of-week) slots that
   *                fall within a scraped show window.
   *   null       — Unknown. Longtail stations with no behavioral data yet.
   */
  automationClass: text("automation_class"),
  /**
   * Cached discovery score (0-100, higher = newer-leaning rotation), recomputed
   * periodically by the discovery-score job from logged spins via
   * computeDiscoveryScore. Null until enough resolved spin history exists.
   * Cached rather than computed live because the dial sorts across every
   * active station on every request.
   */
  discoveryScore: real("discovery_score"),
  /**
   * Cumulative genre representation of everything this station has actually
   * spun (top genres + counts), recomputed periodically by the insights job.
   * Distinct from `tags` (radio-browser/manual labels): this is derived from
   * resolved spin history, never hand-written. Null until enough data exists.
   */
  genreProfile: jsonb("genre_profile").$type<{
    top: Array<{ genre: string; count: number }>;
    unknownCount: number;
    totalCount: number;
  }>(),
  /**
   * Rolling 90-day station character evidence. Unlike genreProfile, this is
   * bounded to recent observed spins and carries the complete fact packet
   * needed to reproduce the sentence-readiness tier.
   */
  recentProfile: jsonb("recent_profile").$type<{
    windowDays: 90;
    sampleSize: number;
    resolvedCount: number;
    uniqueTrackCount: number;
    uniqueArtistCount: number;
    resolutionRate: number;
    genreTaggedCount: number;
    genreCoverage: number;
    datedTrackCount: number;
    datedTrackCoverage: number;
    excludedCount: number;
    top: Array<{ genre: string; count: number }>;
    unknownGenreCount: number;
    latestSpinAt: string | null;
    updatedAt: string;
    readinessTier: "ready" | "provisional" | "insufficient";
  }>(),
  /**
   * Separate 30-day freshness evidence for the rolling station profile.
   * `hasRecentUsableSpin` is stored so readiness is reproducible without a
   * request-time clock comparison.
   */
  freshnessSignal: jsonb("freshness_signal").$type<{
    windowDays: 30;
    sampleSize: number;
    resolvedCount: number;
    resolutionRate: number;
    latestSpinAt: string | null;
    hasRecentUsableSpin: boolean;
    updatedAt: string;
  }>(),
  /**
   * Best-effort excerpt (title/meta description) scraped from the station's
   * own homepage. Null when never scraped, blocked by robots.txt, or the page
   * had no usable text — never fabricated.
   */
  homepageBlurb: text("homepage_blurb"),
  /** When the homepage was last (attempted to be) scraped. Null = never. */
  homepageScrapedAt: timestamp("homepage_scraped_at"),
  /**
   * When the donate_url last received a health-check HEAD request, regardless
   * of outcome. Null = never checked. Re-checked on the same 30-day cadence
   * as homepage scraping. Setting this to null forces an immediate re-check
   * on the next checker tick.
   */
  donateCheckedAt: timestamp("donate_checked_at"),
  /**
   * Denormalized count of rows in `scraped_shows` for this station.
   * Written in the same transaction as each schedule scrape (full replace),
   * so it stays in sync without a secondary query. Starts at 0; backfilled
   * from existing scraped_shows rows by the boot migration.
   */
  upcomingShowCount: integer("upcoming_show_count").notNull().default(0),
  /**
   * When the weekly-schedule scraper last *successfully* produced a result
   * for this station (including a legitimate "page has no schedule" empty
   * result) — the freshness marker that drives both the 7-day re-scrape
   * cadence and the public `lastScrapedAt` field. Deliberately NOT derived
   * from `scraped_shows` row presence: a station whose real schedule is
   * empty would otherwise look "never scraped" and get re-scraped every
   * tick forever. Null = never successfully scraped. Fetch/robots/LLM
   * failures leave this column untouched — see `scheduleAttemptedAt` below
   * for the failure-retry backoff.
   */
  scheduleScrapedAt: timestamp("schedule_scraped_at"),
  /**
   * When the weekly-schedule scraper last *attempted* this station,
   * regardless of outcome. Distinct from `scheduleScrapedAt` (success-only)
   * so a station that persistently fails (dead homepage, robots-blocked,
   * LLM error) still gets a short backoff instead of being re-tried on
   * every 45s tick forever and starving other stations' turn in the batch.
   */
  scheduleAttemptedAt: timestamp("schedule_attempted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Station = typeof stationsTable.$inferSelect;
export type InsertStation = typeof stationsTable.$inferInsert;

/** A show/program on a station (DJ-hosted block). */
export const showsTable = pgTable("shows", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id")
    .notNull()
    .references(() => stationsTable.id),
  name: text("name").notNull(),
  djName: text("dj_name"),
  /**
   * Co-host / multi-DJ names for shows with more than one credited selector.
   * When populated, the attribution cascade suppresses individual DJ names and
   * falls back to the show name instead.  Null for all single-DJ shows and any
   * show whose source doesn't expose a DJ list — the single `djName` field
   * remains the legacy path for those.
   */
  djNames: text("dj_names").array(),
  scheduleNote: text("schedule_note"),
  /**
   * Links this show to a picker (selector). Set by the KEXP shows harvester
   * for single-host shows so that DJ-attributed spins surface in the
   * picks_unified view with a real picker_id — enabling the follow/feed path.
   * Null for multi-host shows and non-KEXP stations (for now).
   */
  pickerId: integer("picker_id").references(() => pickersTable.id),
  /**
   * Cumulative genre representation of everything this show has actually
   * spun, recomputed periodically by the insights job from resolved spins
   * (top genres + counts). Null until enough resolved history exists.
   * Shape mirrors GenreBreakdown from genre-insights.
   */
  genreProfile: jsonb("genre_profile").$type<{
    top: Array<{ genre: string; count: number }>;
    unknownCount: number;
    totalCount: number;
  }>(),
  /**
   * Cached discovery score (0-100, higher = newer-leaning rotation) for this
   * show's logged spins, recomputed by the insights job alongside
   * genreProfile. Null until enough dated spin history exists.
   */
  discoveryScore: real("discovery_score"),
  /** When genreProfile/discoveryScore were last recomputed. Null = never. */
  insightsUpdatedAt: timestamp("insights_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Show = typeof showsTable.$inferSelect;
export type InsertShow = typeof showsTable.$inferInsert;

/**
 * A scraped upcoming-schedule entry for a station's own weekly programming
 * grid (distinct from `shows`, which is derived from actually-logged spins).
 * Sourced from the station's homepage or a linked schedule page via LLM
 * extraction — never fabricated. `dayOfWeek` + `startTime`/`endTime` describe
 * a recurring weekly slot ("Mon", "09:00", "11:00"), not a specific date,
 * since that's the granularity stations themselves publish. A full re-scrape
 * replaces a station's entire schedule set (see `station-schedule.ts`) so the
 * unique key spans every field that identifies a distinct slot.
 */
export const scrapedShowsTable = pgTable(
  "scraped_shows",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id),
    showName: text("show_name").notNull(),
    /** "Mon" | "Tue" | ... | "Sun" — the station's own weekly grid slot. */
    dayOfWeek: text("day_of_week").notNull(),
    /** 24h "HH:MM", station-local time as published (timezone not modeled). */
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    djName: text("dj_name"),
    /** URL of the station schedule page (or homepage when the grid is inline). */
    sourceUrl: text("source_url").notNull(),
    /** When this row was (re)written by the schedule scraper. */
    scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
    /** "llm" | "api" | "manual". */
    extraction: text("extraction").notNull(),
    /** Admin audit marker for schedule evidence that must not drive attribution.
     * withTimezone matches the boot migration's timestamptz — declaring it
     * without tz makes drizzle-kit push try an ALTER that fails because the
     * picks_unified view depends on this column. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    /** Required explanation recorded with an administrative withdrawal. */
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("scraped_shows_slot_uq").on(
      t.stationId,
      t.dayOfWeek,
      t.startTime,
      t.showName,
    ),
    index("scraped_shows_station_idx").on(t.stationId),
    check(
      "scraped_shows_extraction_ck",
      sql`${t.extraction} in ('llm', 'api', 'manual')`,
    ),
  ],
);

export type ScrapedShow = typeof scrapedShowsTable.$inferSelect;
export type InsertScrapedShow = typeof scrapedShowsTable.$inferInsert;

/**
 * One play (spin) of a track on a station. This is the play-history spine's edge
 * table — the radio cross-reference that makes the metadata library worth
 * browsing. A spin is logged even when resolution is approximate/failed (raw
 * title/artist preserved, `mbid` null), so the honesty gradient is visible and
 * backfill can converge later.
 */
export const spinsTable = pgTable(
  "spins",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id),
    showId: integer("show_id").references(() => showsTable.id),
    /** Resolved MusicBrainz Recording ID, when we matched one. */
    mbid: text("mbid").references(() => recordingsTable.mbid),
    /** Raw metadata straight from the now-playing source, before normalization. */
    rawTitle: text("raw_title"),
    rawArtist: text("raw_artist"),
    /**
     * Source-reported track duration, retained so repaired historical metadata
     * still passes the same wrong-recording guard as live resolution.
     */
    durationMs: integer("duration_ms"),
    /**
     * Ingest source: "radio_paradise" | "kexp" | "kexp_api" | "spinitron" |
     * "bbc_api" | "station_page" | "manual".
     */
    source: text("source"),
    /**
     * The source's own stable id for this play, when it exposes one (Spinitron
     * spin id, KEXP play id, BBC segment id). Used for idempotent dedup and as
     * the per-station cursor. Null for sources that only expose "current track".
     */
    externalId: text("external_id"),
    /**
     * Citation for source="manual" historical reconstruction (e.g. a survey /
     * archive URL). Required by the admin manual-entry path; null otherwise.
     */
    citation: text("citation"),
    /**
     * How the MBID was resolved: "recording_id" (source gave it), "isrc",
     * "text" (artist+title search), or "unresolved".
     */
    confidence: text("confidence").notNull().default("unresolved"),
    playedAt: timestamp("played_at").notNull().defaultNow(),
    /**
     * When Lore actually observed this play (ingestion time), as opposed to
     * `playedAt` which is the station-reported start time (or our best guess).
     * Powers the now-playing freshness classification (fresh/aging/stale).
     * Nullable: rows written before the column existed have no observation
     * timestamp — readers coalesce to `createdAt`.
     */
    observedAt: timestamp("observed_at").defaultNow(),
    /**
     * ACR fingerprint play offset — how far into the song (ms) the provider
     * said the captured clip was. Only set for fingerprint-derived spins;
     * null for every ordinary polled spin. Together with
     * `offsetCapturedAt`, this is the strongest position signal for the
     * track-expiry estimate.
     */
    playOffsetMs: integer("play_offset_ms"),
    /** When the fingerprint clip was captured (pairs with playOffsetMs). */
    offsetCapturedAt: timestamp("offset_captured_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("spins_mbid_played_at_idx").on(t.mbid, t.playedAt),
    // The blended rolling lane starts from its 30-day time window.
    index("spins_played_at_idx").on(t.playedAt),
    index("spins_station_played_at_idx").on(t.stationId, t.playedAt),
    // Selector/run read-models group spins by show + time.
    index("spins_show_played_at_idx").on(t.showId, t.playedAt),
    // Idempotent ingest: a given source play id is logged once per station.
    // Null externalIds are distinct in Postgres, so change-detection sources are
    // unaffected.
    uniqueIndex("spins_station_external_idx").on(t.stationId, t.externalId),
  ],
);

export type Spin = typeof spinsTable.$inferSelect;
export type InsertSpin = typeof spinsTable.$inferInsert;

/**
 * Local resolution cache for the shared `resolveToMbid` path. Text keys carry
 * a resolver-version namespace before the normalized
 * `artist\u001ftitle` digest. Old versions stay in place for audit while only
 * the current namespace participates in resolution. It caches BOTH hits and
 * misses (mbid null) so a track that never resolves isn't re-queried against
 * MusicBrainz on every spin — the single most important lever for staying under
 * the 1 req/sec MusicBrainz budget while ingesting continuously.
 */
export const resolutionCacheTable = pgTable("resolution_cache", {
  id: serial("id").primaryKey(),
  /** Versioned normalized digest, or a legacy unversioned key retained for audit. */
  key: text("key").notNull().unique(),
  /** Resolved MBID, or null for a cached miss. */
  mbid: text("mbid"),
  /** Confidence tier: "isrc" | "text" | "unresolved" | "deferred". */
  confidence: text("confidence").notNull().default("unresolved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ResolutionCacheRow = typeof resolutionCacheTable.$inferSelect;
export type InsertResolutionCacheRow = typeof resolutionCacheTable.$inferInsert;

/**
 * Segue edges: a directed adjacency of "song A was followed by song B" on a
 * given station/show. Derived nightly from consecutive resolved spins whose
 * gap is under the segue threshold (both mbids present). This is the graph that
 * powers Segue mode — real DJ transitions, attributed to where they happened.
 */
export const segueEdgesTable = pgTable(
  "segue_edges",
  {
    id: serial("id").primaryKey(),
    fromMbid: text("from_mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    toMbid: text("to_mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id),
    showId: integer("show_id").references(() => showsTable.id),
    /** When the transition happened (the playedAt of the `to` spin). */
    playedAt: timestamp("played_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One edge per concrete transition occurrence — idempotent re-derivation.
    // `played_at` is the timestamp of the `to` spin, and a single broadcast
    // stream plays exactly one track at any instant, so (station_id, played_at)
    // already maps to at most one spin — hence one show_id and one from_mbid.
    // Adding show_id to this key therefore cannot separate any distinct real
    // transition; it would only add a nullable column (show_id is null for
    // stations without program data) whose default NULLS-DISTINCT handling would
    // break dedup on re-derivation. show_id is still stored on every edge for
    // attribution — it just isn't part of the identity key.
    uniqueIndex("segue_edges_unique_idx").on(
      t.fromMbid,
      t.toMbid,
      t.stationId,
      t.playedAt,
    ),
    // Segue-next lookups fan out from the current song.
    index("segue_edges_from_idx").on(t.fromMbid),
  ],
);

export type SegueEdge = typeof segueEdgesTable.$inferSelect;
export type InsertSegueEdge = typeof segueEdgesTable.$inferInsert;

// ---- Pickers & picks (generalized taste sources) -----------------------

/**
 * A **picker** — any trusted human (or human-run entity) whose selections we
 * trust enough to "ride". A radio DJ is one picker type among labels, blogs,
 * curators, collectors and events. This is the generalization of the DJ/show
 * model: an obscure track that radio never touches can still be entered through
 * the label that released it, the blog that championed it, or the collector who
 * catalogued it.
 *
 * `pickerType` is a text tag (not a pg enum, to match the rest of this schema's
 * "text with a documented set" convention): one of
 * "dj" | "label" | "blog" | "curator" | "collector" | "event".
 *
 * `sourceRef` carries the external ids that let a worker re-sync the picker
 * (e.g. a MusicBrainz label MBID, an RSS feed URL, a Discogs list id). No
 * secrets belong here — it's public attribution metadata.
 */
/**
 * Health snapshot written by the blog poller on each poll cycle.
 * All fields optional — null/absent means "never polled yet".
 */
export interface PickerHealth {
  /** ISO timestamp of the last successful poll. */
  last_ok_at?: string | null;
  /** Error message from the most recent failure (absent on success). */
  last_error?: string | null;
  /** Number of consecutive failures since last success. Resets on success. */
  consecutive_failures: number;
}

export const pickersTable = pgTable(
  "pickers",
  {
    id: serial("id").primaryKey(),
    /** dj | label | blog | curator | collector | event. */
    pickerType: text("picker_type").notNull(),
    name: text("name").notNull(),
    /** Stable slug for idempotent upserts and public URLs. */
    handle: text("handle").notNull().unique(),
    /** Canonical home page (label site, blog, Discogs/RYM list, festival). */
    homeUrl: text("home_url"),
    /** External ids for re-sync: { labelMbid, feedUrl, discogsListId, ... }. */
    sourceRef: jsonb("source_ref").$type<Record<string, unknown>>(),
    /**
     * Trust weight, lower = stronger, mirroring the fallback ladder rungs:
     * 1 = label, 2 = blog/curator, 3 = collector/event. DJ trust still comes
     * from station class via the spins path; a picker default is 2.
     */
    trustTier: integer("trust_tier").notNull().default(2),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    /**
     * Health snapshot for feed-backed pickers. Written by blog-poller on each
     * cycle. Null for pickers that are never polled (label, dj, curator, etc.).
     * Shape: { last_ok_at?, last_error?, consecutive_failures }.
     */
    health: jsonb("health").$type<PickerHealth>(),
    /**
     * Genre/style tags: self-declared by the blog or derived from the genres of
     * its resolved picks. Null for pickers where tags are not applicable.
     */
    tags: text("tags").array(),
    /**
     * Cumulative genre representation of this picker's resolved picks
     * (top genres + counts), recomputed periodically by the insights job.
     * Derived — distinct from the self-declared `tags`. Null until enough
     * resolved picks exist.
     */
    genreProfile: jsonb("genre_profile").$type<{
      top: Array<{ genre: string; count: number }>;
      unknownCount: number;
      totalCount: number;
    }>(),
    /**
     * Cached discovery score (0-100, higher = newer-leaning picks) over this
     * picker's dated picks, recomputed by the insights job. Null until
     * enough dated history exists.
     */
    discoveryScore: real("discovery_score"),
    /** When genreProfile/discoveryScore were last recomputed. Null = never. */
    insightsUpdatedAt: timestamp("insights_updated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("pickers_type_idx").on(t.pickerType)],
);

export type Picker = typeof pickersTable.$inferSelect;
export type InsertPicker = typeof pickersTable.$inferInsert;

/**
 * Consent / claim record for a named human selector (DJ picker).
 *
 * One row per picker (unique index on `pickerId`). `optedOut = true` removes
 * the selector from all public surfaces immediately — profile pages, picker
 * rankings, overlap views, forecast rows, the Following strip — with no cache
 * lag. The selector's `spins` rows are untouched (spins are factual public
 * record; the *profile* is what's being consented to).
 *
 * `userId` is nullable — opting out does not require a connected Spotify
 * account. The claim / pending / verified lifecycle exists in the schema for
 * future verification flows (station-email proof, show-page-link proof, manual
 * admin review); no verification UI is built yet.
 */
export const selectorClaimsTable = pgTable(
  "selector_claims",
  {
    id: serial("id").primaryKey(),
    pickerId: integer("picker_id")
      .notNull()
      .references(() => pickersTable.id),
    /**
     * FK to lore_users; nullable — opt-out is possible without a Spotify
     * account.  Set when the opt-out request arrives with a live lore_sid
     * session; null for anonymous opt-outs.
     */
    userId: integer("user_id").references(() => loreUsersTable.id),
    /**
     * Claim lifecycle:
     *   unclaimed — no action taken by the selector.
     *   pending   — selector submitted a claim, awaiting verification.
     *   verified  — identity confirmed.
     *   declined  — claim rejected by admin review.
     * The verify flow is future work; the schema supports it now.
     */
    status: text("status").notNull().default("unclaimed"),
    /**
     * How the claim was verified (future work).
     * Values: station_email | show_page_link | manual
     */
    verifiedVia: text("verified_via"),
    verifiedAt: timestamp("verified_at"),
    /**
     * Selector's own words — never written by Lore. Null until the selector
     * fills it in (future UI work).
     */
    bio: text("bio"),
    /**
     * When true the selector is suppressed from all public surfaces immediately
     * (no cache lag). Spins rows are untouched — they are factual public
     * record; only the taste profile is being consented to.
     * Opting out does not require a verified claim or a connected account.
     */
    optedOut: boolean("opted_out").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("selector_claims_picker_uq").on(t.pickerId),
    index("selector_claims_user_idx").on(t.userId),
  ],
);
/**
 * A **pick** — one selection by a picker, resolved (best-effort) to the MBID
 * spine with a link back to the picker's own source. This is the generalized
 * edge table: a DJ's spin, a label's release, a blog's featured track, a
 * curator's list entry, a collector's catalogued item, an event's lineup slot.
 *
 * A pick is ALWAYS logged, even when resolution is approximate/unresolved
 * (`mbid` null), so the honesty gradient stays visible and backfill converges
 * later — exactly like `spins`.
 *
 * Ordered sources (a dated show, a sequenced release, a ranked list) carry an
 * `ordinal` so consecutive picks form rideable edges (the generalized segue
 * notion). Unordered sources (a bag of reviewed tracks) leave `ordinal` null
 * and are ridden as a set, never as a sequence.
 */
export const picksTable = pgTable(
  "picks",
  {
    id: serial("id").primaryKey(),
    pickerId: integer("picker_id")
      .notNull()
      .references(() => pickersTable.id),
    /** Resolved MusicBrainz Recording ID, when matched. Null = unresolved. */
    mbid: text("mbid").references(() => recordingsTable.mbid),
    /** MusicBrainz Artist ID, when known — powers the artist-level ladder rung. */
    artistMbid: text("artist_mbid"),
    /** Raw metadata as the source reported it, preserved for backfill. */
    rawArtist: text("raw_artist"),
    rawTitle: text("raw_title"),
    /**
     * spin | label_release | blog_post | curator_list | discogs_list |
     * event_lineup | user_seed.
     */
    source: text("source").notNull(),
    /** Free-text context: show name, release title, post/list title, etc. */
    context: text("context"),
    /** Link back to the picker's own source (post, release, list, video). */
    sourceUrl: text("source_url"),
    /**
     * Position within an ordered source (sequenced release, ranked list). Null
     * for unordered sources — those have no segue and are ridden as a set.
     */
    ordinal: integer("ordinal"),
    /** Source's stable id for this pick, when it exposes one — idempotent dedup. */
    externalId: text("external_id"),
    /** When the picker made this pick (release/post/list date). Nullable. */
    pickedAt: timestamp("picked_at"),
    /** "recording_id" | "isrc" | "text" | "unresolved". */
    confidence: text("confidence").notNull().default("unresolved"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // The entry-flow ladder fans out from a song (this recording) and from an
    // artist (artist-level rung).
    index("picks_mbid_idx").on(t.mbid),
    index("picks_artist_mbid_idx").on(t.artistMbid),
    index("picks_picker_picked_at_idx").on(t.pickerId, t.pickedAt),
    // Idempotent ingest: a given source pick id is logged once per picker.
    // Null externalIds are distinct in Postgres, so change-detection-style
    // sources are unaffected.
    uniqueIndex("picks_picker_external_idx").on(t.pickerId, t.externalId),
  ],
);

export type Pick = typeof picksTable.$inferSelect;
export type InsertPick = typeof picksTable.$inferInsert;

/**
 * Unified read model over every taste source. UNION of real `picks` (joined to
 * their picker) with a projection of `spins` into the same shape (a DJ is just
 * another picker). This is what lets the entry-flow ladder read ONE surface —
 * "spins read through the unified picks model" — without rebuilding the spin
 * ingestion path or dual-writing rows.
 *
 * Marked `.existing()` so drizzle-kit never tries to push it (avoiding view
 * drift on a push-based project); it is created idempotently via a
 * `CREATE OR REPLACE VIEW` at boot. `picker_type='dj'` and `trust_tier=3` label
 * the spin rows; `picker_id` is null for spins (their attribution lives in the
 * stations/shows tables the spins path already maintains).
 */
export const picksUnifiedView = pgView("picks_unified", {
  source: text("source").notNull(),
  mbid: text("mbid"),
  artistMbid: text("artist_mbid"),
  pickedAt: timestamp("picked_at"),
  context: text("context"),
  sourceUrl: text("source_url"),
  confidence: text("confidence").notNull(),
  ordinal: integer("ordinal"),
  pickerId: integer("picker_id"),
  pickerType: text("picker_type").notNull(),
  pickerName: text("picker_name").notNull(),
  pickerHandle: text("picker_handle").notNull(),
  trustTier: integer("trust_tier").notNull(),
}).existing();

/**
 * A listener's Spotify Connect link. Lore has no accounts, so the identity IS
 * an opaque random session id stored in an httpOnly cookie; this table maps
 * that sid to the listener's Spotify OAuth tokens. The tokens let the server
 * remote-control the listener's OWN Spotify player (Connect API) — Lore never
 * receives or proxies any audio. Rows are deleted on disconnect.
 */
export const spotifyConnectionsTable = pgTable("spotify_connections", {
  /** Opaque random session id (httpOnly cookie value). */
  sid: text("sid").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  /** When the current access token expires. */
  expiresAt: timestamp("expires_at").notNull(),
  /** Spotify display name, for the "connected as" UI. */
  displayName: text("display_name"),
  /** Spotify product tier ("premium", "free", ...) — playback needs premium. */
  product: text("product"),
  /** Spotify canonical user id (from /me), used to link lore_users rows. */
  spotifyUserId: text("spotify_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SpotifyConnection = typeof spotifyConnectionsTable.$inferSelect;
export type InsertSpotifyConnection =
  typeof spotifyConnectionsTable.$inferInsert;

/**
 * A **track claim** — one grounded, citable fact about a recording, extracted
 * systematically from an official source (e.g. an official Classic Albums
 * making-of clip's transcript, or a Wikipedia article section). We store the
 * paraphrased claim and a pointer to the source — never the source prose.
 *
 * `positionMs` optionally anchors the claim to a moment WITHIN the song (the
 * within-track time axis); null = a track-level fact shown in liner notes.
 * `sourceUrl` deep-links to the supporting moment in the source itself
 * (e.g. a YouTube `&t=` link, or a Wikipedia section anchor), so every claim
 * is one tap from its evidence.
 *
 * `anchorType` distinguishes claim categories:
 *   null      — timestamp-anchored (positionMs carries the offset)
 *   'section' — section-anchored (anchorValue carries the section label, e.g. "Recording")
 *
 * `status` drives the Wikipedia admin review workflow:
 *   'published' — visible on the song page (default for all existing claims)
 *   'draft'     — pending admin review (Wikipedia candidates start here)
 *   'rejected'  — discarded by admin (or sentinel for "no sections found")
 */
export const trackClaimsTable = pgTable(
  "track_claims",
  {
    id: serial("id").primaryKey(),
    mbid: text("mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** Optional anchor within the song; null = track-level fact. */
    positionMs: integer("position_ms"),
    /**
     * Anchor type for section-level facts (Wikipedia claims):
     * null = timestamp-anchored; 'section' = section-anchored.
     */
    anchorType: text("anchor_type"),
    /**
     * Anchor value: the section label when anchorType='section'
     * (e.g. "Recording", "Production", "Composition").
     */
    anchorValue: text("anchor_value"),
    /**
     * Review status. Existing Classic Albums claims default to 'published'.
     * Wikipedia candidates start as 'draft' and require admin review.
     */
    status: text("status").notNull().default("published"),
    /** The paraphrased, grounded claim (never verbatim source prose). */
    text: text("text").notNull(),
    /** Human-readable source label, e.g. "Classic Albums: Rio". */
    sourceLabel: text("source_label").notNull(),
    /** Deep link to the supporting moment (e.g. youtube.com/watch?v=..&t=123s). */
    sourceUrl: text("source_url").notNull(),
    /** Picker handle this claim came through, e.g. "classic-albums", "wikipedia". */
    sourceHandle: text("source_handle").notNull(),
    /** Stable id for idempotent re-extraction, e.g. "yt:{videoId}:{n}". */
    externalId: text("external_id").notNull().unique(),
    /** True for artist-verified Genius annotations; false for all other sources. */
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("track_claims_mbid_idx").on(t.mbid),
    index("track_claims_mbid_status_idx").on(t.mbid, t.status),
  ],
);

export type TrackClaim = typeof trackClaimsTable.$inferSelect;
export type InsertTrackClaim = typeof trackClaimsTable.$inferInsert;

/**
 * LRCLIB synced-lyric lines. Each row is one timed cue from an LRC file,
 * keyed to the MBID spine. The timeline axis (offset_ms) is what makes this
 * table structurally different from liner-note claims: it enables highlight-
 * in-time during playback.
 *
 * A miss-sentinel row (offset_ms = -1) is stored when LRCLIB has no synced
 * lyrics for an mbid, so the fetch is never retried on every page load.
 *
 * Policy: we store only the text of each line, never raw full-lyric prose
 * beyond what is needed to render the currently active cue.
 */
export const lyricLinesTable = pgTable(
  "lyric_lines",
  {
    id: serial("id").primaryKey(),
    mbid: text("mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** Millisecond offset from the start of the recording. -1 = miss sentinel. */
    offsetMs: integer("offset_ms").notNull(),
    /** The lyric text for this cue. Empty string for miss-sentinel rows. */
    text: text("text").notNull(),
    /** Source identifier, e.g. "lrclib". */
    source: text("source").notNull().default("lrclib"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("lyric_lines_mbid_idx").on(t.mbid),
    uniqueIndex("lyric_lines_mbid_offset_idx").on(t.mbid, t.offsetMs),
  ],
);

export type LyricLineRow = typeof lyricLinesTable.$inferSelect;
export type InsertLyricLineRow = typeof lyricLinesTable.$inferInsert;

/**
 * Latest evidence packet for a station's instrumental-programming audit.
 * The detailed JSON keeps the report auditable without adding a new table for
 * every sampled track; stationId is stable across reruns and seed updates.
 */
export const instrumentalStationAuditsTable = pgTable(
  "instrumental_station_audits",
  {
    stationId: integer("station_id")
      .primaryKey()
      .references(() => stationsTable.id, { onDelete: "cascade" }),
    classification: text("classification").notNull(),
    auditedAt: timestamp("audited_at").notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    checkedCount: integer("checked_count").notNull().default(0),
    instrumentalCount: integer("instrumental_count").notNull().default(0),
    lyricHitCount: integer("lyric_hit_count").notNull().default(0),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("instrumental_station_audits_classification_idx").on(t.classification),
    index("instrumental_station_audits_audited_at_idx").on(t.auditedAt),
  ],
);

export type InstrumentalStationAudit =
  typeof instrumentalStationAuditsTable.$inferSelect;
export type InsertInstrumentalStationAudit =
  typeof instrumentalStationAuditsTable.$inferInsert;

/**
 * Song Exploder episode records. Each episode deconstructs a single song; the
 * RSS feed gives us "Artist, Song Title" episodes that are resolved to MBID
 * and surfaced as `series` picker picks. A musician talking about their own
 * track is the highest possible attribution source.
 *
 * `mbid` is filled after successful resolution; null = unresolved / pending.
 * `resolvedAt` stamps when the MBID was first set so the poller can skip
 * already-resolved rows cheaply.
 */
export const songExploderEpisodesTable = pgTable(
  "song_exploder_episodes",
  {
    id: serial("id").primaryKey(),
    /** RSS guid (or episode URL when the feed lacks one) — stable dedup key. */
    externalId: text("external_id").notNull().unique(),
    /** Raw episode title as fetched from the feed, e.g. "Doja Cat, Need to Know". */
    title: text("title").notNull(),
    /** Link to the episode page on Song Exploder. */
    episodeUrl: text("episode_url").notNull(),
    /** Audio enclosure URL (the .mp3 of the episode), when the feed provides one. */
    audioUrl: text("audio_url"),
    /** When the episode was published. */
    publishedAt: timestamp("published_at"),
    /** Resolved MusicBrainz Recording ID, when matched. Null = unresolved. */
    mbid: text("mbid").references(() => recordingsTable.mbid),
    /** When the MBID was first resolved. */
    resolvedAt: timestamp("resolved_at"),
    /**
     * Best timestamped deep-link target for this episode (YouTube preferred
     * for reliable ?t= linking; fall back to episodeUrl when absent).
     * Admins store this once per episode; used to build anchor sourceUrls.
     */
    youtubeUrl: text("youtube_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("song_exploder_episodes_mbid_idx").on(t.mbid)],
);

export type SongExploderEpisode = typeof songExploderEpisodesTable.$inferSelect;
export type InsertSongExploderEpisode =
  typeof songExploderEpisodesTable.$inferInsert;

/**
 * Genius annotation draft — a candidate annotation ingested from Genius (via
 * the Referents API), awaiting admin review before being promoted to a
 * published `track_claim`. We project each annotation's lyric fragment against
 * the LRCLIB lyric_lines for the same recording to produce a timestamp anchor.
 *
 * Policy:
 *  - We never store the verbatim Genius annotation text. The normalized
 *    fragment's SHA-256 receipt and character length are retained only to make
 *    an ingest auditable; the full annotation is always read on Genius.
 *  - On publish the admin supplies a paraphrase which is stored in track_claims.
 *  - Only annotations with voteCount >= 5 OR verified=true are ingested.
 *  - `anchorType = 'timestamp'` when the fragment matched a LRCLIB line;
 *    'none' otherwise (still useful as a track-level claim).
 */
export const geniusAnnotationDraftsTable = pgTable(
  "genius_annotation_drafts",
  {
    id: serial("id").primaryKey(),
    mbid: text("mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** Genius internal song id for the matched song page. */
    geniusSongId: integer("genius_song_id").notNull(),
    /** Genius internal referent/annotation id — dedup key. */
    geniusAnnotationId: integer("genius_annotation_id").notNull(),
    /** SHA-256 receipt of the normalized Genius lyric fragment. */
    fragmentHash: text("fragment_hash").notNull(),
    /** Character length of the normalized Genius lyric fragment. */
    fragmentLen: integer("fragment_len").notNull(),
    /**
     * How the draft is anchored:
     * 'timestamp' — the fragment matched a LRCLIB line; offsetMs is set.
     * 'none' — no lyric line match; the claim is track-level.
     */
    anchorType: text("anchor_type").notNull().default("none"),
    /** Millisecond offset from the LRCLIB line that best matched the fragment. */
    offsetMs: integer("offset_ms"),
    /** Deep link to this specific annotation on genius.com. */
    geniusUrl: text("genius_url").notNull(),
    /** True when Genius marks this annotation as artist-verified. */
    verified: boolean("verified").notNull().default(false),
    /** Net upvotes on the annotation at ingest time. */
    voteCount: integer("vote_count").notNull().default(0),
    /**
     * Review status:
     * 'draft' — awaiting admin review.
     * 'published' — admin approved and promoted to track_claims.
     * 'rejected' — admin rejected; will not be promoted.
     */
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("genius_drafts_annotation_idx").on(t.geniusAnnotationId),
    index("genius_drafts_mbid_idx").on(t.mbid),
    index("genius_drafts_status_idx").on(t.status),
  ],
);

export type GeniusAnnotationDraft =
  typeof geniusAnnotationDraftsTable.$inferSelect;
export type InsertGeniusAnnotationDraft =
  typeof geniusAnnotationDraftsTable.$inferInsert;

// ---- Library, Keep & Taste Overlap (meta-library) ---------------------

/**
 * A Lore listener identity. The primary key for identity is now the
 * `deviceKey` — an opaque UUID written into the `lore_sid` HttpOnly cookie on
 * first visit, before any service is connected. Spotify (and future services)
 * are recovery anchors stored in `service_connections`, not the identity itself.
 *
 * `spotifyUserId` and `spotifyConnectionId` are kept nullable for the migration
 * period and will be dropped in a follow-on migration once confirmed safe.
 */
export const loreUsersTable = pgTable("lore_users", {
  id: serial("id").primaryKey(),
  /**
   * Opaque UUID assigned on first visit — the value stored in the `lore_sid`
   * cookie. This IS the session identity; no service connection required.
   */
  deviceKey: text("device_key").notNull().unique(),
  /** Spotify canonical user id — nullable after decoupling. Legacy field. */
  spotifyUserId: text("spotify_user_id").unique(),
  /** FK to the most-recent spotify_connections row. Legacy field. */
  spotifyConnectionId: text("spotify_connection_id").references(
    () => spotifyConnectionsTable.sid,
    { onDelete: "set null" },
  ),
  /** Stamped on every session resolution — drives idle-cleanup. */
  lastSeenAt: timestamp("last_seen_at"),
  /** Voluntarily provided email, for future recovery options. */
  email: text("email"),
  emailVerifiedAt: timestamp("email_verified_at"),
  /**
   * Opt-in server-side listen history (the ledger). Off by default — nothing
   * is written to `listens` until the listener explicitly enables this. Set via
   * PATCH /me/preferences.
   */
  ledgerEnabled: boolean("ledger_enabled").notNull().default(false),
  /**
   * Whether this listener may be included in anonymous active-listener
   * aggregates. This is independent from the personal library and ledger.
   */
  socialParticipation: boolean("social_participation").notNull().default(true),
  /**
   * Listener's chosen Halloween emoji avatar for song-bottle annotations.
   * Null until the listener picks one. Stored as the raw emoji character.
   */
  avatar: text("avatar"),
  /**
   * Anonymous listening identity. These fields are server-derived from an
   * eligible library/catalogue recording; `avatar` remains the historical
   * bottle-note emoji snapshot source.
   */
  avatarRecordingMbid: text("avatar_recording_mbid").references(
    () => recordingsTable.mbid,
    { onDelete: "set null" },
  ),
  avatarReleaseGroupMbid: text("avatar_release_group_mbid"),
  avatarAlbumTitle: text("avatar_album_title"),
  avatarArtist: text("avatar_artist"),
  avatarArtworkUrl: text("avatar_artwork_url"),
  avatarSource: text("avatar_source"),
  avatarVisitStartedAt: timestamp("avatar_visit_started_at"),
  avatarVisitRecordingMbid: text("avatar_visit_recording_mbid"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Finds the short-lived opted-in audience without scanning every listener.
  index("lore_users_social_presence_last_seen_idx").on(
    t.socialParticipation,
    t.lastSeenAt,
  ),
]);

export type LoreUser = typeof loreUsersTable.$inferSelect;
export type InsertLoreUser = typeof loreUsersTable.$inferInsert;

/**
 * A streaming-service OAuth connection belonging to a lore_user, used for
 * library import and optional Keep mirroring. One row per (user, service).
 * Tokens here are for the *library* scope, distinct from the playback-scoped
 * tokens in `spotify_connections`.
 */
export const serviceConnectionsTable = pgTable(
  "service_connections",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    /** "spotify" — the only supported value in this version. */
    service: text("service").notNull(),
    /**
     * The user's canonical id on the external service (e.g. Spotify user id).
     * Used as a recovery anchor: when a listener connects on a fresh device,
     * `(service, externalUserId)` resolves their prior library. Null for
     * connections created before this column was added (backfilled by migration).
     */
    externalUserId: text("external_user_id"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    /** Space-separated OAuth scopes granted by the user. */
    scopes: text("scopes"),
    /** True when user-library-modify scope was granted. */
    canWrite: boolean("can_write").notNull().default(false),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    lastImportAt: timestamp("last_import_at"),
  },
  (t) => [
    uniqueIndex("service_connections_user_service_idx").on(t.userId, t.service),
    // Recovery anchor: a given external account can only be linked to one
    // Lore identity. NULL rows are excluded so unset rows don't conflict.
    uniqueIndex("service_connections_service_external_idx").on(
      t.service,
      t.externalUserId,
    ),
  ],
);

export type ServiceConnection = typeof serviceConnectionsTable.$inferSelect;
export type InsertServiceConnection =
  typeof serviceConnectionsTable.$inferInsert;

export interface LibraryItemProvenance {
  kind: "keep" | "import";
  service?: string;
  /**
   * True when addedAt came from the source service's saved-track timestamp.
   * False means addedAt is an internal fallback and must not be shown as fact.
   */
  sourceKeepDate?: boolean;
  [k: string]: unknown;
}

/**
 * One recording in a listener's meta-library — either explicitly kept (heart
 * button) or imported from a streaming service. The UNIQUE (user_id, mbid)
 * constraint keeps the set clean across multiple import passes.
 */
export const libraryItemsTable = pgTable(
  "library_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    mbid: text("mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    provenance: jsonb("provenance").$type<LibraryItemProvenance>().notNull(),
    /**
     * The spin this keep came from, when the save happened off a live play
     * (station dial / ride / webplayer). Null for imports and direct keeps.
     * Links exports back to real air history — never fabricated for old rows.
     */
    spinId: integer("spin_id").references(() => spinsTable.id),
    addedAt: timestamp("added_at").defaultNow().notNull(),
    /**
     * Non-null when the listener has "deselected" this track. The row is
     * never deleted — it stays visible in the Library timeline (grayed) but
     * is excluded from crossings / library-hit / taste computations.
     * Null = active. Never propagated to Spotify (no unsave).
     */
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    uniqueIndex("library_items_user_mbid_idx").on(t.userId, t.mbid),
    index("library_items_user_added_idx").on(t.userId, t.addedAt),
  ],
);

export type LibraryItem = typeof libraryItemsTable.$inferSelect;
export type InsertLibraryItem = typeof libraryItemsTable.$inferInsert;

/**
 * Background library-import job. The worker pages the connector's
 * `importLibrary` async iterable, resolves each track to an MBID, and upserts
 * into `library_items`. `total` is set once the first page comes back; each
 * resolved+upserted row increments `resolved`.
 */
/** One entry in the in-flight import buffer — persisted after the fetch phase
 *  so a restarted server can resume Phase 3 without re-fetching Spotify. */
export interface ImportBufferEntry {
  artist: string;
  title: string;
  isrc?: string | null;
  durationMs?: number | null;
  externalId: string;
  /** Canonical ISO source timestamp; absent/null means the source supplied no valid date. */
  addedAt?: string | null;
}

/**
 * Normalized intermediate type produced by every import adapter (Spotify,
 * ListenBrainz, Last.fm, CSV, …).  The import worker consumes this type
 * internally; `ImportBufferEntry` remains the DB-serialised shape stored in
 * `bufferJson`.
 *
 * Resolution tiers:
 *   Tier 1 — `recordingMbid` present → direct spine write, no MB search.
 *   Tier 2 — `isrc` present → single-hop ISRC lookup in `recordings` + cache.
 *   Tier 3 — artist+title text search via MusicBrainz.
 */
export interface ImportItem {
  /** Tier 1: MusicBrainz Recording ID supplied by the source (e.g. ListenBrainz). */
  recordingMbid?: string;
  /** Tier 2: ISRC from the source, used for a fast spine lookup. */
  isrc?: string;
  artist: string;
  title: string;
  /** Album/release name — improves Tier 3 MB text-search confidence when present. */
  release?: string;
  /** Identifies which adapter produced this item. */
  sourceId: "listenbrainz" | "lastfm" | "applemusic" | "csv" | "spotify-byo";
  /** Native ID in the source system — used for deduplication. */
  sourceRef?: string;
  /** ISO-8601 timestamp when the user added/loved the track in the source system. */
  addedAt?: string;
}

export const libraryImportJobsTable = pgTable("library_import_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => loreUsersTable.id),
  service: text("service").notNull(),
  /** "pending" | "running" | "done" | "error" */
  status: text("status").notNull().default("pending"),
  /**
   * Current worker phase — stamped as the job progresses so the frontend can
   * show a meaningful label rather than a bare spinner.
   * "fetching" | "spine" | "cache" | "resolve" | null
   */
  phase: text("phase"),
  total: integer("total").notNull().default(0),
  resolved: integer("resolved").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
  /**
   * The raw Spotify track list captured after the fetching phase.
   * Persisted so a resumed import (after server restart) can jump straight
   * to Phase 3 without re-paging through the Spotify API.
   */
  bufferJson: jsonb("buffer_json").$type<ImportBufferEntry[]>(),
  /**
   * When a complete-buffer resume is used (the worker skipped the Spotify
   * fetch entirely and drained a prior job's stored buffer), this stores the
   * id of that prior job.  The frontend uses it to show
   * "Resuming from previous session…" instead of "Fetching your library…".
   */
  resumedFrom: integer("resumed_from"),
  /**
   * How many consecutive off-peak retry passes have resolved zero new tracks
   * for this job's un-cached entries. Incremented after each failed retry;
   * reset to 0 when a retry pass resolves at least one track.
   *
   * When this reaches PHASE3_MAX_RETRY_ATTEMPTS (3) the job is marked
   * `retryExhausted` and skipped in all future retry passes, preventing
   * un-resolvable tracks from accumulating nightly retry jobs indefinitely.
   */
  retryAttempts: integer("retry_attempts").notNull().default(0),
  /**
   * Set true when `retryAttempts` has reached the exhaustion threshold (3
   * consecutive failed retry passes). The off-peak scheduler skips exhausted
   * jobs entirely. Reset to false (and retryAttempts to 0) when a future
   * retry pass successfully resolves at least one previously un-cached track.
   */
  retryExhausted: boolean("retry_exhausted").notNull().default(false),
});

export type LibraryImportJob = typeof libraryImportJobsTable.$inferSelect;
export type InsertLibraryImportJob = typeof libraryImportJobsTable.$inferInsert;

/**
 * Per-item resolution audit trail for an import job.
 * One row per track per import: stores the raw input, resolved MBID (or null
 * for unresolved), the resolution tier, and a normalised confidence score for
 * Tier 3 (fuzzy MB text) matches.
 *
 * This table is the canonical source of truth for "what couldn't be matched"
 * — the off-peak nightly retry pass reads unresolved rows here instead of
 * reconstructing them from `bufferJson`.
 */
export const importItemsTable = pgTable(
  "import_items",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => libraryImportJobsTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    rawArtist: text("raw_artist").notNull(),
    rawTitle: text("raw_title").notNull(),
    rawRelease: text("raw_release"),
    sourceRef: text("source_ref"),
    isrc: text("isrc"),
    /**
     * Resolved MusicBrainz Recording ID, or null when unresolved.
     * Intentionally no FK — the recording row may not yet exist when an
     * unresolved row is inserted.  Written null at import time; updated to
     * the MBID if the nightly retry pass later resolves the track.
     */
    recordingMbid: text("recording_mbid"),
    /**
     * How the track was resolved:
     *   "recording_id" — source supplied the MBID directly (e.g. ListenBrainz)
     *   "isrc"         — matched via ISRC lookup
     *   "text"         — matched via MusicBrainz scored artist+title search
     *   null           — unresolved (no MBID found)
     */
    resolutionTier: text("resolution_tier"),
    /**
     * Normalised MB text-search score (0–1).  Only set when
     * `resolution_tier = 'text'`; null otherwise.
     * Derived from MusicBrainz's own 0–100 score (already filtered ≥ 90).
     */
    confidence: real("confidence"),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [
    index("import_items_job_idx").on(t.jobId),
    index("import_items_user_mbid_idx").on(t.userId, t.recordingMbid),
  ],
);

export type ImportItemRecord = typeof importItemsTable.$inferSelect;
export type InsertImportItem = typeof importItemsTable.$inferInsert;

/**
 * Per-user, per-service toggle: whether the Keep action should mirror to that
 * service's library. Defaults to enabled on first successful connection.
 */
export const keepTargetsTable = pgTable(
  "keep_targets",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    service: text("service").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [uniqueIndex("keep_targets_user_service_idx").on(t.userId, t.service)],
);

export type KeepTarget = typeof keepTargetsTable.$inferSelect;
export type InsertKeepTarget = typeof keepTargetsTable.$inferInsert;

/**
 * Spin-based save: the listener clicked Save on a track that may not yet be
 * resolved to a MusicBrainz MBID. Serves as the intent record.
 * `promotedAt` is set (and a `library_items` row written) immediately if the
 * spin already carries an MBID at save time, or remains null while pending.
 */
export const pendingKeepsTable = pgTable(
  "pending_keeps",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    spinId: integer("spin_id")
      .notNull()
      .references(() => spinsTable.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at").defaultNow().notNull(),
    /** Set when promoted to library_items (spin was or became resolved). */
    promotedAt: timestamp("promoted_at"),
  },
  (t) => [
    uniqueIndex("pending_keeps_user_spin_idx").on(t.userId, t.spinId),
    index("pending_keeps_spin_idx").on(t.spinId),
  ],
);

export type PendingKeep = typeof pendingKeepsTable.$inferSelect;
export type InsertPendingKeep = typeof pendingKeepsTable.$inferInsert;

/**
 * Pre-computed artist-overlap between a user's library and a radio station or
 * blog picker. Keyed by `(user_id, source_id, source_type)`.
 *
 * The hot path for `GET /api/me/stations/for-you` and `GET /api/me/blogs/for-you`
 * reads this table (a simple sort) instead of running a full cross-join every
 * request. The compute job upserts here after every library import and on a
 * daily refresh.
 *
 * `overlapping_artists` carries a sample of artist names (up to 10) for the
 * overlap-proof tooltip; the full count is in `overlap_count`.
 * `keep_overlap_count` counts only library items with provenance.kind="keep"
 * (explicit Lore keeps vs. bulk imports) — used for tier-2 ranking.
 */
export const userSourceAffinityTable = pgTable(
  "user_source_affinity",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    /**
     * The station.id or picker.id this row describes.
     * Not a FK because it references two different tables depending on sourceType.
     */
    sourceId: integer("source_id").notNull(),
    /** "station" | "picker" */
    sourceType: text("source_type").notNull(),
    /** Total distinct MBIDs in user's library that appear in this source's spins/picks. */
    overlapCount: integer("overlap_count").notNull().default(0),
    /** Overlap restricted to library items with provenance.kind IN ('keep','ride'). */
    keepOverlapCount: integer("keep_overlap_count").notNull().default(0),
    /**
     * Tier-3 signal: followed-picker affinity — distinct pickers that the user
     * follows AND whose picks share MBIDs with this source. Reserved for when
     * the follow graph is available (follow-up task); stored as 0 until then.
     */
    coPickerCount: integer("co_picker_count").notNull().default(0),
    /**
     * Up to 10 artist display names from the overlapping recordings — for the
     * overlap-proof tooltip. Null until the first compute run.
     */
    overlappingArtists: jsonb("overlapping_artists").$type<string[]>(),
    /** When this row was last recomputed. */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("user_source_affinity_unique_idx").on(
      t.userId,
      t.sourceId,
      t.sourceType,
    ),
    index("user_source_affinity_user_type_idx").on(t.userId, t.sourceType),
  ],
);

export type UserSourceAffinity = typeof userSourceAffinityTable.$inferSelect;
export type InsertUserSourceAffinity =
  typeof userSourceAffinityTable.$inferInsert;

/**
 * ICY metadata enrollment for Radio Browser stations.
 *
 * An admin enrolls a Radio Browser UUID; the poller fetches the station's
 * metadata from radio-browser.info, stores it here, and then polls the stream
 * for `StreamTitle` changes on a configurable interval.
 *
 * `icyStatus` values:
 *   "active"          — ICY metadata confirmed working; polling continues.
 *   "icy_unsupported" — The server responded without `icy-metaint`; polling
 *                       is suspended with a visible admin warning.
 *   "error"           — Three consecutive network errors; polling suspended.
 *                       Resets to "active" on the next successful fetch.
 *
 * `consecutiveErrors` counts failures since the last success and is reset to 0
 * on any successful ICY fetch, regardless of whether StreamTitle changed.
 */
export const radioBrowserStationsTable = pgTable("radio_browser_stations", {
  id: serial("id").primaryKey(),
  /** Radio Browser UUID (from radio-browser.info). */
  radioBrowserUuid: text("radio_browser_uuid").notNull().unique(),
  /** CDN-proxied stream URL fetched from Radio Browser API. */
  streamUrl: text("stream_url").notNull(),
  /** Station display name from Radio Browser. */
  name: text("name").notNull(),
  /** Favicon URL from Radio Browser, when available. */
  faviconUrl: text("favicon_url"),
  /**
   * FK to the stations table — the canonical station row for this station.
   * Null until a curated station row is linked (enrollment may create one).
   */
  stationId: integer("station_id").references(() => stationsTable.id),
  /** ICY metadata support status: "active" | "icy_unsupported" | "error". */
  icyStatus: text("icy_status").notNull().default("active"),
  /** The most recent raw StreamTitle value, for admin display. */
  lastStreamTitle: text("last_stream_title"),
  /** ISO timestamp of the most recent successful ICY fetch. */
  lastSuccessAt: timestamp("last_success_at"),
  /**
   * Consecutive ICY network error count since the last success.
   * When this reaches 3 the station is marked "error".
   */
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  enrolledAt: timestamp("enrolled_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RadioBrowserStationRow =
  typeof radioBrowserStationsTable.$inferSelect;
export type InsertRadioBrowserStationRow =
  typeof radioBrowserStationsTable.$inferInsert;

// ---------------------------------------------------------------------------
// List provenance layer
// ---------------------------------------------------------------------------

/**
 * Bridge: recording MBID → release group MBID(s).
 *
 * A recording appears on many releases (album, reissue, compilation, live).
 * `is_primary` flags the canonical studio album: primary-type = Album, no
 * secondary types, earliest first-release-date wins ties. Fetched from MB on
 * enrichment and cached forever (release group membership rarely changes).
 *
 * Carries the release group's title and year for display without an extra
 * MB lookup at render time.
 */
export const recordingReleaseGroupsTable = pgTable(
  "recording_release_groups",
  {
    id: serial("id").primaryKey(),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid, { onDelete: "cascade" }),
    releaseGroupMbid: text("release_group_mbid").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Cached release group title for display (e.g. "OK Computer"). */
    title: text("title"),
    /** MB primary type (e.g. "Album", "EP", "Single"). */
    primaryType: text("primary_type"),
    /** Earliest first-release year for this release group. */
    releaseYear: integer("release_year"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("rrg_recording_rg_unique_idx").on(
      t.recordingMbid,
      t.releaseGroupMbid,
    ),
    index("rrg_recording_primary_idx").on(t.recordingMbid, t.isPrimary),
    // Expands active listeners' saved release groups back to recording MBIDs.
    index("rrg_release_group_primary_idx").on(t.releaseGroupMbid, t.isPrimary),
  ],
);

export type RecordingReleaseGroup =
  typeof recordingReleaseGroupsTable.$inferSelect;
export type InsertRecordingReleaseGroup =
  typeof recordingReleaseGroupsTable.$inferInsert;

/**
 * Who authors lists. Publications (The Wire, Pitchfork) AND selectors/stations
 * (a picker's year-end run) share one table — a station's year-end list is a
 * first-class source.
 *
 * `picker_id` and `station_id` are both nullable: publications set neither.
 */
export const listSourcesTable = pgTable("list_sources", {
  id: serial("id").primaryKey(),
  /** "publication" | "selector" | "station" */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  pickerId: integer("picker_id").references(() => pickersTable.id),
  stationId: integer("station_id").references(() => stationsTable.id),
  homepageUrl: text("homepage_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ListSource = typeof listSourcesTable.$inferSelect;
export type InsertListSource = typeof listSourcesTable.$inferInsert;

/**
 * A specific published list (e.g. "The 50 Best Albums of 2025", The Wire).
 *
 * `is_ranked` + `list_length` are stored raw and normalized at render time —
 * we never bake a combined score into the DB. Unranked list appearances render
 * as "listed by" rather than "#—".
 *
 * `url` is a pointer; we never store editorial prose here.
 */
export const listsTable = pgTable(
  "lists",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => listSourcesTable.id),
    title: text("title").notNull(),
    /** Null for all-time lists. */
    year: integer("year"),
    /** "year_end" | "mid_year" | "decade" | "all_time" | "genre" | "custom" */
    kind: text("kind").notNull(),
    isRanked: boolean("is_ranked").notNull().default(true),
    listLength: integer("list_length"),
    /** Pointer to the list page — we never cache the editorial text. */
    url: text("url").notNull(),
    retrievedAt: timestamp("retrieved_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("lists_source_title_year_idx").on(t.sourceId, t.title, t.year),
  ],
);

export type List = typeof listsTable.$inferSelect;
export type InsertList = typeof listsTable.$inferInsert;

/**
 * Album-level entries within a list.
 *
 * Keyed on `(list_id, release_group_mbid)`. `release_group_mbid` may be an
 * empty string for `confidence = "unresolved"` entries awaiting human confirm
 * — in practice these are stored with a generated placeholder prefix so the
 * unique constraint still holds.
 *
 * `raw_artist` / `raw_album` preserve the scraped strings for the confirm UI.
 * `confirmed` becomes true once an admin has reviewed a fuzzy/unresolved match.
 * Only `confidence = "exact"` OR `confirmed = true` entries participate in
 * provenance queries.
 */
export const listEntriesTable = pgTable(
  "list_entries",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id")
      .notNull()
      .references(() => listsTable.id, { onDelete: "cascade" }),
    releaseGroupMbid: text("release_group_mbid").notNull(),
    rank: integer("rank"),
    blurbUrl: text("blurb_url"),
    /** Raw strings from the scrape — for display in the confirm UI. */
    rawArtist: text("raw_artist"),
    rawAlbum: text("raw_album"),
    /** "exact" | "fuzzy" | "unresolved" */
    confidence: text("confidence").notNull().default("exact"),
    confirmed: boolean("confirmed").notNull().default(false),
    /** Pointer to the published list page that produced this entry. */
    sourceUrl: text("source_url").notNull(),
    /** When this entry was extracted from the source page. */
    scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
    /** "llm" | "api" | "manual". */
    extraction: text("extraction").notNull(),
  },
  (t) => [
    uniqueIndex("list_entries_list_rg_idx").on(t.listId, t.releaseGroupMbid),
    index("list_entries_rg_idx").on(t.releaseGroupMbid),
    check(
      "list_entries_extraction_ck",
      sql`${t.extraction} in ('llm', 'api', 'manual')`,
    ),
  ],
);

export type ListEntry = typeof listEntriesTable.$inferSelect;
export type InsertListEntry = typeof listEntriesTable.$inferInsert;

/**
 * Durable, source-respecting RSS/Atom article ledger.  This is deliberately
 * separate from picks: a publication can be useful to a reader even when no
 * music work can be identified in its headline.
 */
export const rssArticlesTable = pgTable(
  "rss_articles",
  {
    id: serial("id").primaryKey(),
    pickerId: integer("picker_id").notNull().references(() => pickersTable.id),
    /** Feed supplied stable identity (guid/id, falling back to canonical URL). */
    guid: text("guid").notNull(),
    /** Publisher-owned article URL; Lore never stores or fetches its body. */
    url: text("url").notNull(),
    title: text("title").notNull(),
    /** Feed-provided byline, when available. */
    author: text("author"),
    /** Feed-provided article image URL, never fetched by the server. */
    imageUrl: text("image_url"),
    /** Bounded plain-text feed summary, never full article content. */
    excerpt: text("excerpt"),
    publishedAt: timestamp("published_at"),
    tags: text("tags").array(),
    /** Conservative headline/tag hint only, never a generated music pick. */
    matchedArtist: text("matched_artist"),
    matchedWork: text("matched_work"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("rss_articles_picker_guid_uq").on(t.pickerId, t.guid),
    uniqueIndex("rss_articles_picker_url_uq").on(t.pickerId, t.url),
    index("rss_articles_picker_published_idx").on(t.pickerId, t.publishedAt),
    index("rss_articles_published_idx").on(t.publishedAt),
  ],
);
export type RssArticle = typeof rssArticlesTable.$inferSelect;
export type InsertRssArticle = typeof rssArticlesTable.$inferInsert;

/** A listener's retained Press links.  This never creates a music keep. */
export const rssArticleBookmarksTable = pgTable(
  "rss_article_bookmarks",
  {
    userId: integer("user_id").notNull().references(() => loreUsersTable.id, { onDelete: "cascade" }),
    articleId: integer("article_id").notNull().references(() => rssArticlesTable.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.articleId], name: "rss_article_bookmarks_pkey" }),
    index("rss_article_bookmarks_user_saved_idx").on(t.userId, t.savedAt),
  ],
);
export type RssArticleBookmark = typeof rssArticleBookmarksTable.$inferSelect;
export type InsertRssArticleBookmark = typeof rssArticleBookmarksTable.$inferInsert;

/**
 * Feed posts flagged as **list candidates** — year-end / best-of / roundup
 * posts detected by the blog poller. Detection and extraction are two separate
 * stages by design: RSS answers "a list was published" (this table), while a
 * separate extraction worker later fetches the post page and parses the
 * individual entries into the lists/list_entries model. Rows are a durable
 * queue: `status` moves pending → extracted | failed | skipped, and re-ingest
 * is idempotent via the (picker_id, guid) unique key. Only the post title/link
 * from the feed is stored — never body text.
 */
export const blogListCandidatesTable = pgTable(
  "blog_list_candidates",
  {
    id: serial("id").primaryKey(),
    pickerId: integer("picker_id")
      .notNull()
      .references(() => pickersTable.id),
    /** The feed item's stable id (guid/id, else link) — dedup key per picker. */
    guid: text("guid").notNull(),
    /** The post page URL the extraction stage will fetch. */
    url: text("url").notNull(),
    /** The feed item title (e.g. "The 50 Best Albums of 2026 So Far"). */
    title: text("title").notNull(),
    /** Post publish date from the feed, when provided. */
    publishedAt: timestamp("published_at"),
    /** pending | extracted | failed | skipped — extraction-stage lifecycle. */
    status: text("status").notNull().default("pending"),
    /** When the extraction stage last processed this row. Null = never. */
    processedAt: timestamp("processed_at"),
    /** Extraction-stage error/skip note, for admin visibility. Null = none. */
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("blog_list_candidates_picker_guid_idx").on(t.pickerId, t.guid),
    index("blog_list_candidates_status_idx").on(t.status),
  ],
);

export type BlogListCandidate = typeof blogListCandidatesTable.$inferSelect;
export type InsertBlogListCandidate =
  typeof blogListCandidatesTable.$inferInsert;

/**
 * Per-station rolling ingest-quality snapshot, recomputed nightly from the
 * last 7 days of `spins`. One row per station (upserted on each recompute run).
 *
 * Four metrics (all 0–1 floats, null until first scored):
 *  - metadataYield       — fraction of spins with non-null artist+title
 *  - trackShaped         — fraction of metadata spins that look like "Artist – Title"
 *                          (not ALL-CAPS filler, not ad copy, minimum length)
 *  - mbidResolutionRate  — fraction of track-shaped spins that resolved to an MBID
 *  - musicShare          — fraction of spins that were NOT flagged as ad/promo copy
 *
 * qualityTier is derived from the thresholds in the spec:
 *  "proven"   — mbidResolutionRate ≥ 0.4
 *  "promising"— trackShaped ≥ 0.5
 *  "raw"      — metadataYield ≥ 0.2
 *  "silent"   — below all thresholds
 *  "unscored" — sampleCount < 20 (not penalized early)
 */
export const stationQualityTable = pgTable(
  "station_quality",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id")
      .notNull()
      .unique()
      .references(() => stationsTable.id),
    /** Fraction of logged spins (last 7 days) with non-null artist+title. */
    metadataYield: real("metadata_yield"),
    /** Fraction of non-null spins that look like a real "Artist – Title" track. */
    trackShaped: real("track_shaped"),
    /** Fraction of track-shaped spins that resolved to a MusicBrainz MBID. */
    mbidResolutionRate: real("mbid_resolution_rate"),
    /** Fraction of spins NOT flagged as ad/promo copy. */
    musicShare: real("music_share"),
    /** Number of spins in the scoring window. < 20 → "unscored". */
    sampleCount: integer("sample_count").notNull().default(0),
    /**
     * proven | promising | raw | silent | unscored.
     * Derived from the four metrics + sampleCount; stored for fast reads.
     */
    qualityTier: text("quality_tier").notNull().default("unscored"),
    /** When these scores were last computed. */
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (t) => [index("station_quality_station_idx").on(t.stationId)],
);

export type StationQuality = typeof stationQualityTable.$inferSelect;
export type InsertStationQuality = typeof stationQualityTable.$inferInsert;

/**
 * Staging table for Community Radio Index discovery candidates.
 * The CRI scraper writes one row per CRI station; rows with alreadyInLore=false
 * and icyStatus="yes" are the strongest candidates for promotion to the stations table.
 */
export const criCandidatesTable = pgTable("cri_candidates", {
  id: serial("id").primaryKey(),
  /** Slug from the CRI URL, e.g. "refuge-worldwide". */
  criSlug: text("cri_slug").notNull().unique(),
  name: text("name").notNull(),
  /** City the station broadcasts from, as listed on CRI. */
  city: text("city"),
  /** Country name as listed on CRI (e.g. "Germany", "UK"). */
  country: text("country"),
  /** Genre tags scraped from the CRI station page. */
  genres: jsonb("genres").$type<string[]>(),
  /** Station's own website URL scraped from CRI. */
  websiteUrl: text("website_url"),
  /** Best-guess stream URL sourced from Radio Browser; null if not found. */
  streamUrl: text("stream_url"),
  /**
   * Whether the stream URL returned usable ICY now-playing metadata.
   * "yes" = artist and title are present; "no" = stream exists but only
   * blank/station metadata was observed; "unknown" = untested or timed out.
   */
  icyStatus: text("icy_status").notNull().default("unknown"),
  /** Artist from the last usable ICY metadata block, if any. */
  currentArtist: text("current_artist"),
  /** Title from the last usable ICY metadata block, if any. */
  currentTitle: text("current_title"),
  /** Station ID, archive, or other non-track label from the last probe. */
  stationLabel: text("station_label"),
  /** True when a station with a matching name already exists in the stations table. */
  alreadyInLore: boolean("already_in_lore").notNull().default(false),
  /** Free-form notes from the scraper (e.g. why a stream was skipped). */
  notes: text("notes"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
});

export type CriCandidate = typeof criCandidatesTable.$inferSelect;
export type InsertCriCandidate = typeof criCandidatesTable.$inferInsert;

/**
 * Follow graph: a listener's explicit "follow" of a picker (DJ, blog,
 * curator, etc.) by the picker's canonical handle.
 *
 * This table is the source of truth for the lease-scorer's follow-bonus:
 * during `evaluateLeases`, all followed handles are loaded and passed to
 * `applyFollowBonus`, which gives a 3× multiplier to any station whose
 * currently-airing show's DJ name fuzzy-matches a followed handle — so a
 * followed DJ's time slot reliably wins a lease during their broadcast.
 *
 * `pickerHandle` matches `pickers.handle`; it is stored as text (not a FK)
 * so that a listener can follow a DJ handle even before a corresponding
 * picker row exists in the DB (e.g. followed via the dial before their
 * picker page is seeded).
 */
export const pickerFollowsTable = pgTable(
  "picker_follows",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    /** Canonical picker handle (matches pickers.handle when the row exists). */
    pickerHandle: text("picker_handle").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("picker_follows_user_handle_uq").on(t.userId, t.pickerHandle),
    index("picker_follows_user_idx").on(t.userId),
    index("picker_follows_handle_idx").on(t.pickerHandle),
  ],
);

export type PickerFollow = typeof pickerFollowsTable.$inferSelect;
export type InsertPickerFollow = typeof pickerFollowsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Library sync jobs — push Lore library → Spotify saved tracks
// ---------------------------------------------------------------------------

/**
 * One item in the sync receipt — a library track that could not be found on
 * Spotify. Carries a Bandcamp search link so the user can buy it properly.
 */
export interface SyncReceiptUnavailableItem {
  mbid: string;
  title: string;
  artist: string;
  bandcampUrl: string;
}

/** A search-matched item (lower confidence than ISRC). Surfaced in the UI. */
export interface SyncReceiptSearchItem {
  mbid: string;
  title: string;
  artist: string;
  spotifyUrl: string;
}

/** Completion receipt stored on the job row. */
export interface SyncReceipt {
  /** Exact ISRC or Odesli-link matches saved to Spotify. */
  synced: number;
  /** Artist+title search matches saved (lower confidence). */
  searchMatched: number;
  /** Already saved in Spotify before this sync ran (idempotent skip). */
  alreadySaved: number;
  /** Could not find on Spotify — listed with Bandcamp links. */
  unavailable: number;
  /** Capped list of unavailable items (max 200) — preview only. */
  unavailableItems: SyncReceiptUnavailableItem[];
  /** Full list of all unavailable MBIDs (no cap). Used by the
   *  /unavailable endpoint to serve the complete download. */
  unavailableMbids?: string[];
  /** Capped list of search-matched items (max 200) — preview only. */
  searchMatchedItems: SyncReceiptSearchItem[];
  /** Full list of all search-matched MBIDs (no cap). Used by the
   *  /search-matched endpoint to serve the complete download. */
  searchMatchedMbids?: string[];
}

/**
 * Background sync job: push the user's Lore library to a streaming service.
 * Currently only Spotify is supported. `results` is set on completion.
 *
 * Phase progression: "matching" → "checking" → "saving" → done/error.
 */
export const librarySyncJobsTable = pgTable("library_sync_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => loreUsersTable.id),
  service: text("service").notNull(),
  /** "pending" | "running" | "done" | "error" */
  status: text("status").notNull().default("pending"),
  /**
   * Current worker phase.
   * "matching" = resolving Lore mbids → Spotify track IDs.
   * "checking" = contains-check (idempotency pre-filter).
   * "saving" = PUT /me/tracks batches.
   */
  phase: text("phase"),
  /** Total library items to process. */
  total: integer("total").notNull().default(0),
  /** Items processed so far (not necessarily saved — includes all outcomes). */
  processed: integer("processed").notNull().default(0),
  /**
   * The number of library items that have been fully matched and committed to
   * memory at the last DB stamp. When the server restarts mid-matching, this
   * lets the worker skip ahead to where it left off rather than starting over.
   * Stamped every STAMP_EVERY items during the matching phase.
   */
  committedOffset: integer("committed_offset").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
  /** Completion receipt: counts + unavailable/search-matched item lists. */
  results: jsonb("results").$type<SyncReceipt>(),
  /**
   * When a resume is used (the worker picked up from a prior interrupted job's
   * committedOffset), this stores the id of that prior job.  The frontend uses
   * it to show "Resuming…" instead of "Starting…".
   */
  resumedFrom: integer("resumed_from"),
  /**
   * Intermediate match state persisted alongside committedOffset so that a
   * resumed worker can restore previously found Spotify IDs rather than
   * re-running expensive ISRC / text searches for those items.
   *
   * Shape: { matched: MatchedItem[]; unmatched: UnmatchedItem[] }
   * where MatchedItem = { mbid, title, artist, spotifyId, confidence }
   *       UnmatchedItem = { mbid, title, artist }
   * Cleared to null once the matching phase completes.
   */
  matchedJson: jsonb("matched_json").$type<{
    matched: Array<{
      mbid: string;
      title: string;
      artist: string;
      spotifyId: string;
      confidence: "link" | "isrc" | "search";
    }>;
    unmatched: Array<{ mbid: string; title: string; artist: string }>;
  }>(),
});

export type LibrarySyncJob = typeof librarySyncJobsTable.$inferSelect;
export type InsertLibrarySyncJob = typeof librarySyncJobsTable.$inferInsert;

/**
 * A durable mapping from a Lore recording to one service's track URL.  This is
 * deliberately separate from recordings.links: links is the presentation
 * payload and can contain a mixture of exact and search links, while this
 * table is the stable asset that replay jobs can re-use and re-verify.
 */
export const serviceTrackMapTable = pgTable(
  "service_track_map",
  {
    id: serial("id").primaryKey(),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** Canonical id such as "spotify", "apple_music", or "youtube". */
    service: text("service").notNull(),
    /** Service-native track id when it can be extracted from the URL. */
    externalId: text("external_id"),
    /**
     * Direct link to the track on the service.  Null only for negative-cache
     * (embed_miss) rows, where service="odesli" records that a lookup was
     * attempted and found nothing.  Every positive hit row has a non-null url.
     */
    url: text("url"),
    /** "recording_id" | "isrc" | "odesli" | "title_search". */
    method: text("method").notNull(),
    /** "exact" | "search" — retained as text so new resolver tiers are additive. */
    confidence: text("confidence").notNull().default("search"),
    /** "verified" for an exact Odesli/service link, otherwise "unverified". */
    verification: text("verification").notNull().default("unverified"),
    /** Dead links are retained so a later job can re-verify them. */
    deadLink: boolean("dead_link").notNull().default(false),
    deadAt: timestamp("dead_at"),
    lastVerifiedAt: timestamp("last_verified_at"),
    /**
     * Populated on negative-cache rows (service="odesli", url IS NULL).
     * Values: "no_vector" | "no_links" | "no_recording".
     * Null on every positive-hit row.
     */
    missReason: text("miss_reason"),
    /** Timestamp of the last miss write; used to enforce the 30-day re-attempt TTL. */
    missedAt: timestamp("missed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("service_track_map_recording_service_uq").on(
      t.recordingMbid,
      t.service,
    ),
    index("service_track_map_service_external_idx").on(t.service, t.externalId),
    index("service_track_map_recording_idx").on(t.recordingMbid),
  ],
);
export type InsertSelectorClaim = typeof selectorClaimsTable.$inferInsert;

export type SelectorClaim = typeof selectorClaimsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Listening ledger
// ---------------------------------------------------------------------------

/**
 * One listen event — a server-side record of what the user actually heard.
 * Written ONLY when `lore_users.ledger_enabled = true`. The ledger is off by
 * default; the user opts in via PATCH /me/preferences.
 *
 * `context` values:
 *   'broadcast' — heard on a live station stream
 *   'ride'      — heard in a Segue/ride session
 *   'replay'    — heard in an archive-replay session
 *   'library'   — heard from an explicit library play
 *
 * `outputService` values:
 *   'broadcast' — audio came from the station's own stream (Lore player)
 *   'spotify'   — audio came from Spotify Connect
 *   'apple'     — reserved
 *   'tidal'     — reserved
 *
 * `releaseGroupMbid` is denormalised from `recording_release_groups.is_primary`
 * at write time so album-completion queries are a single aggregation over this
 * table with no extra join.
 */
export const listensTable = pgTable(
  "listens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    /**
     * MusicBrainz Recording ID. Nullable — unresolved spins produce a row
     * with mbid=null (honest incompleteness, backfillable later).
     */
    mbid: text("mbid").references(() => recordingsTable.mbid),
    /** FK to the spin that triggered this listen (absent for library rides). */
    spinId: integer("spin_id").references(() => spinsTable.id),
    stationId: integer("station_id").references(() => stationsTable.id, {
      onDelete: "set null",
    }),
    pickerId: integer("picker_id").references(() => pickersTable.id),
    showId: integer("show_id").references(() => showsTable.id),
    /** 'broadcast' | 'ride' | 'replay' | 'library' */
    context: text("context").notNull(),
    /** 'broadcast' | 'spotify' | 'apple' | 'tidal' */
    outputService: text("output_service").notNull(),
    startedAt: timestamp("started_at").notNull(),
    /** Milliseconds of this recording heard so far (updated in-place). */
    msPlayed: integer("ms_played").notNull().default(0),
    /**
     * True once ≥ 70 % of track duration (or 4 minutes) have been heard.
     * Flipped by PATCH /me/listens/:id when the threshold is crossed.
     */
    completed: boolean("completed").notNull().default(false),
    /**
     * Primary release group MBID, denormalised from recording_release_groups
     * at write time for efficient album-completion rollups. Null when the
     * recording has no primary release group in the spine.
     */
    releaseGroupMbid: text("release_group_mbid"),
  },
  (t) => [
    // Primary read path: user's history newest-first.
    index("listens_user_started_idx").on(t.userId, t.startedAt),
    // Album-completion aggregation: which release groups has the user heard?
    index("listens_user_rg_idx").on(t.userId, t.releaseGroupMbid),
    // Station analytics (future): how many listens did a station receive?
    index("listens_station_started_idx").on(t.stationId, t.startedAt),
  ],
);

export type Listen = typeof listensTable.$inferSelect;
export type InsertListen = typeof listensTable.$inferInsert;

/**
 * Unresolved Spotify library tracks — the ~45 % of saved songs that the
 * import worker could not match to a MusicBrainz MBID.  Stored with full
 * Spotify metadata (artwork, album name, ISRC) so the listener sees their
 * whole library, not just the resolved fraction.
 *
 * Lifecycle:
 *  - Written at the end of every Spotify import for entries that Phase 3
 *    could not resolve.  `artworkUrl` is filled by a batch call to
 *    Spotify GET /v1/tracks so artwork renders immediately.
 *  - When a nightly off-peak retry later resolves the track, `mbid` is
 *    set (still in this table) and the row is promoted: a `library_items`
 *    row is inserted and this row is deleted in the same operation.
 *  - The unique key is `(user_id, spotify_id)` so re-imports are idempotent.
 */
export const spotifyLibraryItemsTable = pgTable(
  "spotify_library_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    /** Spotify track ID (22-char alphanumeric). */
    spotifyId: text("spotify_id").notNull(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    albumName: text("album_name"),
    /** 300 px album artwork URL from the Spotify CDN. */
    artworkUrl: text("artwork_url"),
    isrc: text("isrc"),
    addedAt: timestamp("added_at").defaultNow().notNull(),
    /**
     * Set once a nightly retry resolves this row to a MusicBrainz MBID.
     * Non-null rows have a matching `library_items` row and are ready to
     * be cleaned up.  Null = still unresolved.
     */
    mbid: text("mbid").references(() => recordingsTable.mbid),
    /**
     * Non-null when the listener has "deselected" this soft row. Mirrors
     * library_items.removed_at: row stays listed but is excluded from
     * soft-artist crossings / library-hit matching. Null = active.
     */
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    uniqueIndex("spotify_library_items_user_spotify_idx").on(
      t.userId,
      t.spotifyId,
    ),
    index("spotify_library_items_user_added_idx").on(t.userId, t.addedAt),
    index("spotify_library_items_isrc_idx").on(t.isrc),
  ],
);

export type SpotifyLibraryItem = typeof spotifyLibraryItemsTable.$inferSelect;
export type InsertSpotifyLibraryItem =
  typeof spotifyLibraryItemsTable.$inferInsert;

/**
 * Apple Music library tracks captured by MusicKit in the browser.
 *
 * Apple IDs are provider identities, not canonical Lore identities. Keep this
 * staging row even after an ISRC match promotes a recording into
 * library_items so playback can queue the exact Apple song without guessing
 * from title/artist metadata.
 */
export const appleLibraryItemsTable = pgTable(
  "apple_library_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    appleId: text("apple_id").notNull(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    albumName: text("album_name"),
    artworkUrl: text("artwork_url"),
    isrc: text("isrc"),
    addedAt: timestamp("added_at").defaultNow().notNull(),
    mbid: text("mbid").references(() => recordingsTable.mbid),
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    uniqueIndex("apple_library_items_user_apple_idx").on(t.userId, t.appleId),
    index("apple_library_items_user_added_idx").on(t.userId, t.addedAt),
    index("apple_library_items_isrc_idx").on(t.isrc),
    index("apple_library_items_user_mbid_idx").on(t.userId, t.mbid),
  ],
);

export type AppleLibraryItem = typeof appleLibraryItemsTable.$inferSelect;
export type InsertAppleLibraryItem = typeof appleLibraryItemsTable.$inferInsert;

/**
 * Shared persistent cache for per-user crossing results.
 *
 * Keyed on `user_id` (one row per user).  A server restart reads from here
 * so the first-request full-table scan only happens once per TTL window
 * across all instances, not once per instance per restart.
 *
 * TTL is enforced in application code (same 5-minute window as the in-process
 * Map).  The `built_at` column is the authoritative freshness timestamp.
 * The in-process Map in `crossings.ts` acts as an L1 layer on top of this
 * L2 Postgres row — it is filled on the first request after a restart and
 * stays hot for the duration of the process.
 */
/**
 * One station's crossing counts for a user — the payload shape returned by
 * GET /api/me/crossings AND the element type of `crossings_cache.data`.
 *
 * This is the single source of truth for that shape: the route handler in
 * `artifacts/api-server/src/routes/me/crossings.ts` imports it, and the
 * `crossingsCacheTable.data` column below is typed with it, so adding a
 * field in only one place fails typecheck instead of silently drifting.
 */
export interface CrossingsRow {
  stationSlug: string;
  crossings: number;
  artistCrossings: number;
  /** First-ever Lore plays that are also crossings, in the rolling 24h window. */
  firstPlayCrossings?: number;
  weekCrossings: number;
  weekArtistCrossings: number;
  /** First-ever Lore plays that are also crossings, in the rolling 7d window. */
  weekFirstPlayCrossings?: number;
  monthCrossings: number;
  monthArtistCrossings: number;
  /** First-ever Lore plays that are also crossings, in the rolling 30d window. */
  monthFirstPlayCrossings?: number;
  lifetimeCrossings: number;
  lifetimeArtistCrossings: number;
  /** First-ever Lore plays that are also crossings, over the full archive. */
  lifetimeFirstPlayCrossings?: number;
  /**
   * Top crossing artist names for the 24h window (up to 3, ranked by
   * play-frequency).  Optional so old cached rows without this field still
   * parse cleanly; consumers must treat undefined as [].
   */
  topArtistNames24h?: string[];
  /**
   * Top crossing artist names for the 7d window (up to 3).
   * Optional for the same backward-compat reason as topArtistNames24h.
   */
  topArtistNames7d?: string[];
  /**
   * Top crossing artist names over all time (up to 3).
   * Optional for the same backward-compat reason as topArtistNames24h.
   */
  topArtistNamesLifetime?: string[];
  /** Exact crate albums this station has aired, newest crossing first. */
  albumCrossings?: Array<{
    releaseGroupMbid: string | null;
    recordingMbid: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
  }>;
}

export const crossingsCacheTable = pgTable("crossings_cache", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => loreUsersTable.id, { onDelete: "cascade" }),
  /**
   * Serialised CrossingsRow[] — the same shape returned by GET /api/me/crossings.
   * Stored as jsonb so Postgres can store/retrieve it cheaply without a scan.
   */
  data: jsonb("data").notNull().$type<CrossingsRow[]>(),
  /** When the data was last computed (used for TTL checks). */
  builtAt: timestamp("built_at").notNull(),
});

/**
 * Single-row persistent L2 cache for the anonymous blended crossings view
 * (GET /api/me/crossings/blended).
 *
 * The blended result is global (no per-user key), so exactly one row exists
 * (id = 1, enforced by the upsert in the route). Same L1/L2 pattern as
 * `crossings_cache`: the route's in-memory single-entry cache is L1; this row
 * survives restarts so cold starts within the TTL skip the two heavy
 * aggregate queries. TTL is enforced in application code via `built_at`.
 */
export const blendedCrossingsCacheTable = pgTable("blended_crossings_cache", {
  id: integer("id").primaryKey(),
  /** Serialised rows — CrossingsRow plus the blended-only topArtistNames. */
  data: jsonb("data").notNull().$type<Array<CrossingsRow & { topArtistNames: string[] }>>(),
  /** When the data was last computed (used for TTL checks). */
  builtAt: timestamp("built_at").notNull(),
});

/**
 * Pre-computed TRUE lifetime crossing counts per user (unbounded scan).
 *
 * The hot-path crossings query is bounded to 30 days so it stays fast even as
 * the spins table grows.  This table stores the result of a periodic background
 * job that runs the unbounded equivalent query off the request path.
 *
 * Schema mirrors crossings_cache but carries only the lifetime-specific fields.
 * One row per user; refreshed daily and on every library/taste-seed change.
 */
export const lifetimeCrossingsCacheTable = pgTable("lifetime_crossings_cache", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => loreUsersTable.id, { onDelete: "cascade" }),
  /**
   * Serialised array of { stationSlug, lifetimeCrossings, lifetimeArtistCrossings }.
   * Stored as jsonb for cheap upsert/read without a sequential scan.
   */
  data: jsonb("data").notNull().$type<
    Array<{
      stationSlug: string;
      lifetimeCrossings: number;
      lifetimeArtistCrossings: number;
    }>
  >(),
  /** When the data was last computed (informational; not used for TTL — background job is the authority). */
  builtAt: timestamp("built_at").notNull(),
});
/**
 * Persistent completion ledger for one-shot boot migrations.
 *
 * Each row marks a named migration as durably complete. Boot migrations that
 * are expensive or destructive (e.g. applySpinDedupCleanup) check this table
 * first and return immediately when their name is already present, turning
 * every subsequent boot into a near-instant no-op.
 *
 * The row is always inserted *inside the same transaction* as the migration
 * work, so the completion flag is atomic with the data change — a crashed
 * or rolled-back migration never leaves a spurious completion row.
 */
export const migrationCompletionsTable = pgTable("migration_completions", {
  /** Stable, human-readable migration name (matches the function name). */
  name: text("name").primaryKey(),
  completedAt: timestamp("completed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type MigrationCompletion = typeof migrationCompletionsTable.$inferSelect;
export type InsertMigrationCompletion =
  typeof migrationCompletionsTable.$inferInsert;

// ---- Attendance (heard-it, not kept-it) -----------------------------------

/**
 * One continuous listening session: the interval during which a specific user
 * was tuned to a specific station.  Created on the first heartbeat, kept alive
 * by subsequent heartbeats, and closed either by inactivity (> 4 h gap) or
 * when the client explicitly stops.
 *
 * The session is the join key between a listener and the spins that aired
 * while they were tuned in.
 */
export const listenSessionsTable = pgTable(
  "listen_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    /** Updated on every heartbeat — the high-water mark of confirmed presence. */
    lastHeartbeatAt: timestamp("last_heartbeat_at").defaultNow().notNull(),
    /**
     * Set when the session is closed — either by the expiry worker
     * (end_reason='expired') or by a future explicit stop signal.
     * Null means the session is still active.
     */
    endedAt: timestamp("ended_at"),
    /** 'expired' when closed by the 4-hour inactivity worker. */
    endReason: text("end_reason"),
  },
  (t) => [
    index("listen_sessions_user_station_idx").on(t.userId, t.stationId),
    index("listen_sessions_last_heartbeat_idx").on(t.lastHeartbeatAt),
  ],
);

export type ListenSession = typeof listenSessionsTable.$inferSelect;
export type InsertListenSession = typeof listenSessionsTable.$inferInsert;

/**
 * One confirmed attendance event: the user was tuned for long enough during a
 * spin to count as having "heard" it.
 *
 * Attendance NEVER auto-promotes to a Keep — the wall is unconditional.
 * Recording identity flows through `spin_id → spins.mbid`, never duplicated here.
 *
 * Dwell gate: dwell_seconds ≥ min(spin_duration_seconds × 0.5, 60).
 * Sub-threshold dwells are discarded, not stored at lower confidence.
 */
export const attendanceTable = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    spinId: integer("spin_id")
      .notNull()
      .references(() => spinsTable.id),
    sessionId: integer("session_id")
      .notNull()
      .references(() => listenSessionsTable.id),
    /** How many seconds of confirmed listening overlapped this spin. */
    dwellSeconds: integer("dwell_seconds").notNull(),
    /**
     * Known duration of the spin in seconds (from recordings.duration_ms),
     * or null when the recording was unresolved / duration unknown at write time.
     */
    spinDurationSeconds: integer("spin_duration_seconds"),
    /**
     * High-water mark: the latest heartbeat window-end that has been credited
     * into this row's dwell_seconds total.  Used to make the upsert idempotent
     * against replays — a conflict update only accumulates dwell when the
     * incoming credited_through is strictly greater than the stored value, so
     * toggling ATTENDANCE_DEDUP_CONFIRMED off and on can never double-count a
     * window that was already credited.
     *
     * NULL on legacy rows written before this column was added; those rows are
     * treated conservatively — the upsert will NOT accumulate further dwell
     * until a fresh credited_through value is stored.
     */
    creditedThrough: timestamp("credited_through", { withTimezone: true }),
    /**
     * True once this row has crossed the dwell gate and contributed one spin
     * to the maintained per-recording rollup.
     */
    rollupCounted: boolean("rollup_counted").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One attendance row per (user, spin) — upsert-safe.
    uniqueIndex("attendance_user_spin_uq").on(t.userId, t.spinId),
    index("attendance_user_idx").on(t.userId),
    index("attendance_session_idx").on(t.sessionId),
  ],
);

export type Attendance = typeof attendanceTable.$inferSelect;
export type InsertAttendance = typeof attendanceTable.$inferInsert;

/**
 * Maintained listener/recording attendance read model.
 *
 * `attendance` remains the per-spin audit trail.  This table is the compact
 * source for listener-facing aggregates: dwell is accumulated from each
 * newly-credited attendance slice, while spinCount increments only when a
 * distinct spin crosses the existing dwell gate.
 */
export const attendanceRollupsTable = pgTable(
  "attendance_rollups",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** Total credited listening seconds across this listener's spins. */
    dwellTotal: integer("dwell_total").notNull().default(0),
    /** Number of distinct spins whose dwell meets the attendance gate. */
    spinCount: integer("spin_count").notNull().default(0),
    /** Air time of the first spin that crossed the attendance gate. */
    firstHeard: timestamp("first_heard", { withTimezone: true }),
    /** Air time of the most recent spin that crossed the attendance gate. */
    lastHeard: timestamp("last_heard", { withTimezone: true }),
  },
  (t) => [
    primaryKey({
      name: "attendance_rollups_user_recording_pk",
      columns: [t.userId, t.recordingMbid],
    }),
    index("attendance_rollups_user_recording_idx").on(
      t.userId,
      t.recordingMbid,
    ),
    index("attendance_rollups_user_idx").on(t.userId),
    index("attendance_rollups_recording_idx").on(t.recordingMbid),
    check("attendance_rollups_dwell_total_ck", sql`${t.dwellTotal} >= 0`),
    check("attendance_rollups_spin_count_ck", sql`${t.spinCount} >= 0`),
  ],
);

export type AttendanceRollup = typeof attendanceRollupsTable.$inferSelect;
export type InsertAttendanceRollup = typeof attendanceRollupsTable.$inferInsert;

/**
 * Per-listener, per-recording, per-ISO-week read model for weekly listening
 * summaries ("Your Week on Air").
 *
 * Maintained incrementally from the heartbeat write path at the same time as
 * `attendance_rollups`, so the weekly endpoint never re-aggregates raw rows —
 * it performs a constant-time indexed lookup on (user_id, iso_week).
 *
 * `isoWeek` uses UTC-based ISO weeks ("YYYY-Www", e.g. "2026-W31") derived
 * from the spin's `played_at` timestamp, ensuring the track is placed in the
 * week it was actually on air.
 *
 * `spinCount` and `firstHeard`/`lastHeard` mirror the lifetime rollup
 * semantics: spinCount increments only when a spin crosses the dwell gate;
 * dwell_total accumulates from every credited heartbeat window.
 */
export const attendanceWeeklyRollupsTable = pgTable(
  "attendance_weekly_rollups",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /**
     * ISO week label (UTC), e.g. "2026-W31".
     * Derived from the spin's played_at, not the heartbeat timestamp,
     * so a track always belongs to the week it aired on.
     */
    isoWeek: text("iso_week").notNull(),
    /** Total credited listening seconds for this recording in this week. */
    dwellTotal: integer("dwell_total").notNull().default(0),
    /** Number of distinct spins whose dwell meets the attendance gate. */
    spinCount: integer("spin_count").notNull().default(0),
    /** played_at of the first qualifying spin in this week. */
    firstHeard: timestamp("first_heard", { withTimezone: true }),
    /** played_at of the most recent qualifying spin in this week. */
    lastHeard: timestamp("last_heard", { withTimezone: true }),
  },
  (t) => [
    primaryKey({
      name: "attendance_weekly_rollups_pk",
      columns: [t.userId, t.recordingMbid, t.isoWeek],
    }),
    // Primary lookup: all recordings for a user in a given week.
    index("attendance_weekly_rollups_user_week_idx").on(t.userId, t.isoWeek),
    index("attendance_weekly_rollups_user_idx").on(t.userId),
    check("attendance_weekly_rollups_dwell_ck", sql`${t.dwellTotal} >= 0`),
    check("attendance_weekly_rollups_spin_ck", sql`${t.spinCount} >= 0`),
  ],
);

export type AttendanceWeeklyRollup =
  typeof attendanceWeeklyRollupsTable.$inferSelect;
export type InsertAttendanceWeeklyRollup =
  typeof attendanceWeeklyRollupsTable.$inferInsert;

// ---- Taste seeds (zero-friction onboarding) --------------------------------

/**
 * Artist name seeds entered directly by a listener before they have connected
 * any music service.  These flow through the crossing-score pipeline exactly
 * like unresolved soft-artist rows from Spotify imports — stations playing a
 * seeded artist appear in Zone 1 immediately.
 *
 * Tied to the device-identity session (lore_users row auto-provisioned on
 * first visit) so seeds survive page refreshes without an account.  A PUT
 * to /api/me/taste-seeds replaces the full set atomically and busts both
 * the crossings and library-hit caches so Zone 1 reflects the new artists
 * on the very next poll.
 */
export const tasteSeedsTable = pgTable(
  "taste_seeds",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    /** Display form of the artist name (trimmed, original case). */
    artistName: text("artist_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("taste_seeds_user_idx").on(t.userId),
    // Unique per (user, normalised name) — duplicate handling is done in the
    // route (lowercase+trim before insert), so the DB index uses the raw column.
    uniqueIndex("taste_seeds_user_artist_uq").on(t.userId, t.artistName),
  ],
);

export type TasteSeed = typeof tasteSeedsTable.$inferSelect;
export type InsertTasteSeed = typeof tasteSeedsTable.$inferInsert;

/**
 * Per-artist fetch-tracking for the Shows lens (Bandsintown events cache).
 *
 * One row per normalized artist key records WHEN we last fetched from
 * Bandsintown and HOW MANY upcoming events were returned.  Zero means a
 * negative cache (artist known but no upcoming events); null means never
 * fetched.  TTL logic lives in the route — positive results expire in 6 h,
 * negative results expire in 1 h, so we avoid hammering the API for artists
 * with no tour dates while still catching newly-announced shows quickly.
 */
export const artistEventsCacheTable = pgTable(
  "artist_events_cache",
  {
    id: serial("id").primaryKey(),
    /** Normalized artist key (lowercase, ASCII-folded, punctuation-stripped). */
    artistKey: text("artist_key").notNull().unique(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    /** 0 = negative cache (no upcoming events found). */
    eventCount: integer("event_count").notNull().default(0),
  },
);

export type ArtistEventsCache = typeof artistEventsCacheTable.$inferSelect;
export type InsertArtistEventsCache = typeof artistEventsCacheTable.$inferInsert;

/**
 * Upcoming concert events for artists in listeners' taste sets, sourced from
 * Bandsintown.  Keyed by (artistKey, eventId) — a full replace-on-fetch
 * approach: old rows for an artist are deleted before the new batch is
 * inserted, so stale events never linger.
 *
 * Only future events are kept; past events are naturally excluded by the route's
 * `event_datetime >= now()` filter and optionally pruned by a cleanup job later.
 */
export const artistEventsTable = pgTable(
  "artist_events",
  {
    id: serial("id").primaryKey(),
    /** Normalized artist key — join key back to artistEventsCacheTable. */
    artistKey: text("artist_key").notNull(),
    /** Bandsintown event id — stable for the lifetime of the event listing. */
    eventId: text("event_id").notNull(),
    /** UTC event start time.  Used for soonest-first ordering. */
    eventDatetime: timestamp("event_datetime").notNull(),
    /** YYYY-MM-DD date string from the Bandsintown response (venue-local). */
    eventDate: text("event_date").notNull(),
    venueName: text("venue_name"),
    venueCity: text("venue_city").notNull(),
    /** State / province (e.g. "OR", "England"). */
    venueRegion: text("venue_region"),
    venueCountry: text("venue_country"),
    /** Bandsintown event page or direct ticket URL. */
    ticketUrl: text("ticket_url"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("artist_events_key_id_uq").on(t.artistKey, t.eventId),
    index("artist_events_key_idx").on(t.artistKey),
    index("artist_events_datetime_idx").on(t.eventDatetime),
  ],
);

export type ArtistEvent = typeof artistEventsTable.$inferSelect;
export type InsertArtistEvent = typeof artistEventsTable.$inferInsert;

/**
 * Song Bottles — message-in-a-bottle annotations anchored to a recording MBID.
 *
 * A bottle is a short note (≤280 chars) left by a listener while a specific
 * recording is playing.  It travels with the MBID: any station that plays that
 * track delivers it to the next listeners.  `plays_remaining` starts at 3 and
 * decrements each time the MBID fires a new spin event; at 0 the body is
 * nulled and `body_archived_at` is set (the count row is kept for resonance
 * metrics).
 *
 * `handle` and `avatar` are snapshotted at write time so they survive even if
 * the listener's preferences change later.
 */
export const songBottlesTable = pgTable(
  "song_bottles",
  {
    id: serial("id").primaryKey(),
    /** FK to the recording this bottle is anchored to. */
    mbid: text("mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** Station the listener was on when they wrote the note. */
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id),
    /** The listener who wrote it. */
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    /** Deterministic handle derived from the listener's device key. */
    handle: text("handle").notNull(),
    /** Halloween emoji avatar char (snapshotted at write time). */
    avatar: text("avatar").notNull(),
    /**
     * The note body (≤280 chars).  Nulled when plays_remaining reaches 0
     * and body_archived_at is set.  Null rows are archived — the row stays
     * for resonance count purposes.
     */
    body: text("body"),
    /** Approximate playhead offset when the note was written (ms from start). */
    progressMs: integer("progress_ms"),
    /**
     * Decremented by 1 on each spin event for this MBID.  Starts at 3.
     * At 0, body is nulled and body_archived_at is set.
     */
    playsRemaining: integer("plays_remaining").notNull().default(3),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** Set (along with body←null) when plays_remaining hits 0. */
    bodyArchivedAt: timestamp("body_archived_at"),
  },
  (t) => [
    index("song_bottles_mbid_remaining_idx").on(
      t.mbid,
      t.playsRemaining,
      t.createdAt,
    ),
    index("song_bottles_user_mbid_idx").on(t.userId, t.mbid),
  ],
);

export type SongBottle = typeof songBottlesTable.$inferSelect;
export type InsertSongBottle = typeof songBottlesTable.$inferInsert;

export type InsertReplayResolutionJob =
  typeof replayResolutionJobsTable.$inferInsert;

export type InsertServiceTrackMap = typeof serviceTrackMapTable.$inferInsert;

export type ServiceTrackMap = typeof serviceTrackMapTable.$inferSelect;

/**
 * Durable facts about an in-page embed candidate.
 *
 * This is intentionally not part of service_track_map.  That table has one
 * general streaming link per service, while a recording may need Bandcamp for
 * provenance and YouTube (or another control-capable provider in a later
 * iteration) for playback control.
 */
export const embedLinkTable = pgTable(
  "embed_link",
  {
    id: serial("id").primaryKey(),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid),
    /** "bandcamp" | "youtube". */
    provider: text("provider").notNull(),
    /** "provenance" | "control". */
    role: text("role").notNull(),
    /** Resolution ladder rung: 1–4 playable, 5 link-out, 6 no result. */
    rung: integer("rung").notNull(),
    /**
     * "embedded" | "link_out" | "no_link" | "expired" |
     * "transient_failure".
     */
    outcome: text("outcome").notNull(),
    /** Chosen MusicBrainz release, when the provider result has one. */
    releaseMbid: text("release_mbid"),
    /** Provider-native release/album identifier, when available. */
    providerReleaseId: text("provider_release_id"),
    /** Provider-native track/video identifier, when available. */
    providerTrackId: text("provider_track_id"),
    /** The already-known provider URL; never fetched page content. */
    sourceUrl: text("source_url"),
    /** "mb-url-rel" | "page-extract" | "yt-search" | "cache". */
    resolvedVia: text("resolved_via").notNull(),
    /** "exact" | "gated" | "none". */
    confidence: text("confidence").notNull(),
    /** Machine-readable explanation of the decision or failure. */
    reason: text("reason").notNull(),
    /** Release chosen before a changed choice was recorded. */
    previousReleaseMbid: text("previous_release_mbid"),
    /** When a changed release choice was observed. */
    releaseChangedAt: timestamp("release_changed_at"),
    /** When this provider/role was last attempted. */
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    /** TTL boundary for both positive and negative provider-scoped results. */
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("embed_link_recording_provider_role_uq").on(
      t.recordingMbid,
      t.provider,
      t.role,
    ),
    index("embed_link_recording_idx").on(t.recordingMbid),
    index("embed_link_provider_role_idx").on(t.provider, t.role),
    index("embed_link_expiry_idx").on(t.expiresAt),
    index("embed_link_metrics_idx").on(
      t.provider,
      t.role,
      t.rung,
      t.outcome,
      t.fetchedAt,
    ),
    check("embed_link_rung_ck", sql`${t.rung} between 1 and 6`),
    check(
      "embed_link_provider_ck",
      sql`${t.provider} in ('bandcamp', 'youtube')`,
    ),
    check("embed_link_role_ck", sql`${t.role} in ('provenance', 'control')`),
    check(
      "embed_link_outcome_ck",
      sql`(
        (${t.outcome} = 'embedded' and ${t.rung} between 1 and 4) or
        (${t.outcome} = 'link_out' and ${t.rung} = 5) or
        (${t.outcome} = 'no_link' and ${t.rung} = 6) or
        (${t.outcome} = 'expired' and ${t.rung} between 1 and 5) or
        (${t.outcome} = 'transient_failure' and ${t.rung} between 1 and 6)
      )`,
    ),
  ],
);

/** Alias matching the plural domain wording used by callers. */
export const embedLinksTable = embedLinkTable;
export type EmbedLink = typeof embedLinkTable.$inferSelect;
export type InsertEmbedLink = typeof embedLinkTable.$inferInsert;

/**
 * Curated, durable commerce facts for a recording. These are written by
 * ingestion/resolution work, never guessed by a request handler.
 */
export const recordingSupportFactsTable = pgTable(
  "recording_support_facts",
  {
    id: serial("id").primaryKey(),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid, { onDelete: "cascade" }),
    /** "artist_direct" | "label" | "discogs". */
    kind: text("kind").notNull(),
    /** "release" | "catalog" | "door". */
    scope: text("scope").notNull().default("release"),
    providerId: text("provider_id"),
    releaseMbid: text("release_mbid"),
    releaseGroupMbid: text("release_group_mbid"),
    url: text("url").notNull(),
    detail: text("detail"),
    note: text("note"),
    /** "exact" | "trusted" — only these values are public. */
    verification: text("verification").notNull().default("trusted"),
    /** Citation for the fact; Discogs rows require this. */
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("recording_support_facts_recording_idx").on(t.recordingMbid),
    index("recording_support_facts_kind_idx").on(t.kind, t.recordingMbid),
    check(
      "recording_support_facts_kind_ck",
      sql`${t.kind} in ('artist_direct', 'label', 'discogs')`,
    ),
    check(
      "recording_support_facts_scope_ck",
      sql`${t.scope} in ('release', 'catalog', 'door')`,
    ),
    check(
      "recording_support_facts_verification_ck",
      sql`${t.verification} in ('exact', 'trusted')`,
    ),
  ],
);

export const supportFactsTable = recordingSupportFactsTable;
export type RecordingSupportFact = typeof recordingSupportFactsTable.$inferSelect;
export type InsertRecordingSupportFact =
  typeof recordingSupportFactsTable.$inferInsert;

/**
 * Listener intent to hold a recording until a particular Bandcamp Friday.
 * Separate from pending_keeps, whose lifecycle is unresolved radio spins.
 */
export const supportHoldsTable = pgTable(
  "support_holds",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid, { onDelete: "cascade" }),
    /** Canonical UTC date, YYYY-MM-DD, calculated server-side. */
    bandcampFridayDate: text("bandcamp_friday_date").notNull(),
    heldAt: timestamp("held_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("support_holds_user_recording_date_uq").on(
      t.userId,
      t.recordingMbid,
      t.bandcampFridayDate,
    ),
    index("support_holds_user_idx").on(t.userId),
    index("support_holds_recording_idx").on(t.recordingMbid),
  ],
);

export const bandcampSupportHoldsTable = supportHoldsTable;
export type SupportHold = typeof supportHoldsTable.$inferSelect;
export type InsertSupportHold = typeof supportHoldsTable.$inferInsert;

/**
 * Off-request provider work.  One row is one recording/provider/role demand;
 * the unique key makes ingest, first-play, and Keep safe to call repeatedly.
 */
export const embedResolutionQueueTable = pgTable(
  "embed_resolution_queue",
  {
    id: serial("id").primaryKey(),
    recordingMbid: text("recording_mbid")
      .notNull()
      .references(() => recordingsTable.mbid, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    role: text("role").notNull(),
    /** "pending" | "running" | "retry" | "done". */
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(50),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    lockedAt: timestamp("locked_at"),
    lastError: text("last_error"),
    /** Optional facts used only for aggregate coverage metrics. */
    stationId: integer("station_id").references(() => stationsTable.id, {
      onDelete: "set null",
    }),
    genreCluster: text("genre_cluster"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    metricRecordedAt: timestamp("metric_recorded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("embed_resolution_queue_identity_uq").on(
      t.recordingMbid,
      t.provider,
      t.role,
    ),
    index("embed_resolution_queue_claim_idx").on(
      t.status,
      t.nextAttemptAt,
      t.priority,
      t.id,
    ),
    index("embed_resolution_queue_recording_idx").on(t.recordingMbid),
  ],
);

export type EmbedResolutionQueueJob =
  typeof embedResolutionQueueTable.$inferSelect;
export type InsertEmbedResolutionQueueJob =
  typeof embedResolutionQueueTable.$inferInsert;

/** Aggregate-only embed coverage facts; provider content is never copied here. */
export const embedResolutionMetricsTable = pgTable(
  "embed_resolution_metrics",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id").references(() => stationsTable.id),
    genreCluster: text("genre_cluster"),
    weekStart: timestamp("week_start").notNull(),
    provider: text("provider").notNull(),
    role: text("role").notNull(),
    rung: integer("rung").notNull(),
    outcome: text("outcome").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("embed_resolution_metrics_identity_uq").on(
      t.stationId,
      t.genreCluster,
      t.weekStart,
      t.provider,
      t.role,
      t.rung,
      t.outcome,
    ),
    index("embed_resolution_metrics_week_idx").on(t.weekStart),
  ],
);

export type EmbedResolutionMetric =
  typeof embedResolutionMetricsTable.$inferSelect;

export type ReplayResolutionJob = typeof replayResolutionJobsTable.$inferSelect;

export interface ReplayResolutionFailure {
  position: number;
  spinId: number;
  error: string;
}

export interface ReplayMaterializationReceipt {
  position: number;
  spinId: number;
  mbid: string | null;
  title: string;
  artist: string;
  status: "accepted" | "missing" | "rejected";
  retryable: boolean;
  error?: string;
}

/**
 * User-triggered Ghost Replay playlist materialization. This is separate from
 * replay_resolution_jobs: resolution is reusable enrichment, while this row is
 * the immutable per-service playlist receipt.
 */
export const replayMaterializationJobsTable = pgTable(
  "replay_materialization_jobs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    replayId: integer("replay_id").notNull(),
    service: text("service").notNull(),
    status: text("status").notNull().default("pending"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    accepted: integer("accepted").notNull().default(0),
    missing: integer("missing").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    retryable: integer("retryable").notNull().default(0),
    name: text("name").notNull(),
    description: text("description").notNull(),
    playlistId: text("playlist_id"),
    playlistUrl: text("playlist_url"),
    error: text("error"),
    errorRetryable: boolean("error_retryable").notNull().default(false),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    receipt: jsonb("receipt").$type<ReplayMaterializationReceipt[]>(),
  },
  (t) => [
    index("replay_materialization_jobs_user_idx").on(t.userId, t.createdAt),
    index("replay_materialization_jobs_status_idx").on(t.status),
  ],
);

export type ReplayMaterializationJob =
  typeof replayMaterializationJobsTable.$inferSelect;
export type InsertReplayMaterializationJob =
  typeof replayMaterializationJobsTable.$inferInsert;

/**
 * User-triggered, resumable Ghost Replay resolution.  The replay manifest
 * remains a read model over spins; this job only writes service_track_map and
 * its own progress counters.
 */
export const replayResolutionJobsTable = pgTable(
  "replay_resolution_jobs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id),
    /** Canonical replay anchor (the minimum spin id for the run). */
    replayId: integer("replay_id").notNull(),
    /** "pending" | "running" | "done" | "done_with_errors" | "error". */
    status: text("status").notNull().default("pending"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    resolved: integer("resolved").notNull().default(0),
    missing: integer("missing").notNull().default(0),
    networkErrors: integer("network_errors").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    /** Next manifest position to process; an item is committed after its row. */
    committedOffset: integer("committed_offset").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    error: text("error"),
    failures: jsonb("failures").$type<ReplayResolutionFailure[]>(),
  },
  (t) => [
    index("replay_resolution_jobs_user_idx").on(t.userId, t.createdAt),
    index("replay_resolution_jobs_status_idx").on(t.status),
  ],
);

/**
 * A listener-imported portable set (XSPF/JSPF upload). Deliberately isolated
 * from witnessed radio history: no foreign key or write path touches `spins`,
 * shows, or any radio-derived analytics. Sets are user-owned personal
 * material and always carry an explicit `IMPORTED · <name>` citation.
 */
export const importedSetsTable = pgTable(
  "imported_sets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    /** Display name: the playlist title from the file, else the filename. */
    name: text("name").notNull(),
    /** Original upload filename, preserved for the citation receipt. */
    sourceFilename: text("source_filename").notNull(),
    /** Interchange format the file parsed as: "xspf" | "jspf". */
    format: text("format").notNull(),
    /** Total ordered slots parsed from the file (≤ 500). */
    trackCount: integer("track_count").notNull(),
    /** Entries resolved to a recording so far (progressive). */
    resolvedCount: integer("resolved_count").notNull().default(0),
    /** Entries that finished resolution without a match. */
    unresolvedCount: integer("unresolved_count").notNull().default(0),
    /** "resolving" while entries are pending, "done" when all are terminal. */
    status: text("status").notNull().default("resolving"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("imported_sets_user_idx").on(t.userId)],
);

export type ImportedSet = typeof importedSetsTable.$inferSelect;
export type InsertImportedSet = typeof importedSetsTable.$inferInsert;

/**
 * One ordered slot of an imported set. Parser facts (title/creator/album/
 * duration/claimed identifiers) are preserved verbatim; resolution is
 * progressive and honest — `resolutionBasis` records exactly which identifier
 * won ("lore_mbid" | "mbid" | "isrc" | "text" | "spotify"), and unresolved
 * slots stay visible with a reason instead of disappearing.
 *
 * `resolvedMbid` is intentionally a bare text column (no FK): imported
 * material must never gain a structural path into the radio spine tables.
 */
export const importedSetEntriesTable = pgTable(
  "imported_set_entries",
  {
    id: serial("id").primaryKey(),
    setId: integer("set_id")
      .notNull()
      .references(() => importedSetsTable.id, { onDelete: "cascade" }),
    /** 0-based position in the file's original order. */
    position: integer("position").notNull(),
    title: text("title"),
    creator: text("creator"),
    album: text("album"),
    durationMs: integer("duration_ms"),
    /** Recording MBID claimed by the file (never trusted blindly). */
    claimedMbid: text("claimed_mbid"),
    /** True when the claimed MBID came from Lore extension metadata. */
    claimedMbidFromLore: boolean("claimed_mbid_from_lore").notNull().default(false),
    /** ISRC claimed by the file, when present. */
    claimedIsrc: text("claimed_isrc"),
    /** "pending" | "resolved" | "unresolved". */
    resolutionStatus: text("resolution_status").notNull().default("pending"),
    /** Which identifier actually resolved this entry. Null until resolved. */
    resolutionBasis: text("resolution_basis"),
    /** The recording this entry resolved to. Plain text — deliberately no FK. */
    resolvedMbid: text("resolved_mbid"),
    /** Honest reason a slot stayed unresolved, e.g. "no_match" | "no_identifiers". */
    unresolvedReason: text("unresolved_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("imported_set_entries_set_position_uq").on(t.setId, t.position),
    index("imported_set_entries_set_idx").on(t.setId),
  ],
);

export type ImportedSetEntry = typeof importedSetEntriesTable.$inferSelect;
export type InsertImportedSetEntry = typeof importedSetEntriesTable.$inferInsert;

/**
 * Operator-level feature flags and settings that can be changed at runtime
 * without a server restart.  Each row is a single named boolean flag.
 * The primary key is the flag name so upserts are idempotent.
 */
export const loreSettingsTable = pgTable("lore_settings", {
  /** Setting name, e.g. "spotifyImportEnabled". */
  key: text("key").primaryKey(),
  /** Current value for boolean flags. */
  value: boolean("value").notNull(),
  /** Wall-clock time of the last write. */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LoreSetting = typeof loreSettingsTable.$inferSelect;

export type InsertLoreSetting = typeof loreSettingsTable.$inferInsert;

/**
 * Last-run timestamps for background jobs (e.g. the Pitchfork pass), so a
 * restart within the pass window skips an immediate re-run. The table is
 * created by an idempotent boot migration in api-server; it is declared here
 * so drizzle-kit push does not see it as an unknown table and try to drop it.
 */
/**
 * Permanent station removals (admin "Remove from Lore").
 *
 * Rows here are a tombstone ledger consulted by:
 *   • the Radio Browser discovery worker — an excluded radio_browser_uuid is
 *     never re-upserted/re-enrolled, no matter what quality filters say;
 *   • seedStations() — an excluded station_slug (curated seed stations) is
 *     skipped on boot so a removed seed station stays hidden+inactive.
 *
 * Un-removing deletes the exclusion row and, for curated stations, un-hides
 * and re-activates the retained stations row.
 * Created via an idempotent boot migration in api-server.
 */
export const stationExclusionsTable = pgTable("station_exclusions", {
  id: serial("id").primaryKey(),
  /** Radio Browser UUID — set for removed radio_browser stations. */
  radioBrowserUuid: text("radio_browser_uuid").unique(),
  /** Station slug — set for removed curated seed stations. */
  stationSlug: text("station_slug").unique(),
  /** Display name at removal time, for diagnostics. */
  stationName: text("station_name").notNull(),
  removedAt: timestamp("removed_at").defaultNow().notNull(),
});

export type StationExclusion = typeof stationExclusionsTable.$inferSelect;
export type InsertStationExclusion = typeof stationExclusionsTable.$inferInsert;

export const jobTimestampsTable = pgTable("job_timestamps", {
  /** Stable job identifier, e.g. 'pitchfork-pass'. */
  key: text("key").primaryKey(),
  /** When the job last started a full pass. */
  lastRanAt: timestamp("last_ran_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Per-station tallies for the rotating audio-fingerprint scout.
 *
 * The scout cycles through metadata-dark stations (all radio_browser rows
 * icy_unsupported), sampling ONE station per tick on a fixed budget and
 * recognizing the audio via AudD. These tallies persist the sample /
 * recognition counts so the admin scout report survives restarts; the
 * recognized tracks themselves are ordinary spins tagged source='audd_scout'.
 *
 * Created by an idempotent boot migration in api-server; declared here so
 * drizzle-kit push does not see it as an unknown table and try to drop it.
 */
export const fingerprintScoutTalliesTable = pgTable(
  "fingerprint_scout_tallies",
  {
    /** Canonical stations.id — one tally row per scouted station. */
    stationId: integer("station_id")
      .primaryKey()
      .references(() => stationsTable.id, { onDelete: "cascade" }),
    /** Total fingerprint samples attempted (including failed captures). */
    samples: integer("samples").notNull().default(0),
    /** Samples that AudD recognized as a track. */
    recognitions: integer("recognitions").notNull().default(0),
    /** When the scout last sampled this station. */
    lastSampledAt: timestamp("last_sampled_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

export type InsertFingerprintScoutTally =
  typeof fingerprintScoutTalliesTable.$inferInsert;

export type FingerprintScoutTally =
  typeof fingerprintScoutTalliesTable.$inferSelect;

/**
 * Source-coverage ledger: the persisted outcome of the most recent free
 * public-metadata probe per station (ICY / supported platform now-playing).
 * Written by the admin-triggered probe run (lore/source-probe.ts); read by
 * the source-coverage read model (lore/source-coverage.ts) to classify each
 * real roster station as healthy / recoverable / no_source / unavailable.
 * Declared here (not only in the boot migration) so drizzle-kit push does
 * not try to drop it.
 */
export const stationSourceProbesTable = pgTable(
  "station_source_probes",
  {
    /** Canonical stations.id — one probe ledger row per station. */
    stationId: integer("station_id")
      .primaryKey()
      .references(() => stationsTable.id, { onDelete: "cascade" }),
    /** What was probed: "icy" (raw stream metadata) or "radiojar". */
    probeKind: text("probe_kind").notNull(),
    /**
     * What the public metadata surface actually supplied:
     *   usable_pair     — a real artist AND title were published
     *   blank_metadata  — reachable, but empty / junk / show-only metadata
     *   unsupported     — the surface does not expose track metadata at all
     *   unreachable     — network/timeout/HTTP failure (may be transient)
     */
    outcome: text("outcome").notNull(),
    /** Human-readable detail (error message, what was observed). */
    detail: text("detail"),
    /** Direct stream URL after redirect resolution, when one was verified. */
    resolvedUrl: text("resolved_url"),
    /** The artist/title pair observed at probe time (evidence, not a spin). */
    sampleArtist: text("sample_artist"),
    sampleTitle: text("sample_title"),
    probedAt: timestamp("probed_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

export type InsertStationSourceProbe =
  typeof stationSourceProbesTable.$inferInsert;

export type StationSourceProbe =
  typeof stationSourceProbesTable.$inferSelect;

/**
 * Per-station/source runtime metadata-quality funnel. Unlike probe evidence,
 * this row is updated by normal polls and persistent watchers and therefore
 * separates source capability from current operational health.
 */
export const stationSourceQualityTable = pgTable(
  "station_source_quality",
  {
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    capability: text("capability").notNull(),
    lastOutcome: text("last_outcome").notNull(),
    lastDetail: text("last_detail"),
    lastAttemptAt: timestamp("last_attempt_at").notNull(),
    lastResponseAt: timestamp("last_response_at"),
    lastUsableAt: timestamp("last_usable_at"),
    lastUsableArtist: text("last_usable_artist"),
    lastUsableTitle: text("last_usable_title"),
    windowStartedAt: timestamp("window_started_at").notNull().defaultNow(),
    outcomeCounts: jsonb("outcome_counts")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.stationId, t.source],
      name: "station_source_quality_pkey",
    }),
    index("station_source_quality_attempt_idx").on(t.lastAttemptAt),
  ],
);

/**
 * Durable audit and progress ledger for station-published play-history
 * surfaces. This is separate from station_source_quality because a history
 * backfill is an operator job, not a live now-playing health signal.
 */
export const stationHistoryBackfillTable = pgTable(
  "station_history_backfill",
  {
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    family: text("family").notNull(),
    surface: text("surface").notNull(),
    cursorMode: text("cursor_mode").notNull(),
    supportsBackfill: boolean("supports_backfill").notNull().default(false),
    stableIdentity: text("stable_identity").notNull(),
    reportedTimestamp: text("reported_timestamp").notNull(),
    archiveCitation: text("archive_citation").notNull(),
    sourceUrl: text("source_url"),
    status: text("status").notNull().default("unverified"),
    supportedDepthDays: integer("supported_depth_days"),
    oldestPublishedAt: timestamp("oldest_published_at"),
    lastSuccessfulPage: integer("last_successful_page"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),
    lastSuccessAt: timestamp("last_success_at"),
    lastFailureAt: timestamp("last_failure_at"),
    lastFailureReason: text("last_failure_reason"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.stationId, t.source],
      name: "station_history_backfill_pkey",
    }),
    index("station_history_backfill_status_idx").on(t.status),
  ],
);

export type StationHistoryBackfill =
  typeof stationHistoryBackfillTable.$inferSelect;
export type InsertStationHistoryBackfill =
  typeof stationHistoryBackfillTable.$inferInsert;

/**
 * Per-spin evidence linking a recovered row back to the station's published
 * history surface. It is separate from `spins.citation`, which is retained for
 * the older admin manual-entry contract.
 */
export const spinSourceProvenanceTable = pgTable(
  "spin_source_provenance",
  {
    spinId: integer("spin_id")
      .primaryKey()
      .references(() => spinsTable.id, { onDelete: "cascade" }),
    stationId: integer("station_id")
      .notNull()
      .references(() => stationsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    family: text("family").notNull(),
    sourceUrl: text("source_url").notNull(),
    archiveUrl: text("archive_url"),
    externalId: text("external_id"),
    reportedPlayedAt: timestamp("reported_played_at"),
    ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
  },
  (t) => [
    index("spin_source_provenance_station_idx").on(t.stationId, t.reportedPlayedAt),
    index("spin_source_provenance_source_idx").on(t.source, t.externalId),
  ],
);

export type SpinSourceProvenance = typeof spinSourceProvenanceTable.$inferSelect;
export type InsertSpinSourceProvenance =
  typeof spinSourceProvenanceTable.$inferInsert;
/**
 * Private Apple Music listening rooms.  The snapshot is deliberately a
 * server-owned read model: Apple user tokens never enter this table and the
 * record helper only ever submits transient audio for identification.
 */
export interface AppleJamQueueEntry {
  mbid?: string | null;
  title: string;
  artist: string;
  artworkUrl?: string | null;
  appleMusicId?: string | null;
  isrc?: string | null;
  durationMs?: number | null;
}

export interface AppleJamTransport {
  state: "idle" | "playing" | "paused" | "ended";
  index: number;
  positionMs: number;
  effectiveAt: string | null;
  track: AppleJamQueueEntry | null;
}

export interface AppleJamSnapshot {
  mode: "queue" | "record";
  queue: AppleJamQueueEntry[];
  transport: AppleJamTransport;
  source: {
    status: "idle" | "capturing" | "identifying" | "matched" | "offline" | "unavailable";
    message: string | null;
    matchedAt: string | null;
    confidence: number | null;
    track: AppleJamQueueEntry | null;
  };
}

export const appleMusicJamsTable = pgTable(
  "apple_music_jams",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    inviteToken: text("invite_token").notNull().unique(),
    hostUserId: integer("host_user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    revision: integer("revision").notNull().default(0),
    snapshot: jsonb("snapshot").$type<AppleJamSnapshot>().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("apple_music_jams_host_idx").on(t.hostUserId),
    index("apple_music_jams_expiry_idx").on(t.expiresAt),
  ],
);

export type AppleMusicJam = typeof appleMusicJamsTable.$inferSelect;
export type InsertAppleMusicJam = typeof appleMusicJamsTable.$inferInsert;

export const appleMusicJamMembersTable = pgTable(
  "apple_music_jam_members",
  {
    id: serial("id").primaryKey(),
    jamId: integer("jam_id")
      .notNull()
      .references(() => appleMusicJamsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => loreUsersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("listener"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("apple_music_jam_members_jam_user_idx").on(t.jamId, t.userId),
    index("apple_music_jam_members_jam_idx").on(t.jamId),
  ],
);

export type AppleMusicJamMember = typeof appleMusicJamMembersTable.$inferSelect;

export const appleMusicJamEventsTable = pgTable(
  "apple_music_jam_events",
  {
    id: serial("id").primaryKey(),
    jamId: integer("jam_id")
      .notNull()
      .references(() => appleMusicJamsTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<AppleJamSnapshot>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("apple_music_jam_events_jam_revision_idx").on(t.jamId, t.revision),
    index("apple_music_jam_events_jam_id_idx").on(t.jamId, t.id),
  ],
);

export type AppleMusicJamEvent = typeof appleMusicJamEventsTable.$inferSelect;

export const appleMusicJamHelpersTable = pgTable(
  "apple_music_jam_helpers",
  {
    id: serial("id").primaryKey(),
    jamId: integer("jam_id")
      .notNull()
      .references(() => appleMusicJamsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("apple_music_jam_helpers_jam_idx").on(t.jamId)],
);

export type AppleMusicJamHelper = typeof appleMusicJamHelpersTable.$inferSelect;

export type InsertStationSourceQuality =
  typeof stationSourceQualityTable.$inferInsert;

export type StationSourceQuality =
  typeof stationSourceQualityTable.$inferSelect;
