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
