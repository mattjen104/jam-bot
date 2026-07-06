import { db, stationsTable, type InsertStation } from "@workspace/db";
import { sql } from "drizzle-orm";
import { upsertPicker } from "./picks.js";

/**
 * Curated seed of high-quality, real radio stations. A smaller reliable set
 * beats a large flaky one: every stream URL and now-playing feed here was
 * verified live. Each station plays its own sanctioned stream, unmodified, and
 * carries homepage + donate links because attribution is non-negotiable.
 */
const SEED_STATIONS: InsertStation[] = [
  {
    slug: "radio-paradise-main",
    name: "Radio Paradise — Main Mix",
    org: "Radio Paradise",
    country: "US",
    streamUrl: "https://stream.radioparadise.com/aac-320",
    streamQuality: "320kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://radioparadise.com",
    donateUrl: "https://radioparadise.com/support",
    nowPlayingSource: "radio_paradise",
    nowPlayingConfig: { chan: "0" },
    stationClass: "curated",
    sortOrder: 10,
  },
  {
    slug: "radio-paradise-mellow",
    name: "Radio Paradise — Mellow Mix",
    org: "Radio Paradise",
    country: "US",
    streamUrl: "https://stream.radioparadise.com/mellow-320",
    streamQuality: "320kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://radioparadise.com",
    donateUrl: "https://radioparadise.com/support",
    nowPlayingSource: "radio_paradise",
    nowPlayingConfig: { chan: "1" },
    stationClass: "curated",
    sortOrder: 20,
  },
  {
    slug: "radio-paradise-rock",
    name: "Radio Paradise — Rock Mix",
    org: "Radio Paradise",
    country: "US",
    streamUrl: "https://stream.radioparadise.com/rock-320",
    streamQuality: "320kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://radioparadise.com",
    donateUrl: "https://radioparadise.com/support",
    nowPlayingSource: "radio_paradise",
    nowPlayingConfig: { chan: "2" },
    stationClass: "curated",
    sortOrder: 30,
  },
  {
    slug: "radio-paradise-world",
    name: "Radio Paradise — World/Etc Mix",
    org: "Radio Paradise",
    country: "US",
    streamUrl: "https://stream.radioparadise.com/world-etc-320",
    streamQuality: "320kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://radioparadise.com",
    donateUrl: "https://radioparadise.com/support",
    nowPlayingSource: "radio_paradise",
    nowPlayingConfig: { chan: "3" },
    stationClass: "curated",
    sortOrder: 35,
  },
  {
    slug: "kexp",
    name: "KEXP 90.3 FM",
    org: "KEXP",
    country: "US",
    streamUrl: "https://kexp.streamguys1.com/kexp160.aac",
    streamQuality: "160kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://kexp.org",
    donateUrl: "https://www.kexp.org/donate/",
    nowPlayingSource: "kexp_api",
    nowPlayingConfig: {},
    stationClass: "community",
    sortOrder: 40,
  },
  {
    slug: "kcrw-eclectic24",
    name: "KCRW — Eclectic 24",
    org: "KCRW",
    country: "US",
    streamUrl: "https://streams.kcrw.com/e24_mp3",
    streamQuality: "128kbps MP3",
    streamFormat: "mp3",
    homepageUrl: "https://www.kcrw.com/music/shows/eclectic24",
    donateUrl: "https://join.kcrw.com",
    nowPlayingSource: "kcrw",
    nowPlayingConfig: { feed: "Music" },
    stationClass: "community",
    sortOrder: 50,
  },
  // NTS Radio (London) — streams confirmed reachable (302 redirect). NTS live
  // API publishes show-level metadata only; per-track data comes from the
  // existing NTS archive poller.
  ...ntsliveStations(),
  // BBC 6 Music — metadata arrives via the existing bbc_api adapter (confirmed
  // live). Stream URL returns 400 from the Replit container (geo-block), so
  // streamUrl is empty; the player falls back gracefully while metadata still
  // ingests via the BBC segments API.
  {
    slug: "bbc-6music",
    name: "BBC 6 Music",
    org: "BBC",
    country: "GB",
    // Geo-blocked from the Replit container (returns 400). Leave empty so the
    // player degrades gracefully; metadata still flows via bbc_api.
    streamUrl: "",
    streamQuality: "128kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://www.bbc.co.uk/6music",
    donateUrl: null,
    nowPlayingSource: "bbc_api",
    nowPlayingConfig: { sid: "bbc_6music" },
    stationClass: "community",
    sortOrder: 57,
  },
  // FIP bouquet (Radio France) — all Icecast URLs confirmed 200. livemeta API
  // confirmed live for IDs 7, 64, 65, 66, 69, 71, 74 (78/Metal API 404s but
  // the stream is reachable; adapter returns null gracefully during talk/gaps).
  ...fipStations(),
  ...somaFmStations(),
  ...spinitronCollegeStations(),
];

/**
 * NTS Radio (London) — two channels, each a continuous 24/7 stream of
 * curated, genre-fluid programming. The NTS live API publishes show-level
 * attribution (show title + host); per-track tracklists come from the
 * existing NTS archive poller (Zakia, Floating Points, etc.). Stream URLs
 * return 302 redirects from the Replit container, which is normal for audio
 * streams behind a geo-load-balancer — confirmed reachable.
 */
function ntsliveStations(): InsertStation[] {
  return [
    {
      slug: "nts-1",
      name: "NTS 1",
      org: "NTS",
      country: "GB",
      streamUrl: "https://stream-relay-geo.ntslive.net/stream",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.nts.live",
      donateUrl: "https://www.nts.live/membership",
      nowPlayingSource: "nts_live",
      nowPlayingConfig: { channel: "1" },
      stationClass: "community",
      sortOrder: 55,
    },
    {
      slug: "nts-2",
      name: "NTS 2",
      org: "NTS",
      country: "GB",
      streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.nts.live",
      donateUrl: "https://www.nts.live/membership",
      nowPlayingSource: "nts_live",
      nowPlayingConfig: { channel: "2" },
      stationClass: "community",
      sortOrder: 56,
    },
  ];
}

/**
 * FIP bouquet (Radio France) — FIP Main plus seven thematic sub-stations,
 * all streaming at 192 kbps AAC from Icecast. Stream URLs and livemeta API
 * confirmed reachable from the Replit container. The livemeta API for
 * station 78 (Metal) 404s, so the fip adapter returns null gracefully during
 * Metal polls — the stream still plays, metadata flows when available.
 */
function fipStations(): InsertStation[] {
  const stations: Array<{
    slug: string;
    name: string;
    stationId: string;
    streamSlug: string;
    sortOrder: number;
  }> = [
    { slug: "fip-main", name: "FIP", stationId: "7", streamSlug: "fip", sortOrder: 200 },
    { slug: "fip-rock", name: "FIP Rock", stationId: "64", streamSlug: "fiprock", sortOrder: 210 },
    { slug: "fip-jazz", name: "FIP Jazz", stationId: "65", streamSlug: "fipjazz", sortOrder: 220 },
    { slug: "fip-groove", name: "FIP Groove", stationId: "66", streamSlug: "fipgroove", sortOrder: 230 },
    { slug: "fip-world", name: "FIP World", stationId: "69", streamSlug: "fipworld", sortOrder: 240 },
    { slug: "fip-reggae", name: "FIP Reggae", stationId: "71", streamSlug: "fipreggae", sortOrder: 250 },
    { slug: "fip-electro", name: "FIP Electro", stationId: "74", streamSlug: "fipelectro", sortOrder: 260 },
    // Stream confirmed 200; livemeta API (id=78) 404s — adapter returns null gracefully.
    { slug: "fip-metal", name: "FIP Metal", stationId: "78", streamSlug: "fipmetal", sortOrder: 270 },
  ];
  return stations.map(({ slug, name, stationId, streamSlug, sortOrder }) => ({
    slug,
    name,
    org: "Radio France",
    country: "FR",
    streamUrl: `https://icecast.radiofrance.fr/${streamSlug}-hifi.aac`,
    streamQuality: "192kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://www.radiofrance.fr/fip",
    donateUrl: null,
    nowPlayingSource: "fip",
    nowPlayingConfig: { stationId },
    stationClass: "curated",
    sortOrder,
  }));
}

/**
 * SomaFM's channel bouquet — one listener-supported org, many hand-programmed
 * channels, one recent-songs feed shape. Streams and feeds were each verified
 * live before enrolling. 256kbps streams exist only for the flagship channels;
 * the rest ship SomaFM's standard 128kbps MP3.
 */
function somaFmStations(): InsertStation[] {
  const channels: Array<{
    channel: string;
    title: string;
    hi?: boolean;
  }> = [
    { channel: "groovesalad", title: "Groove Salad", hi: true },
    { channel: "dronezone", title: "Drone Zone", hi: true },
    { channel: "deepspaceone", title: "Deep Space One" },
    { channel: "spacestation", title: "Space Station Soma" },
    { channel: "lush", title: "Lush" },
    { channel: "indiepop", title: "Indie Pop Rocks!" },
    { channel: "secretagent", title: "Secret Agent" },
    { channel: "thetrip", title: "The Trip" },
    { channel: "sonicuniverse", title: "Sonic Universe" },
    { channel: "bootliquor", title: "Boot Liquor" },
    { channel: "thistle", title: "ThistleRadio" },
    { channel: "folkfwd", title: "Folk Forward" },
    { channel: "fluid", title: "Fluid" },
    { channel: "suburbsofgoa", title: "Suburbs of Goa" },
    { channel: "poptron", title: "PopTron" },
  ];
  return channels.map(({ channel, title, hi }, i) => ({
    slug: `somafm-${channel}`,
    name: `SomaFM — ${title}`,
    org: "SomaFM",
    country: "US",
    streamUrl: hi
      ? `https://ice1.somafm.com/${channel}-256-mp3`
      : `https://ice1.somafm.com/${channel}-128-mp3`,
    streamQuality: hi ? "256kbps MP3" : "128kbps MP3",
    streamFormat: "mp3",
    homepageUrl: `https://somafm.com/${channel}/`,
    donateUrl: "https://somafm.com/support/",
    nowPlayingSource: "somafm",
    nowPlayingConfig: { channel },
    stationClass: "curated",
    sortOrder: 100 + i * 10,
  }));
}

/**
 * Curated college and community radio stations sourced from Spinitron.
 *
 * These are stream-first: users tune in live just like KEXP or Radio Paradise.
 * Spinitron history (DJ-attributed spin logs) enriches the track knowledge graph
 * and will power ghost-radio / pick-riding in a future phase.
 *
 * API KEYS — each station issues its own Spinitron access token.
 * To activate now-playing metadata for a station, set the corresponding secret:
 *
 *   SPINITRON_KEY_WPRB  — https://wprb.com      (music director)
 *   SPINITRON_KEY_WNUR  — https://wnur.northwestern.edu
 *   SPINITRON_KEY_WREK  — https://wrek.org
 *   SPINITRON_KEY_KDVS  — https://kdvs.org
 *   SPINITRON_KEY_WHRB  — https://whrb.org
 *   SPINITRON_KEY_WKCR  — https://wkcr.org
 *   SPINITRON_KEY_WFMU  — https://wfmu.org
 *   SPINITRON_KEY_WXYC  — https://wxyc.org
 *   SPINITRON_KEY_KALX  — https://kalx.berkeley.edu
 *   SPINITRON_KEY_KVRX  — https://kvrx.org
 *   SPINITRON_KEY_WMBR  — https://wmbr.org
 *   SPINITRON_KEY_WUSB  — https://wusb.fm
 *   SPINITRON_KEY_WUOG  — https://wuog.org
 *   SPINITRON_KEY_WVUM  — https://wvum.org
 *   SPINITRON_KEY_KVSC  — https://www.kvsc.org
 *
 * Without a key the station appears on the dial but shows no now-playing data
 * (the Spinitron adapter returns [] gracefully when apiKey is absent).
 *
 * STREAM URLS — all stream directly to the user's browser (Audio element).
 * Icecast streams on port 8000 are not reachable from the Replit container
 * (outbound port 8000 is blocked) but are publicly accessible from browsers.
 * Three stations use CDN-hosted HTTPS streams confirmed reachable from here:
 * WPRB (streamguys1), WKCR (streamguys1), KALX (berkeley.edu:8443).
 */
function spinitronCollegeStations(): InsertStation[] {
  const spinConfig = (callsign: string): Record<string, string> => {
    const key = process.env[`SPINITRON_KEY_${callsign}`];
    return key ? { apiKey: key } : {};
  };

  return [
    // ── WEDGE CORE ─────────────────────────────────────────────────────────
    // Heavy / jazz / experimental programming; the algorithmic blind-spot.

    {
      slug: "wprb",
      name: "WPRB 103.3 FM",
      org: "Princeton University",
      country: "US",
      // CDN stream confirmed reachable (200) from the Replit container.
      streamUrl: "https://wprb.streamguys1.com/live",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wprb.com",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WPRB"),
      stationClass: "community",
      sortOrder: 300,
    },
    {
      slug: "wnur",
      name: "WNUR 89.3 FM",
      org: "Northwestern University",
      country: "US",
      // RevMA CDN HTTPS stream confirmed reachable (200 audio/mpeg) from the
      // Replit container. URL sourced from their AudioIgniter playlist config.
      streamUrl: "https://stream.rcs.revma.com/w4pmmfkdx4zuv",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wnur.northwestern.edu",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WNUR"),
      stationClass: "community",
      sortOrder: 310,
    },
    {
      slug: "wrek",
      name: "WREK 91.1 FM",
      org: "Georgia Institute of Technology",
      country: "US",
      // Only HTTP port-8000 stream confirmed (streaming.wrek.org:8000). No HTTPS
      // CDN endpoint found after exhaustive search. Kept empty — mixed-content
      // blocked in HTTPS apps.
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wrek.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WREK"),
      stationClass: "community",
      sortOrder: 320,
    },
    {
      slug: "kdvs",
      name: "KDVS 90.3 FM",
      org: "UC Davis",
      country: "US",
      // HTTPS stream confirmed reachable (200 audio/aac) from the Replit container.
      // /listen redirects to /stream; using /stream directly to avoid extra hop.
      streamUrl: "https://listen.kdvs.org/stream",
      streamQuality: "128kbps AAC",
      streamFormat: "aac",
      homepageUrl: "https://kdvs.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("KDVS"),
      stationClass: "community",
      sortOrder: 330,
    },
    {
      slug: "whrb",
      name: "WHRB 95.3 FM",
      org: "Harvard University",
      country: "US",
      // HTTPS stream confirmed reachable (200 audio/mpeg) from the Replit container.
      // URL sourced from their homepage embedded player.
      streamUrl: "https://stream.whrb.org/whrb-mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://whrb.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WHRB"),
      stationClass: "community",
      sortOrder: 340,
    },
    {
      slug: "wkcr",
      name: "WKCR 89.9 FM",
      org: "Columbia University",
      country: "US",
      // CDN stream confirmed reachable (200) from the Replit container.
      streamUrl: "https://wkcr.streamguys1.com/live",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wkcr.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WKCR"),
      stationClass: "community",
      sortOrder: 350,
    },

    // ── FREEFORM GREATS ────────────────────────────────────────────────────
    // Revered, broad, tastemaker credibility.

    {
      slug: "wfmu",
      name: "WFMU 91.1 FM",
      org: "WFMU",
      country: "US",
      // CDN stream confirmed reachable (200) from the Replit container.
      streamUrl: "https://stream0.wfmu.org/freeform-128k",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wfmu.org",
      donateUrl: "https://www.wfmu.org/donate.html",
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WFMU"),
      stationClass: "community",
      sortOrder: 400,
    },
    {
      slug: "wxyc",
      name: "WXYC 89.3 FM",
      org: "UNC Chapel Hill",
      country: "US",
      // HTTPS ibiblio.org CDN stream confirmed reachable (200 audio/mpeg) from the
      // Replit container. URL found in their homepage HTML.
      streamUrl: "https://audio-mp3.ibiblio.org/wxyc.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wxyc.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WXYC"),
      stationClass: "community",
      sortOrder: 410,
    },
    {
      slug: "kalx",
      name: "KALX 90.7 FM",
      org: "UC Berkeley",
      country: "US",
      // HTTPS stream on port 8443 confirmed reachable (200) from the Replit container.
      streamUrl: "https://stream.kalx.berkeley.edu:8443/kalx-128.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://kalx.berkeley.edu",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("KALX"),
      stationClass: "community",
      sortOrder: 420,
    },
    {
      slug: "kvrx",
      name: "KVRX 91.7 FM",
      org: "UT Austin",
      country: "US",
      // HTTPS redirect endpoint confirmed browser-safe: 302 → https://streams.kut.org/5020_192.mp3
      // (DAS/KUT CDN, audio/mpeg, CORS: *). <audio> follows redirects transparently.
      // URL sourced from the Radio Browser directory; served from their own domain.
      streamUrl: "https://kvrx.org/now_playing/stream",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://kvrx.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("KVRX"),
      stationClass: "community",
      sortOrder: 430,
    },

    // ── STRONG ADDITIONS ───────────────────────────────────────────────────
    // Music-serious college radio, all on Spinitron.

    {
      slug: "wmbr",
      name: "WMBR 88.1 FM",
      org: "MIT",
      country: "US",
      // HTTPS stream on port 8002 confirmed reachable (200 audio/mpeg) from the
      // Replit container. Direct link from their /www/listen page; HTTP port 8002
      // is refused — TLS only.
      streamUrl: "https://wmbr.org:8002/hi",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wmbr.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WMBR"),
      stationClass: "community",
      sortOrder: 500,
    },
    {
      slug: "wusb",
      name: "WUSB 90.1 FM",
      org: "Stony Brook University",
      country: "US",
      // HTTPS stream on port 8092 confirmed reachable (200 audio/mpeg) from the
      // Replit container. URL found on their homepage listen widget.
      streamUrl: "https://stream.wusb.stonybrook.edu:8092/listen.pl",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wusb.fm",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WUSB"),
      stationClass: "community",
      sortOrder: 510,
    },
    {
      slug: "wuog",
      name: "WUOG 90.5 FM",
      org: "University of Georgia",
      country: "US",
      // Only HTTP port-8000 stream found (stream.wuog.org:8000/stream, referenced
      // on their live-stream page). No HTTPS CDN endpoint found. Kept empty —
      // mixed-content blocked in HTTPS apps.
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wuog.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WUOG"),
      stationClass: "community",
      sortOrder: 520,
    },
    {
      slug: "wvum",
      name: "WVUM 90.5 FM",
      org: "University of Miami",
      country: "US",
      // No direct audio stream found. Their listen page embeds a Twitch stream
      // (wvumfm), which cannot be used as an Audio src. Kept empty.
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wvum.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("WVUM"),
      stationClass: "community",
      sortOrder: 530,
    },
    {
      slug: "kvsc",
      name: "KVSC 88.1 FM",
      org: "St. Cloud State University",
      country: "US",
      // HTTPS stream on port 443 confirmed reachable (200 audio/mpeg) from the
      // Replit container. URL sourced from their jPlayer config on the listen page.
      streamUrl: "https://corn.kvsc.org:443/broadband",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.kvsc.org",
      donateUrl: null,
      nowPlayingSource: "spinitron",
      nowPlayingConfig: spinConfig("KVSC"),
      stationClass: "community",
      sortOrder: 540,
    },
  ];
}

/**
 * Upsert the curated stations by slug. Idempotent — safe to run on every boot.
 * Updates mutable fields (stream URL/quality, links, now-playing config) so a
 * fix in the seed propagates without a migration, but never clobbers the id so
 * existing spins keep pointing at the same station.
 */
export async function seedStations(): Promise<void> {
  for (const s of SEED_STATIONS) {
    await db
      .insert(stationsTable)
      .values(s)
      .onConflictDoUpdate({
        target: stationsTable.slug,
        set: {
          name: s.name,
          org: s.org ?? null,
          country: s.country ?? null,
          streamUrl: s.streamUrl,
          streamQuality: s.streamQuality ?? null,
          streamFormat: s.streamFormat ?? "aac",
          homepageUrl: s.homepageUrl ?? null,
          donateUrl: s.donateUrl ?? null,
          nowPlayingSource: s.nowPlayingSource ?? null,
          nowPlayingConfig: s.nowPlayingConfig ?? null,
          stationClass: s.stationClass ?? "curated",
          sortOrder: s.sortOrder ?? 0,
          updatedAt: sql`now()`,
        },
      });
  }
}

/**
 * Wedge labels — the trusted independent rosters whose catalogues are exactly
 * the obscure music radio never touches. We register each as a `label` picker
 * (the taste-source registry) with its verified home page; we deliberately do
 * NOT hardcode MusicBrainz label MBIDs (an inaccurate MBID would poison the
 * spine — "never fabricate"). Catalogue ingest is admin-triggered via
 * POST /admin/labels with a verified MBID, which reuses the same picker by
 * handle. Idempotent — safe on every boot.
 */
const SEED_LABEL_PICKERS = [
  {
    handle: "rise-above-records",
    name: "Rise Above Records",
    homeUrl: "https://riseaboverecords.com",
  },
  {
    handle: "relapse-records",
    name: "Relapse Records",
    homeUrl: "https://www.relapse.com",
  },
  {
    handle: "sacred-bones-records",
    name: "Sacred Bones Records",
    homeUrl: "https://sacredbonesrecords.com",
  },
  {
    handle: "thrill-jockey",
    name: "Thrill Jockey",
    homeUrl: "https://www.thrilljockey.com",
  },
  {
    handle: "rvng-intl",
    name: "RVNG Intl.",
    homeUrl: "https://rvngintl.com",
  },
  {
    handle: "sargent-house",
    name: "Sargent House",
    homeUrl: "https://sargenthouse.com",
  },
  {
    handle: "profound-lore-records",
    name: "Profound Lore Records",
    homeUrl: "https://profoundlorerecords.com",
  },
  {
    handle: "southern-lord",
    name: "Southern Lord",
    homeUrl: "https://southernlord.com",
  },
] as const;

/**
 * Wedge blog pickers — long-running music blogs with public RSS feeds. Seeded
 * with their feed URL in `sourceRef` so the blog poller can ride them; ingest is
 * best-effort and conservative (only confidently-parsed "Artist – Track" posts
 * become picks, feed body text is never stored). A feed that moves or 404s just
 * logs and is skipped, so a stale URL never harms boot or the spine.
 */
const SEED_BLOG_PICKERS = [
  {
    handle: "stereogum",
    name: "Stereogum",
    homeUrl: "https://www.stereogum.com",
    feedUrl: "https://www.stereogum.com/feed/",
  },
  {
    handle: "gorilla-vs-bear",
    name: "Gorilla vs. Bear",
    homeUrl: "https://www.gorillavsbear.net",
    feedUrl: "https://www.gorillavsbear.net/feed/",
  },
  {
    handle: "brooklyn-vegan",
    name: "BrooklynVegan",
    homeUrl: "https://www.brooklynvegan.com",
    feedUrl: "https://www.brooklynvegan.com/feed/",
  },
] as const;

/**
 * NTS archive curator pickers — long-running NTS resident shows whose full,
 * dated episode archives NTS publishes through its own public API. Each show
 * becomes a `curator` picker with its show alias in `sourceRef`, so the NTS
 * poller can walk the archive backwards, a few episodes at a time. Both
 * aliases verified live against the NTS API.
 */
const SEED_NTS_PICKERS = [
  {
    handle: "nts-questing-w-zakia",
    name: "Questing w/ Zakia",
    homeUrl: "https://www.nts.live/shows/questing-w-zakia",
    ntsShowAlias: "questing-w-zakia",
    description:
      "Zakia Sewell's spiritual jazz, folk and soul odyssey on NTS — every archived episode is a dated, ordered run of picks.",
  },
  {
    handle: "nts-floating-points",
    name: "Floating Points (NTS)",
    homeUrl: "https://www.nts.live/shows/floating-points",
    ntsShowAlias: "floating-points",
    description:
      "Sam Shepherd's NTS residency — deep crate-digging across jazz, electronics and beyond, archived as ordered tracklists.",
  },
] as const;

/**
 * Register the wedge label pickers. Best-effort — a failure here logs but never
 * takes boot down (and needs no network: it only writes the registry rows).
 */
export async function seedPickers(): Promise<void> {
  for (const l of SEED_LABEL_PICKERS) {
    try {
      await upsertPicker({
        pickerType: "label",
        name: l.name,
        handle: l.handle,
        homeUrl: l.homeUrl,
        trustTier: 1,
        description: `Rideable roster — releases on ${l.name}. Catalogue ingest pending a verified MusicBrainz MBID.`,
      });
    } catch (err) {
      console.error("[lore] seedPickers failed for", l.handle, err);
    }
  }
  for (const b of SEED_BLOG_PICKERS) {
    try {
      await upsertPicker({
        pickerType: "blog",
        name: b.name,
        handle: b.handle,
        homeUrl: b.homeUrl,
        trustTier: 2,
        sourceRef: { feedUrl: b.feedUrl },
        description: `Championed on ${b.name} — tracks it writes up become rideable picks.`,
      });
    } catch (err) {
      console.error("[lore] seedPickers failed for", b.handle, err);
    }
  }
  for (const n of SEED_NTS_PICKERS) {
    try {
      await upsertPicker({
        pickerType: "curator",
        name: n.name,
        handle: n.handle,
        homeUrl: n.homeUrl,
        trustTier: 2,
        sourceRef: { ntsShowAlias: n.ntsShowAlias },
        description: n.description,
      });
    } catch (err) {
      console.error("[lore] seedPickers failed for", n.handle, err);
    }
  }
}
