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
} from "drizzle-orm/pg-core";

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
   * When genre/year enrichment was last attempted for this recording (set
   * regardless of whether MusicBrainz/Last.fm actually returned data). Null
   * means never attempted — the backfill target set. This is distinct from
   * `genres`/`releaseYear` being null, which can be a legitimate "looked it
   * up, nothing there" result and must not be retried forever.
   */
  genreEnrichedAt: timestamp("genre_enriched_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  logoUrl: text("logo_url"),
  /** Now-playing adapter key, e.g. "radio_paradise" | "kexp" | "bbc". */
  nowPlayingSource: text("now_playing_source"),
  /**
   * Per-source config: channel/service id, published now-playing endpoint URL +
   * parser mapping (source="station_page"), and the per-station Spinitron API
   * key (source="spinitron"). Never contains secrets meant to be public.
   */
  nowPlayingConfig: jsonb("now_playing_config").$type<Record<string, unknown>>(),
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
    /** When this row was (re)written by the schedule scraper. */
    scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("spins_mbid_played_at_idx").on(t.mbid, t.playedAt),
    index("spins_station_played_at_idx").on(t.stationId, t.playedAt),
    // Idempotent ingest: a given source play id is logged once per station.
    // Null externalIds are distinct in Postgres, so change-detection sources are
    // unaffected.
    uniqueIndex("spins_station_external_idx").on(t.stationId, t.externalId),
  ],
);

export type Spin = typeof spinsTable.$inferSelect;
export type InsertSpin = typeof spinsTable.$inferInsert;

/**
 * Local resolution cache for the shared `resolveToMbid` path. Keyed on a
 * normalized `artist\u001ftitle` digest (Unit Separator, not NUL — Postgres
 * rejects NUL in text), it caches BOTH hits (mbid set) and
 * misses (mbid null) so a track that never resolves isn't re-queried against
 * MusicBrainz on every spin — the single most important lever for staying under
 * the 1 req/sec MusicBrainz budget while ingesting continuously.
 */
export const resolutionCacheTable = pgTable("resolution_cache", {
  id: serial("id").primaryKey(),
  /** Normalized `artist\u001ftitle` digest (lowercased, punctuation-stripped). */
  key: text("key").notNull().unique(),
  /** Resolved MBID, or null for a cached miss. */
  mbid: text("mbid"),
  /** Confidence tier of the cached resolution: "isrc" | "text" | "unresolved". */
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
export type InsertSpotifyConnection = typeof spotifyConnectionsTable.$inferInsert;

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
 *  - We never store the verbatim Genius annotation text. Only the `fragment`
 *    (the lyric snippet the annotation is anchored to) is kept so the admin can
 *    find the matching lyric line; the full annotation is always read on Genius.
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
    /**
     * The lyric fragment text from Genius (the highlighted snippet the
     * annotation is attached to). Stored for admin review context only;
     * never surfaced verbatim as a claim.
     */
    fragment: text("fragment").notNull(),
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
 * A Lore listener identity. Lore has no traditional accounts; a user row is
 * bootstrapped the first time a listener connects Spotify for playback and is
 * keyed by their Spotify user id. The `spotifyConnectionId` FK points at their
 * current `spotify_connections` session so `getUserFromSession` can resolve
 * user identity from the `lore_sid` cookie without a separate id token.
 */
export const loreUsersTable = pgTable("lore_users", {
  id: serial("id").primaryKey(),
  /** Spotify canonical user id — the upsert key. */
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  /** FK to the most-recent spotify_connections row for this listener. */
  spotifyConnectionId: text("spotify_connection_id").references(
    () => spotifyConnectionsTable.sid,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  ],
);

export type ServiceConnection = typeof serviceConnectionsTable.$inferSelect;
export type InsertServiceConnection =
  typeof serviceConnectionsTable.$inferInsert;

export interface LibraryItemProvenance {
  kind: "keep" | "import";
  service?: string;
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
    provenance: jsonb("provenance")
      .$type<LibraryItemProvenance>()
      .notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
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
});

export type LibraryImportJob = typeof libraryImportJobsTable.$inferSelect;
export type InsertLibraryImportJob = typeof libraryImportJobsTable.$inferInsert;

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
  (t) => [
    uniqueIndex("keep_targets_user_service_idx").on(t.userId, t.service),
  ],
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
    uniqueIndex("lists_source_title_year_idx").on(
      t.sourceId,
      t.title,
      t.year,
    ),
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
  },
  (t) => [
    uniqueIndex("list_entries_list_rg_idx").on(t.listId, t.releaseGroupMbid),
    index("list_entries_rg_idx").on(t.releaseGroupMbid),
  ],
);

export type ListEntry = typeof listEntriesTable.$inferSelect;
export type InsertListEntry = typeof listEntriesTable.$inferInsert;

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
   * Whether the stream URL returned ICY now-playing headers.
   * "yes" = station is Lore-compatible; "no" = stream exists but no metadata;
   * "unknown" = stream URL untested or timed out.
   */
  icyStatus: text("icy_status").notNull().default("unknown"),
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
