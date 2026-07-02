import {
  pgTable,
  pgView,
  serial,
  text,
  integer,
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
  /** The station's own sanctioned live stream URL, played unmodified. */
  streamUrl: text("stream_url").notNull(),
  /** Human quality badge, e.g. "320kbps AAC", "FLAC", "160kbps AAC". */
  streamQuality: text("stream_quality"),
  /** Playback hint for the client: "aac" | "mp3" | "hls" | "flac". */
  streamFormat: text("stream_format").notNull().default("aac"),
  /** Playback mode; "live" for continuous radio. */
  mode: text("mode").notNull().default("live"),
  homepageUrl: text("homepage_url"),
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
  /** Whether attribution (station/show/DJ links) must be shown. Always true. */
  attribution: boolean("attribution").notNull().default(true),
  /** Display order in the directory (lower first). */
  sortOrder: integer("sort_order").notNull().default(0),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Show = typeof showsTable.$inferSelect;
export type InsertShow = typeof showsTable.$inferInsert;

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
