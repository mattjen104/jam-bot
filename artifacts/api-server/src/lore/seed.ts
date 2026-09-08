import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  pickersTable,
  picksTable,
  showsTable,
  listSourcesTable,
  listsTable,
  listEntriesTable,
  stationExclusionsTable,
  type InsertStation,
} from "@workspace/db";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { upsertPicker } from "./picks.js";
import { inferTimezone } from "./timezone.js";
import { coarseUsCityLocation } from "./station-location.js";

/**
 * Curated seed of high-quality, real radio stations. A smaller reliable set
 * beats a large flaky one: every stream URL and now-playing feed here was
 * verified live. Each station plays its own sanctioned stream, unmodified, and
 * carries homepage + donate links because attribution is non-negotiable.
 */
/**
 * Callsigns confirmed to be hosted on spinitron.com and to publish actual
 * `spin-item` rows (curl batch against `https://spinitron.com/<CALLSIGN>`).
 * `spinSource()` only ever emits the `spinitron_web` scrape source for
 * callsigns in this set — a scrape of a callsign NOT on Spinitron 404s on
 * every poll and silently produces zero spins forever. A reachable station
 * page with only empty playlists does not qualify either.
 */
export const SPINITRON_CALLSIGNS: ReadonlySet<string> = new Set([
  "WPRB",
  "KDVS",
  "WHRB",
  "WKCR",
  "KALX",
  "WUOG",
  "KVSC",
  "WMFO",
  "WBRS",
  "WZBC",
  "WTBU",
  "KSJS",
  "KXLU",
  "WLUW",
  "WPKN",
]);

export function spinitronWebSourceForCallsign(
  callsign: string,
): "spinitron_web" | null {
  return SPINITRON_CALLSIGNS.has(callsign.toUpperCase())
    ? "spinitron_web"
    : null;
}

/**
 * A college tag is only emitted from affiliation text supplied by the curated
 * roster, never from the callsign. This intentionally favors misses for
 * abbreviated organizations (for operator review) over speculative tagging.
 */
function collegeTagFromAffiliation(org: string | null | undefined): string[] | null {
  return org && /\b(university|college|universit[éèêäàá]|universidad|universidade)\b/i.test(org)
    ? ["college"]
    : null;
}

/** User-reviewed additions to the listener-facing Core station category. */
export const CORE_RADIO_ADDITION_SLUGS = [
  "wfmu",
  "fip-main",
  "kcrw-eclectic24",
  "wwoz",
  "kutx",
  "bbc-6music",
  "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631",
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
] as const;

export const SEED_STATIONS: InsertStation[] = [
  {
    slug: "kexp",
    tags: ["anchor"],
    name: "KEXP 90.3 FM",
    org: "KEXP",
    country: "US",
    city: "Seattle",
    region: "WA",
    streamUrl: "https://kexp.streamguys1.com/kexp160.aac",
    streamQuality: "160kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://kexp.org",
    scheduleUrl: "https://kexp.org/schedule/",
    donateUrl: "https://www.kexp.org/donate/",
    nowPlayingSource: "kexp_api",
    nowPlayingConfig: {},
    stationClass: "community",
    sortOrder: 40,
  },
  {
    slug: "wwoz",
    tags: ["anchor"],
    name: "WWOZ 90.7 FM",
    org: "WWOZ",
    city: "New Orleans",
    region: "LA",
    country: "US",
    streamUrl: "https://www.wwoz.org/listen/hi",
    streamQuality: "128kbps MP3",
    streamFormat: "mp3",
    homepageUrl: "https://www.wwoz.org/",
    scheduleUrl: "https://www.wwoz.org/calendar/weekly",
    donateUrl: "https://www.wwoz.org/donate",
    // The verified stream is playable, but no sanctioned track-level source
    // has been confirmed. Keep Core playback honest rather than parsing show
    // labels as artist/title metadata.
    nowPlayingSource: "radio_browser_icy",
    nowPlayingConfig: { streamUrl: "https://www.wwoz.org/listen/hi" },
    source: "curated",
    tier: "longtail",
    stationClass: "community",
    automationClass: "human",
    sortOrder: 41,
  },
  {
    slug: "kutx",
    tags: ["anchor"],
    name: "KUTX 98.9 FM",
    org: "KUTX",
    city: "Austin",
    region: "TX",
    country: "US",
    streamUrl: "https://streams.kut.org/4428_56?aw_0_1st.playerid=kutx-web",
    streamQuality: "56kbps AAC+",
    streamFormat: "aac",
    homepageUrl: "https://kutx.org/",
    scheduleUrl: "https://kutx.org/schedule/",
    donateUrl: "https://support.kut.org/",
    nowPlayingSource: "radio_browser_icy",
    nowPlayingConfig: { streamUrl: "https://streams.kut.org/4428_56?aw_0_1st.playerid=kutx-web" },
    source: "curated",
    tier: "longtail",
    stationClass: "community",
    automationClass: "human",
    sortOrder: 42,
  },
  {
    slug: "kcrw-eclectic24",
    tags: ["public"],
    name: "KCRW — Eclectic 24",
    org: "KCRW",
    country: "US",
    city: "Los Angeles",
    region: "CA",
    streamUrl: "https://streams.kcrw.com/e24_mp3",
    streamQuality: "128kbps MP3",
    streamFormat: "mp3",
    homepageUrl: "https://www.kcrw.com/music/shows/eclectic24",
    scheduleUrl: "https://www.kcrw.com/schedule",
    donateUrl: "https://join.kcrw.com",
    nowPlayingSource: "kcrw",
    nowPlayingConfig: { feed: "Music" },
    stationClass: "community",
    sortOrder: 50,
  },
  // NTS Radio (London) — ICY streams expose per-track metadata behind a
  // redirecting CDN. The radio_browser_icy adapter merges programme attribution
  // from the NTS Live API and falls back to it if the stream is unavailable.
  ...ntsliveStations(),
  // BBC 6 Music — metadata arrives via the existing bbc_api adapter (confirmed
  // live). Stream URL returns 400 from the Replit container (geo-block), so
  // streamUrl is empty; the player falls back gracefully while metadata still
  // ingests via the BBC segments API.
  {
    slug: "bbc-6music",
    tags: ["anchor"],
    name: "BBC 6 Music",
    org: "BBC",
    country: "GB",
    // Geo-blocked from the Replit container (returns 400). Leave empty so the
    // player degrades gracefully; metadata still flows via bbc_api.
    streamUrl: "",
    streamQuality: "128kbps AAC",
    streamFormat: "aac",
    homepageUrl: "https://www.bbc.co.uk/6music",
    scheduleUrl: "https://www.bbc.co.uk/6music/schedule",
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
  ...spinitronCollegeStations(),
  ...nprListStations(),
  ...indieInternetStations(),
  ...criShortlistStations(),
  ...specialistAdditions(),
  ...canadianCampusStations(),
  ...spinitronJazzStations(),
  ...spinitronCanadianAdditions(),
];

const VERIFIED_SCHEDULE_SOURCE_REPAIRS = [
  {
    slug: "kzsu",
    homepageUrl: "https://kzsu.stanford.edu/",
    scheduleUrl: "https://kzsu.stanford.edu/schedule/",
  },
  {
    slug: "witr",
    homepageUrl: "https://witr.rit.edu/",
    scheduleUrl: "https://witr.rit.edu/schedule",
  },
] as const;

/**
 * The final four stations from NPR's "streaming alternatives" list.
 *
 * KCHUNG and Radio AlHara keep the `rb-<radio-browser-uuid>` slugs from their
 * original radio-browser auto-enrollment (the UUID is radio-browser's global
 * stationuuid, so the slug is deterministic across environments) — existing
 * spins stay attached while the seed pins the verified stream + now-playing
 * config over whatever stale data auto-enrollment left behind:
 *
 *  - KCHUNG moved hosting to Radiocult; the old kchungradio.org:8000 stream is
 *    dead, the Radiocult stream carries ICY track metadata (confirmed live).
 *  - Radio AlHara and Lookout.FM are Radiojar stations: the audio stream hides
 *    behind per-request tokenized 302 redirects the raw-TCP ICY fetcher can't
 *    follow, so they poll Radiojar's public now-playing JSON API instead
 *    (`radiojar` adapter, config `{streamId}`). The stored stream URL
 *    `https://stream.radiojar.com/<id>` is for browser playback only.
 *  - Radio Nopal is a plain Icecast/ICY stream (channel A of two; the
 *    Ventana channel is intentionally not enrolled).
 *
 * All four are `source: "curated"` (exempt from the radio-browser whitelist
 * purge) and `tier: "longtail"`. The ICY-polled pair also get a
 * radio_browser_stations health row via `ensureIcyHealthRows()` after upsert.
 */
/**
 * Curated indie/experimental internet-first stations known for published DJ
 * scheduling — added specifically to populate the Featured tab. Stream URLs
 * are left empty where not yet verified from the Replit container (mixed-
 * content / CDN token issues); the schedule scraper only needs `homepageUrl`.
 *
 * Spinitron is not available for these stations; nowPlayingSource is omitted
 * (null) until a compatible adapter is confirmed. Stations still appear on the
 * dial and in Featured once the homepage scraper sets `homepageBlurb` and the
 * schedule scraper finds ≥1 show.
 */
function indieInternetStations(): InsertStation[] {
  return [
    // ByteFM — Hamburg-based German music broadcaster. Keep the official
    // 192k stream as the canonical Lore identity; the separate HH-UKW Radio
    // Browser row is a lower-quality regional alias and is quarantined by
    // applyLocalRosterRepair without touching any history it may acquire.
    {
      slug: "bytefm-192k",
      tags: ["anchor"],
      name: "ByteFM",
      org: "ByteFM",
      country: "DE",
      city: "Hamburg",
      streamUrl: "https://bytefm.cast.addradio.de/bytefm/main/high/stream",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.byte.fm/",
      scheduleUrl: "https://www.byte.fm/programm",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://bytefm.cast.addradio.de/bytefm/main/high/stream",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      sortOrder: 555,
    },
    // Dublab — LA-based non-profit internet radio, launched 1999. Weekly
    // show schedule published at dublab.com/schedule.
    // Stream: Airtime Pro's direct TLS Icecast mount (explicit port 8000).
    // Verified with GET + Icy-MetaData:1 on 2026-08-19; the default-port URL
    // was intermittently unreachable while this direct mount kept answering.
    // ICY health row: synthetic UUID "manual-dublab" (not in radio-browser).
    {
      slug: "dublab",
      tags: ["anchor"],
      name: "Dublab",
      org: "Dublab",
      country: "US",
      city: "Los Angeles",
      region: "CA",
      streamUrl: "https://dublab.out.airtime.pro:8000/dublab_a",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://dublab.com",
      scheduleUrl: "https://dublab.com/schedule",
      donateUrl: "https://dublab.com/membership/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://dublab.out.airtime.pro:8000/dublab_a",
      },
      stationClass: "community",
      sortOrder: 560,
    },
    // Rinse FM — London-based station, seminal for grime, garage, UKB and
    // forward club sounds. Weekly schedule at rinse.fm/schedule.
    // Stream: the current official Rinse UK player mount, re-verified with
    // GET + Icy-MetaData:1 on 2026-08-19 (128kbps AAC+). It currently emits
    // only a placeholder StreamTitle, so the coverage ledger honestly marks
    // it no_source rather than unavailable until real track metadata returns.
    // ICY health row: synthetic UUID "manual-rinse-fm". The stream is AAC+
    // via an HE-AAC container; if ICY is unsupported the adapter degrades
    // to icy_unsupported gracefully and the stream still plays in-browser.
    {
      slug: "rinse-fm",
      tags: ["anchor"],
      name: "Rinse FM",
      org: "Rinse FM",
      country: "GB",
      streamUrl: "https://admin.stream.rinse.fm/proxy/rinse_uk/stream",
      streamQuality: "128kbps AAC+",
      streamFormat: "aac",
      homepageUrl: "https://rinse.fm",
      scheduleUrl: "https://rinse.fm/schedule",
      // Independent/commercial — not a donate but a paid membership tier
      // ("Rinse Plus"). Model is subscription, not tax-deductible donation.
      // Spot-check: confirm /membership is still the active sign-up path.
      donateUrl: "https://rinse.fm/membership",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://admin.stream.rinse.fm/proxy/rinse_uk/stream",
      },
      stationClass: "community",
      sortOrder: 565,
    },
    // Worldwide FM — London/global; Gilles Peterson's curation-led station.
    // Detailed weekly schedule published at worldwidefm.net.
    // Stream: Radiocult Icecast confirmed 200 from the Replit container.
    // ICY health row: synthetic UUID "manual-worldwide-fm".
    {
      slug: "worldwide-fm",
      tags: ["indie"],
      name: "Worldwide FM",
      org: "Worldwide FM",
      country: "GB",
      streamUrl: "https://worldwide-fm.radiocult.fm/stream",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://worldwidefm.net",
      scheduleUrl: "https://worldwidefm.net/schedule",
      // Independent — Patreon membership, not a tax-deductible donation.
      // Spot-check: Worldwide FM has also used /membership on their own domain;
      // confirm which is current and whether the Patreon is still active.
      donateUrl: "https://www.patreon.com/worldwidefm",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://worldwide-fm.radiocult.fm/stream",
      },
      stationClass: "community",
      sortOrder: 570,
    },
    // The Lot Radio — Red Hook, Brooklyn all-DJ station; publishes a full
    // weekly lineup at thelotradio.com.
    // Stream: Livepeer HLS confirmed by radio-browser (no ICY-capable MP3
    // stream found — their infrastructure is HLS-only via livepeercdn.studio).
    // nowPlayingSource is null; the HLS URL is browser-playable but carries
    // no ICY metadata the server can poll.
    {
      slug: "the-lot-radio",
      tags: ["indie"],
      name: "The Lot Radio",
      org: "The Lot Radio",
      country: "US",
      streamUrl:
        "https://livepeercdn.studio/hls/85c28sa2o8wppm58/index.m3u8",
      streamQuality: "AAC",
      streamFormat: "hls",
      homepageUrl: "https://www.thelotradio.com",
      scheduleUrl: "https://www.thelotradio.com/schedule",
      // Independent non-profit; Red Hook Brooklyn. Community-supported model.
      // Spot-check: they've used both their own /support page and Open Collective.
      donateUrl: "https://www.thelotradio.com/support",
      nowPlayingSource: "lot_radio_schedule",
      nowPlayingConfig: {},
      stationClass: "community",
      sortOrder: 575,
    },
    // Refuge Worldwide — Berlin non-profit community radio; full weekly
    // schedule published at refugeworldwide.com.
    // Stream: radio.co confirmed 200/audio-mpeg from the Replit container.
    // ICY health row: synthetic UUID "manual-refuge-worldwide".
    // radio.co ICY metadata carries show-level titles ("show (r) - host");
    // the ICY adapter parses them on a best-effort basis.
    {
      slug: "refuge-worldwide",
      tags: ["indie"],
      name: "Refuge Worldwide",
      org: "Refuge Worldwide",
      country: "DE",
      streamUrl: "https://streaming.radio.co/s3699c5e49/listen",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://refugeworldwide.com",
      scheduleUrl: "https://refugeworldwide.com/schedule",
      donateUrl: "https://refugeworldwide.com/support",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://streaming.radio.co/s3699c5e49/listen",
      },
      stationClass: "community",
      sortOrder: 580,
    },
    // Balamii — South London community station. Its former Airtime Pro audio
    // host and the official site's matching /api/live-info host both stopped
    // resolving by 2026-08-19. Retire the dead URL from playback/polling while
    // retaining it as provenance in config. The source-probe migration seeds
    // the verified unreachable outcome so a clean deployment reports this as
    // unavailable. Mixcloud archives are not a live public audio mount.
    {
      slug: "balamii",
      tags: ["indie"],
      name: "Balamii",
      org: "Balamii",
      country: "GB",
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://balamii.com",
      scheduleUrl: "https://balamii.com/schedule",
      donateUrl: null,
      nowPlayingSource: null,
      nowPlayingConfig: {
        knownUnavailable: true,
        retiredStreamUrl: "https://balamii.out.airtime.pro/balamii_a",
      },
      stationClass: "community",
      sortOrder: 585,
    },
  ];
}

/**
 * Hand-reviewed Community Radio Index shortlist.
 *
 * Editorial source: https://www.community-radio-index.com/
 * Verified: 2026-09-01
 *
 * Each approved station was identity-checked against its CRI page and official
 * homepage, then matched to Radio Browser only to resolve the exact direct
 * stream. A live GET with `Icy-MetaData: 1` confirmed HTTPS playback, codec,
 * bitrate, `icy-metaint`, and a non-empty StreamTitle on the stored URL. These
 * are deliberately seed-owned curated rows rather than a bulk CRI/Radio Browser
 * import, so the reviewed roster is reproducible and exempt from directory
 * purges.
 *
 * Reviewed but rejected:
 *  - 8ballradio — https://www.community-radio-index.com/stations/8ballradio
 *    Audio was healthy, but the metadata block was only `StreamTitle=' - '`.
 *  - boxoutfm — https://www.community-radio-index.com/stations/boxoutfm
 *    No direct, identity-matched Radio Browser stream was available to verify.
 *  - cashmere-radio —
 *    https://www.community-radio-index.com/stations/cashmere-radio
 *    The live metadata identified only the station/archive programme, not
 *    useful current music (`Cashmere Radio - Cashmere Radio Archive`).
 */
export const CRI_SHORTLIST_SLUGS = [
  "kiosk-radio",
  "lahmacun-radio",
  "oroko-radio",
  "lyl-radio",
] as const;

function criShortlistStations(): InsertStation[] {
  return [
    {
      // CRI: https://www.community-radio-index.com/stations/kiosk-radio
      // RB UUID bae70c5c-9f3f-42fc-a83d-6c13920590e0.
      // Probe: 192kbps AAC; StreamTitle included the current programme.
      slug: "kiosk-radio",
      name: "Kiosk Radio",
      org: "Kiosk Radio",
      city: "Brussels",
      country: "BE",
      streamUrl: "https://kioskradiobxl.out.airtime.pro/kioskradiobxl_b",
      streamQuality: "192kbps AAC",
      streamFormat: "aac",
      homepageUrl: "https://www.kioskradio.com/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://kioskradiobxl.out.airtime.pro/kioskradiobxl_b",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      automationClass: "human",
      tags: ["electronic", "experimental", "club"],
      favorite: true,
      sortOrder: 590,
    },
    {
      // CRI: https://www.community-radio-index.com/stations/lahmacun-radio
      // RB UUID 93d9e19c-c8ce-487e-a57b-a3b62fc922f9.
      // Probe: 128kbps MP3; StreamTitle included the current programme.
      slug: "lahmacun-radio",
      name: "Lahmacun Radio",
      org: "Lahmacun Radio",
      city: "Budapest",
      country: "HU",
      streamUrl:
        "https://streaming.lahmacun.hu/listen/lahmacun_radio/radio.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://lahmacun.hu/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl:
          "https://streaming.lahmacun.hu/listen/lahmacun_radio/radio.mp3",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      automationClass: "human",
      tags: ["electronic", "experimental", "world"],
      favorite: true,
      sortOrder: 591,
    },
    {
      // CRI: https://www.community-radio-index.com/stations/oroko-radio
      // RB UUID 7babd377-ed7c-4a63-9778-47b0fd94983b.
      // Probe: 320kbps MP3; StreamTitle included the current programme.
      slug: "oroko-radio",
      name: "Oroko Radio",
      org: "Oroko Radio",
      city: "Accra",
      country: "GH",
      streamUrl: "https://oroko-radio.radiocult.fm/stream",
      streamQuality: "320kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.oroko.live/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://oroko-radio.radiocult.fm/stream",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      automationClass: "human",
      tags: ["world", "electronic", "club"],
      favorite: true,
      sortOrder: 592,
    },
    {
      // CRI: https://www.community-radio-index.com/stations/lyl-radio
      // RB UUID e11c170a-474f-11e9-aa55-52543be04c81.
      // Probe: 192kbps MP3; StreamTitle included the current programme.
      slug: "lyl-radio",
      name: "LYL Radio",
      org: "LYL Radio",
      city: "Lyon",
      country: "FR",
      streamUrl: "https://icecast.lyl.live/live",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://lyl.live/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: "https://icecast.lyl.live/live" },
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      automationClass: "human",
      tags: ["experimental", "ambient"],
      favorite: true,
      sortOrder: 593,
    },
  ];
}

/**
 * Six curated Canadian campus stations.
 *
 * CFUV, CJSR, and CKUT use `radio_browser_icy` with persistent watcher sockets
 * (`favorite: true`) — their DAS/Icecast streams carry inline ICY metadata that
 * the watcher reads (confirmed live). Radio Browser UUIDs match `ICY_HEALTH_SEEDS`
 * so `ensureIcyHealthRows()` links a health row and patches `radioBrowserId`.
 *
 * CKCU is on Spinitron (spinitron.com/CKCU) — upgraded from the former
 * `nowPlayingSource: null` state (ICY StreamTitle was permanently null) to use
 * the `spinSource` helper so attribution flows via Spinitron instead of ICY.
 *
 * CHMR and CISM have ICY streams with permanently null StreamTitle — their
 * broadcast automation systems never populate the ICY metadata field.
 * Thorough investigation (2026-07) found no publicly accessible now-playing API
 * for either station (see per-station comments). Their `nowPlayingSource` is
 * null and they are omitted from `ICY_HEALTH_SEEDS`. They are hidden from the
 * dial until a working now-playing source is identified and configured.
 */
export const SPECIALIST_RADIO_SLUGS = [
  "kiosk-radio", "lahmacun-radio", "oroko-radio", "lyl-radio",
  "8ball-radio", "boxout-fm", "cashmere-radio",
  "somafm-cliqhop", "somafm-lush", "somafm-sonicuniverse",
  "somafm-suburbsofgoa", "kexp",
  "nightride-chillsynth",
  "dublab", "rinse-fm", "worldwide-fm", "refuge-worldwide",
  "the-lot-radio", "radio-nopal", "nts-1", "nts-2",
] as const;

/** Net-new Specialist rows. Existing cohort members are promoted in place. */
function specialistAdditions(): InsertStation[] {
  const soma: Array<[string, string, string, string, string[]]> = [
    ["somafm-cliqhop", "SomaFM — CliqHop IDM", "cliqhop", "https://ice2.somafm.com/cliqhop-128-mp3", ["idm", "experimental"]],
    ["somafm-lush", "SomaFM — Lush", "lush", "https://ice1.somafm.com/lush-128-mp3", ["dream pop", "electronic"]],
    ["somafm-sonicuniverse", "SomaFM — Sonic Universe", "sonicuniverse", "https://ice1.somafm.com/sonicuniverse-128-mp3", ["jazz", "avant-garde"]],
    ["somafm-suburbsofgoa", "SomaFM — Suburbs of Goa", "suburbsofgoa", "https://ice1.somafm.com/suburbsofgoa-128-mp3", ["world", "electronic"]],
  ];
  return [
    {
      slug: "8ball-radio", name: "8Ball Radio", org: "8 Ball Community",
      city: "New York", country: "US", streamUrl: "https://8ballradio.nyc/",
      region: "NY",
      streamQuality: "Official browser player", streamFormat: "hls",
      homepageUrl: "https://8ballradio.nyc/", scheduleUrl: "https://8ballradio.nyc/",
      donateUrl: "https://8ballradio.nyc/", nowPlayingSource: null,
      nowPlayingConfig: { playbackOnly: true }, source: "curated", tier: "longtail",
      stationClass: "community", automationClass: "human",
      tags: ["specialist", "experimental", "community"], favorite: true, sortOrder: 594,
    },
    {
      slug: "boxout-fm", name: "Boxout FM", org: "Boxout FM",
      city: "New Delhi", country: "IN", streamUrl: "https://boxout.fm/radio",
      streamQuality: "Official browser player", streamFormat: "hls",
      homepageUrl: "https://boxout.fm/", scheduleUrl: "https://boxout.fm/radio",
      donateUrl: null, nowPlayingSource: null,
      nowPlayingConfig: { playbackOnly: true }, source: "curated", tier: "longtail",
      stationClass: "community", automationClass: "human",
      tags: ["specialist", "electronic", "hip-hop", "world"], favorite: true, sortOrder: 595,
    },
    {
      slug: "cashmere-radio", name: "Cashmere Radio", org: "Cashmere Radio e.V.",
      city: "Berlin", country: "DE",
      streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
      streamQuality: "192kbps MP3", streamFormat: "mp3",
      homepageUrl: "https://cashmereradio.com/", scheduleUrl: "https://cashmereradio.com/",
      donateUrl: "https://spenden.twingle.de/cashmere-radio-e-v/cashmere-radio-e-v/tw5d9bb6d582cf7/page",
      nowPlayingSource: null,
      nowPlayingConfig: { playbackOnly: true, metadataLimitation: "programme-label-only" },
      source: "curated", tier: "longtail", stationClass: "community",
      automationClass: "human", tags: ["specialist", "experimental", "avant-garde"],
      favorite: true, sortOrder: 596,
    },
    {
      // Official Nightride navigation labels Chillsynth "Chillsynth /
      // Chillwave / Instrumental". The station-owned Icecast status surface
      // publishes a 320kbps MP3 mount plus a real artist-title pair. Verified
      // 2026-09-03; the audit still requires track-level LRCLIB corroboration.
      slug: "nightride-chillsynth",
      name: "Nightride FM — Chillsynth",
      org: "Nightride FM",
      country: "US",
      streamUrl: "https://stream.nightride.fm/chillsynth.mp3",
      streamQuality: "320kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://nightride.fm/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://stream.nightride.fm/chillsynth.mp3",
        instrumentalClaim: true,
        evidenceUrl: "https://nightride.fm/",
        evidenceNote: "Official channel label: Chillsynth / Chillwave / Instrumental",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "curated",
      automationClass: "automated",
      tags: ["specialist", "instrumental", "electronic", "chillsynth"],
      favorite: true,
      hidden: false,
      sortOrder: 597,
    },
    ...soma.map(([slug, name, channel, streamUrl, tags], index): InsertStation => ({
      slug, name, org: "SomaFM", country: "US", streamUrl,
      streamQuality: "128kbps MP3", streamFormat: "mp3",
      homepageUrl: `https://somafm.com/${channel}/`,
      scheduleUrl: `https://somafm.com/${channel}/played`,
      donateUrl: "https://somafm.com/support/",
      nowPlayingSource: "somafm", nowPlayingConfig: { channel },
      source: "curated", tier: "longtail", stationClass: "curated",
      automationClass: "automated", tags: ["specialist", ...tags],
      favorite: true, hidden: false, sortOrder: 598 + index,
    })),
  ];
}

function canadianCampusStations(): InsertStation[] {
  return [
    {
      slug: "cfuv",
      name: "CFUV 101.9 FM",
      org: "University of Victoria",
      country: "CA",
      // DAS (Digital Audio Services) stream — confirmed ICY (icy-metaint:16000).
      // cfuv.streamon.fm redirects here; using the resolved URL so the ICY
      // watcher (raw TCP, no redirect support) can connect directly.
      streamUrl: "http://ais-sa1.streamon.fm/7132_64k.aac",
      streamQuality: "64kbps AAC",
      streamFormat: "aac",
      homepageUrl: "https://cfuv.uvic.ca",
      donateUrl: "https://cfuv.uvic.ca/support/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: "http://ais-sa1.streamon.fm/7132_64k.aac" },
      source: "curated",
      stationClass: "community",
      tags: ["college"],
      favorite: true,
      sortOrder: 900,
    },
    {
      slug: "chmr",
      name: "CHMR 93.5 FM",
      org: "Memorial University of Newfoundland",
      country: "CA",
      // Icecast 2.4.4 stream — confirmed 200 + ICY headers, but StreamTitle
      // is permanently null (stream_start July 2025, "Currently playing" field
      // empty in status-json.xsl). The broadcast automation system does not
      // populate ICY metadata, so radio_browser_icy will never produce spins.
      //
      // Investigation (2026-07): No publicly accessible now-playing API found.
      //   • chmr.ca — Weebly site, no now-playing endpoint or widget.
      //   • Centova Cast 3.2.15 at 192.99.14.49:2199 — requires authentication;
      //     no public song endpoint accessible without credentials.
      //   • StatsRadio API (api.statsradio.com) — CHMR slug invalid (404).
      //   • TuneIn guide_id s24751 — show-level subtext only, no track data.
      //
      // nowPlayingSource is null (and hidden=true) until a working source is
      // confirmed. Restore procedure when a source becomes available:
      //   1. PATCH /api/admin/stations/:id/now-playing-source
      //      { nowPlayingSource, nowPlayingConfig }
      //   2. PATCH /api/admin/stations/:id/flags  { hidden: false }
      // Both the blocklist-hide migration and this seed upsert are no-ops once
      // nowPlayingSource is non-null, so the restore survives server restarts.
      streamUrl: "http://192.99.14.49:9005/live128",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.chmr.ca",
      nowPlayingSource: null,
      nowPlayingConfig: {},
      source: "curated",
      stationClass: "community",
      tags: ["college"],
      favorite: true,
      hidden: true,
      sortOrder: 901,
    },
    {
      slug: "cism",
      name: "CISM 89.3 FM",
      org: "Université de Montréal",
      country: "CA",
      // Icecast (Liquidsoap) stream at ustream.ca — must include port 8000;
      // the default-port URL (port 80) returns 400 Bad Request from Icecast.
      // StreamTitle is permanently null — 20+ listeners but ICY metadata field
      // is empty; the broadcast automation does not populate it.
      //
      // Investigation (2026-07): No publicly accessible now-playing API found.
      //   • cism893.ca — Nuxt 3 SSR app; nowplaying Pinia store fetches from
      //     admin.cism893.ca, which redirects to a Filament admin panel
      //     (authentication required). All /api/* routes return 404.
      //   • cism.umontreal.ca — redirects to cism893.ca (BigIP 301).
      //   • StatsRadio API — CISM slug returns NO_PLAYING_SONG (not a valid
      //     registered station; the slug match is unvalidated).
      //   • TuneIn guide_id s24807 — show-level subtext only, no track data.
      //
      // nowPlayingSource is null (and hidden=true) until a working source is
      // confirmed. Restore procedure when a source becomes available:
      //   1. PATCH /api/admin/stations/:id/now-playing-source
      //      { nowPlayingSource, nowPlayingConfig }
      //   2. PATCH /api/admin/stations/:id/flags  { hidden: false }
      // Both the blocklist-hide migration and this seed upsert are no-ops once
      // nowPlayingSource is non-null, so the restore survives server restarts.
      streamUrl: "http://stream03.ustream.ca:8000/cism128.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://cism.umontreal.ca",
      nowPlayingSource: null,
      nowPlayingConfig: {},
      source: "curated",
      stationClass: "community",
      tags: ["college"],
      favorite: true,
      hidden: true,
      sortOrder: 902,
    },
    {
      slug: "cjsr",
      name: "CJSR 88.5 FM",
      org: "University of Alberta",
      country: "CA",
      // DAS stream — confirmed ICY (icy-metaint:16000) with cdnstream1.com
      // metadata service; StreamTitle is populated during music programming.
      // cjsr.streamon.fm redirects here; using the resolved URL directly.
      streamUrl: "http://ais-sa1.streamon.fm/7093_24k.aac",
      streamQuality: "24kbps AAC",
      streamFormat: "aac",
      homepageUrl: "https://www.cjsr.com",
      donateUrl: "https://www.cjsr.com/donate/",
      scheduleUrl: "https://www.cjsr.com/schedule/",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: "http://ais-sa1.streamon.fm/7093_24k.aac" },
      source: "curated",
      stationClass: "community",
      tags: ["college"],
      favorite: true,
      sortOrder: 903,
    },
    {
      slug: "ckcu",
      name: "CKCU 93.1 FM",
      org: "Carleton University",
      country: "CA",
      // StatsRadio Icecast kh15 stream — confirmed 200 + ICY headers (256 kbps
      // AAC). StreamTitle was permanently null from ICY (broadcast automation
      // does not populate it), but CKCU IS on Spinitron (spinitron.com/CKCU).
      // Upgraded from nowPlayingSource:null to the spinSource helper so
      // attribution now flows through Spinitron web/API rather than ICY.
      streamUrl: "https://stream2.statsradio.com:8124/stream",
      streamQuality: "256kbps AAC",
      streamFormat: "aac",
      homepageUrl: "https://ckcu.ca",
      scheduleUrl: "https://cod.ckcufm.com/programs/guide.html",
      ...spinSource("CKCU", "https://stream2.statsradio.com:8124/stream"),
      source: "curated",
      stationClass: "community",
      tags: ["college"],
      favorite: true,
      sortOrder: 904,
    },
    {
      slug: "ckut",
      name: "CKUT 90.3 FM",
      org: "McGill University",
      country: "CA",
      // CKUT's own Icecast 2.4.4 server at delray.ckut.ca:8000 — this is the
      // live broadcast feed (10+ listeners observed, mount started continuously
      // since July 2026). The Airtime Pro mounts (ckut.out.airtime.pro/ckut_a
      // and ckut_b) always return "CKUT (BACKUP ONLY!)" in StreamTitle and
      // are now filtered as junk, producing zero spins. delray.ckut.ca:8001
      // resets connections from the Replit container; port 8000 is reachable.
      // HTTP (not HTTPS) — the server's TLS on :8001 resets from this IP.
      streamUrl: "http://delray.ckut.ca:8000/903fm-128-stereo",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://ckut.ca",
      scheduleUrl: "https://ckut.ca/table",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "http://delray.ckut.ca:8000/903fm-128-stereo",
      },
      source: "curated",
      stationClass: "community",
      tags: ["college"],
      favorite: true,
      sortOrder: 905,
    },
  ];
}

function nprListStations(): InsertStation[] {
  return [
    {
      slug: "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
      tags: ["indie"],
      name: "KCHUNG Radio",
      org: "KCHUNG",
      country: "US",
      streamUrl: "https://kchung-radio-01e54a81.radiocult.fm/stream",
      streamFormat: "mp3",
      homepageUrl: "https://kchungradio.org",
      donateUrl: null,
      nowPlayingSource: "radio_browser_icy",
      // radioBrowserId is environment-specific; ensureIcyHealthRows() patches
      // it in after upserting the health row.
      nowPlayingConfig: {
        streamUrl: "https://kchung-radio-01e54a81.radiocult.fm/stream",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "curated",
    },
    {
      slug: "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631",
      tags: ["indie"],
      name: "Radio AlHara",
      org: "Radio AlHara",
      country: "PS",
      streamUrl: "https://stream.radiojar.com/78cxy6wkxtzuv",
      streamFormat: "mp3",
      homepageUrl: "https://www.radioalhara.net",
      // Independent non-profit; Palestinian community radio, Bethlehem/Ramallah.
      // Spot-check: they accept support via their site; confirm /support is live.
      donateUrl: "https://www.radioalhara.net/support",
      nowPlayingSource: "radiojar",
      nowPlayingConfig: { streamId: "78cxy6wkxtzuv" },
      source: "curated",
      tier: "longtail",
      stationClass: "curated",
    },
    {
      slug: "radio-nopal",
      tags: ["indie"],
      name: "Radio Nopal",
      org: "Radio Nopal",
      country: "MX",
      streamUrl: "https://radio.mensajito.mx/nopalA",
      streamFormat: "mp3",
      homepageUrl: "https://radionopal.com",
      // Independent non-profit; Mexico City community radio.
      // "apoyanos" (support us) is their standard Spanish-language giving path.
      // Spot-check: confirm /apoyanos resolves; fallback is /donate.
      donateUrl: "https://radionopal.com/apoyanos",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: "https://radio.mensajito.mx/nopalA" },
      source: "curated",
      tier: "longtail",
      stationClass: "curated",
    },
    {
      slug: "lookout-fm",
      tags: ["indie"],
      name: "Lookout.FM",
      org: "Lookout.FM",
      country: "US",
      streamUrl: "https://stream.radiojar.com/5f3y7sbg342vv",
      streamFormat: "mp3",
      homepageUrl: "https://www.lookout.fm",
      donateUrl: null,
      nowPlayingSource: "radiojar",
      nowPlayingConfig: { streamId: "5f3y7sbg342vv" },
      source: "curated",
      tier: "longtail",
      stationClass: "curated",
    },
  ];
}

/**
 * Curated ICY-polled seed stations that need a radio_browser_stations health
 * row (icy status / consecutive-error tracking). The row id is
 * environment-specific, so the seed upserts the row by radio-browser UUID and
 * patches the station's nowPlayingConfig.radioBrowserId with the real id.
 * KCHUNG's UUID is its genuine radio-browser stationuuid; Radio Nopal is not
 * listed on radio-browser with a working stream, so it carries a synthetic
 * `manual-` UUID.
 */
const ICY_HEALTH_SEEDS: Array<{
  stationSlug: string;
  radioBrowserUuid: string;
}> = [
  {
    stationSlug: "wwoz",
    radioBrowserUuid: "9ceb61e8-5101-11e9-a4d7-52543be04c81",
  },
  {
    stationSlug: "kutx",
    radioBrowserUuid: "96652982-5b37-459f-b664-ea46abe8ce5e",
  },
  {
    stationSlug: "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
    radioBrowserUuid: "b58a4aaa-d5be-4925-be71-f69d1cccc13f",
  },
  { stationSlug: "radio-nopal", radioBrowserUuid: "manual-radio-nopal" },
  // Indie internet stations — not in radio-browser, so synthetic UUIDs.
  { stationSlug: "dublab", radioBrowserUuid: "manual-dublab" },
  { stationSlug: "rinse-fm", radioBrowserUuid: "manual-rinse-fm" },
  { stationSlug: "worldwide-fm", radioBrowserUuid: "manual-worldwide-fm" },
  {
    stationSlug: "refuge-worldwide",
    radioBrowserUuid: "manual-refuge-worldwide",
  },
  {
    stationSlug: "nightride-chillsynth",
    radioBrowserUuid: "manual-nightride-chillsynth",
  },
  // Community Radio Index shortlist — genuine Radio Browser UUIDs were used
  // only to resolve and cross-check these hand-reviewed direct HTTPS streams.
  {
    stationSlug: "kiosk-radio",
    radioBrowserUuid: "bae70c5c-9f3f-42fc-a83d-6c13920590e0",
  },
  {
    stationSlug: "lahmacun-radio",
    radioBrowserUuid: "93d9e19c-c8ce-487e-a57b-a3b62fc922f9",
  },
  {
    stationSlug: "oroko-radio",
    radioBrowserUuid: "7babd377-ed7c-4a63-9778-47b0fd94983b",
  },
  {
    stationSlug: "lyl-radio",
    radioBrowserUuid: "e11c170a-474f-11e9-aa55-52543be04c81",
  },
  // Canadian campus stations — real Radio Browser UUIDs (confirmed via API).
  // These stations do not have Spinitron pages; ICY metadata is the only
  // source. favorite=true gives them a persistent watcher socket.
  //
  // CHMR and CISM are intentionally omitted: their ICY streams have permanently
  // null StreamTitle (broadcast automation does not populate it), and no
  // publicly accessible now-playing API was found after investigation (2026-07).
  // CKCU was also omitted for the same ICY reason but has been upgraded to use
  // Spinitron (spinitron.com/CKCU) — it no longer needs an ICY health row.
  { stationSlug: "bytefm-192k", radioBrowserUuid: "manual-bytefm-192k" },
  { stationSlug: "cfuv", radioBrowserUuid: "9619dcac-0601-11e8-ae97-52543be04c81" },
  { stationSlug: "cjsr", radioBrowserUuid: "961a1782-0601-11e8-ae97-52543be04c81" },
  { stationSlug: "ckut", radioBrowserUuid: "c25963ed-7ef5-4789-b8ca-190cbb110154" },
];

/**
 * Ensure each ICY-polled curated seed station has a radio_browser_stations
 * health row linked to it, and that its nowPlayingConfig carries the row's id.
 * Resets icyStatus to "active" on every boot — these streams are hand-verified,
 * so a restart doubles as re-enrollment after a transient suspension (the
 * poller will re-suspend within a few ticks if the stream is genuinely dead).
 * Idempotent — safe on every boot.
 */
export async function ensureIcyHealthRows(): Promise<void> {
  for (const ref of ICY_HEALTH_SEEDS) {
    const seed = SEED_STATIONS.find((s) => s.slug === ref.stationSlug);
    if (!seed?.streamUrl) continue;

    const [station] = await db
      .select({
        id: stationsTable.id,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(eq(stationsTable.slug, ref.stationSlug))
      .limit(1);
    if (!station) continue;

    // A station may already have one or more Radio Browser rows from
    // discovery. Reuse the first real row for the canonical config instead
    // of creating a second health identity; synthetic rows remain the
    // fallback for curated stations absent from Radio Browser.
    const existingRows = await db
      .select({
        id: radioBrowserStationsTable.id,
        radioBrowserUuid: radioBrowserStationsTable.radioBrowserUuid,
      })
      .from(radioBrowserStationsTable)
      .where(
        and(
          eq(radioBrowserStationsTable.stationId, station.id),
          eq(radioBrowserStationsTable.streamUrl, seed.streamUrl),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${radioBrowserStationsTable.radioBrowserUuid} LIKE 'manual-%' THEN 1 ELSE 0 END`,
        radioBrowserStationsTable.id,
      );
    const existing = existingRows[0];
    const [rbRow] = existing
      ? await db
          .update(radioBrowserStationsTable)
          .set({
            name: seed.name,
            icyStatus: "active",
            consecutiveErrors: 0,
            updatedAt: new Date(),
          })
          .where(eq(radioBrowserStationsTable.id, existing.id))
          .returning({ id: radioBrowserStationsTable.id })
      : await db
          .insert(radioBrowserStationsTable)
          .values({
            radioBrowserUuid: ref.radioBrowserUuid,
            streamUrl: seed.streamUrl,
            name: seed.name,
            stationId: station.id,
          })
          .onConflictDoUpdate({
            target: radioBrowserStationsTable.radioBrowserUuid,
            set: {
              streamUrl: seed.streamUrl,
              name: seed.name,
              stationId: station.id,
              icyStatus: "active",
              consecutiveErrors: 0,
              updatedAt: new Date(),
            },
          })
          .returning({ id: radioBrowserStationsTable.id });
    if (!rbRow) continue;

    // A prior boot may have created a synthetic fallback before discovery
    // supplied a real row. It has no spin history of its own and is safe to
    // remove once the real row is selected.
    if (existing && !existing.radioBrowserUuid.startsWith("manual-")) {
      await db
        .delete(radioBrowserStationsTable)
        .where(
          and(
            eq(radioBrowserStationsTable.stationId, station.id),
            eq(radioBrowserStationsTable.streamUrl, seed.streamUrl),
            sql`${radioBrowserStationsTable.radioBrowserUuid} LIKE 'manual-%'`,
            sql`${radioBrowserStationsTable.id} <> ${existing.id}`,
          ),
        );
    }

    const baseConfig =
      station.nowPlayingConfig && typeof station.nowPlayingConfig === "object"
        ? (station.nowPlayingConfig as Record<string, unknown>)
        : {};
    await db
      .update(stationsTable)
      .set({
        nowPlayingConfig: {
          ...baseConfig,
          streamUrl: seed.streamUrl,
          radioBrowserId: rbRow.id,
        },
        updatedAt: sql`now()`,
      })
      .where(eq(stationsTable.id, station.id));
  }
}

/**
 * Stations verified to publish ICY metadata (GET + `Icy-MetaData: 1` probe,
 * 2026-08 curl batch) whose DB rows were seeded with a broken
 * `spinitron_web` source (their callsigns are not hosted on spinitron.com,
 * so the scrape 404'd on every poll and they produced zero spins).
 *
 * `repairMisconfiguredSpinitronStations()` flips these to `radio_browser_icy`
 * at boot. WNUR's RevMA stream answers with a 302 to a signed CDN URL — it
 * works because `resolveStreamUrl()` in icy.ts follows one redirect hop.
 */
export const ICY_REPAIR_STATIONS: ReadonlyArray<{
  slug: string;
  callsign: string;
  streamUrl: string;
}> = [
  { slug: "wrek", callsign: "WREK", streamUrl: "https://streaming.wrek.org/main/128kb.mp3" },
  { slug: "wfmu", callsign: "WFMU", streamUrl: "https://stream0.wfmu.org/freeform-128k" },
  { slug: "wxyc", callsign: "WXYC", streamUrl: "https://audio-mp3.ibiblio.org/wxyc.mp3" },
  { slug: "wmbr", callsign: "WMBR", streamUrl: "https://wmbr.org:8002/hi" },
  { slug: "wdiy", callsign: "WDIY", streamUrl: "https://war.streamguys1.com:7883/wdiy_7880" },
  { slug: "whpk", callsign: "WHPK", streamUrl: "https://whpk-stream.uchicago.edu/stream" },
  { slug: "wxdu", callsign: "WXDU", streamUrl: "https://weeping.wxdu.duke.edu:8443/wxdu128.mp3" },
  { slug: "wicb", callsign: "WICB", streamUrl: "https://icecast.do.zufall.co/wicb_mp3_high" },
  { slug: "wusb", callsign: "WUSB", streamUrl: "https://stream.wusb.stonybrook.edu:8092/listen.pl" },
  { slug: "ckcu", callsign: "CKCU", streamUrl: "https://stream2.statsradio.com:8124/stream" },
  { slug: "wnur", callsign: "WNUR", streamUrl: "https://stream.rcs.revma.com/w4pmmfkdx4zuv" },
  { slug: "wbgo", callsign: "WBGO", streamUrl: "https://ais-sa8.cdnstream1.com/3629_128.mp3" },
];

/**
 * Repair existing DB rows for stations that were seeded with a broken
 * `spinitron_web` source but have an ICY-capable stream (ICY_REPAIR_STATIONS):
 *
 *  1. Upsert a radio_browser_stations health row (synthetic `manual-<slug>`
 *     UUID, icyStatus reset to "active") linked to the station.
 *  2. Flip the station to `now_playing_source = 'radio_browser_icy'` with
 *     `{ callsign, streamUrl, radioBrowserId }` config, and re-activate it in
 *     case a previous icy_unsupported verdict (pre-redirect-support) had
 *     deactivated it.
 *
 * Skips stations upgraded to the authenticated `spinitron` adapter (a real
 * SPINITRON_KEY_* beats ICY scraping). Idempotent — safe on every boot.
 *
 * Remaining zero-spin rows without a verified fallback are retired to a null
 * source by `retireUnverifiedSpinitronWebSources()` rather than left polling
 * a 404 or empty page forever.
 */
export async function repairMisconfiguredSpinitronStations(): Promise<void> {
  let repaired = 0;
  for (const ref of ICY_REPAIR_STATIONS) {
    const [station] = await db
      .select({
        id: stationsTable.id,
        nowPlayingSource: stationsTable.nowPlayingSource,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(eq(stationsTable.slug, ref.slug))
      .limit(1);
    if (!station) continue;
    // A real Spinitron API key beats ICY scraping — leave those rows alone.
    if (station.nowPlayingSource === "spinitron") continue;

    const [rbRow] = await db
      .insert(radioBrowserStationsTable)
      .values({
        radioBrowserUuid: `manual-${ref.slug}`,
        streamUrl: ref.streamUrl,
        name: ref.callsign,
        stationId: station.id,
      })
      .onConflictDoUpdate({
        target: radioBrowserStationsTable.radioBrowserUuid,
        set: {
          streamUrl: ref.streamUrl,
          stationId: station.id,
          icyStatus: "active",
          consecutiveErrors: 0,
          updatedAt: new Date(),
        },
      })
      .returning({ id: radioBrowserStationsTable.id });
    if (!rbRow) continue;

    const baseConfig =
      station.nowPlayingConfig && typeof station.nowPlayingConfig === "object"
        ? (station.nowPlayingConfig as Record<string, unknown>)
        : {};
    await db
      .update(stationsTable)
      .set({
        nowPlayingSource: "radio_browser_icy",
        nowPlayingConfig: {
          callsign: ref.callsign,
          ...baseConfig,
          streamUrl: ref.streamUrl,
          radioBrowserId: rbRow.id,
        },
        active: true,
        updatedAt: sql`now()`,
      })
      .where(eq(stationsTable.id, station.id));
    repaired += 1;
  }
  if (repaired > 0) {
    console.log(
      `[lore] repaired ${repaired} misconfigured spinitron_web station(s) → radio_browser_icy`,
    );
  }
}

/**
 * NTS Radio (London) — two channels, each a continuous 24/7 stream of
 * curated, genre-fluid programming. Their ICY streams publish live per-track
 * artist/title metadata; the NTS Live API augments each spin with its current
 * show title and host, and remains the show-level fallback during a stream
 * outage. The archive poller continues to ingest dated episode tracklists.
 */
function ntsliveStations(): InsertStation[] {
  return [
    {
      slug: "nts-1",
      tags: ["anchor"],
      name: "NTS 1",
      org: "NTS",
      country: "GB",
      streamUrl: "https://stream-relay-geo.ntslive.net/stream",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.nts.live",
      scheduleUrl: "https://www.nts.live/schedule",
      donateUrl: "https://www.nts.live/membership",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://stream-relay-geo.ntslive.net/stream",
        fallbackSource: "nts_live",
        channel: "1",
      },
      // Seed explicitly because the one-time automation-class migration runs
      // before stations are inserted on a clean deployment.
      automationClass: "mixed",
      stationClass: "community",
      sortOrder: 55,
    },
    {
      slug: "nts-2",
      tags: ["anchor"],
      name: "NTS 2",
      org: "NTS",
      country: "GB",
      streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.nts.live",
      scheduleUrl: "https://www.nts.live/schedule",
      donateUrl: "https://www.nts.live/membership",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
        fallbackSource: "nts_live",
        channel: "2",
      },
      automationClass: "mixed",
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
  /**
   * Crossing-surface eligibility for FIP channels.
   *
   * Evidence: FIP Main is Radio France's flagship cross-genre stream and the
   * primary discovery channel. FIP Electro is the wedge sub-channel with the
   * highest yield of catalogue-resolution MBIDs in the electronica/IDM space
   * that other curated sources cover least (confirmed via livemeta API probes).
   * The remaining sub-channels (Rock, Jazz, Groove, World, Reggae, Metal)
   * continue ingesting spins for history and crossing-computation purposes but
   * are excluded from the listener-facing dial so they do not dilute the 8
   * crossing slots FIP would otherwise occupy — reduced to 2 visible slots.
   *
   * "crossingEligible: false" stations:
   *   - remain active (polled normally, ingest continues)
   *   - are excluded from GET /api/stations and now-playing pulse
   *   - retain full spin history and MBID-resolution data
   *   - can be promoted back by flipping the flag in the DB or seed
   */
  const CROSSING_ELIGIBLE_SLUGS = new Set(["fip-main", "fip-electro"]);

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
    crossingEligible: CROSSING_ELIGIBLE_SLUGS.has(slug),
    // Editorial taxonomy: FIP Main is an anchor station; the thematic
    // sub-channels are specialist (genre/format-focused) radio.
    tags: slug === "fip-main" ? ["anchor"] : ["specialist"],
    sortOrder,
  }));
}


/**
 * Pick the best now-playing source for a given callsign.
 *
 * - `SPINITRON_KEY_<CALLSIGN>` present: `spinitron` history adapter
 *   (DJ/playlist attribution, timestamp-stable cursor, full spin history).
 * - Callsign in SPINITRON_CALLSIGNS (verified hosted on spinitron.com):
 *   `spinitron_web` (unauthenticated HTML scrape — zero configuration).
 * - Otherwise, when `icyStreamUrl` is provided (a stream verified or expected
 *   to publish ICY metadata): `radio_browser_icy`. The matching
 *   radio_browser_stations health row and `radioBrowserId` config entry are
 *   populated at boot by `repairMisconfiguredSpinitronStations()`.
 * - Otherwise: no now-playing source at all — honest silence beats a scrape
 *   URL that 404s on every poll.
 *
 * All paths preserve `callsign` so `stationArchiveUrl` can build the
 * Spinitron calendar link and `seedSpinitronRoster()`'s key-upgrade pass can
 * find and upgrade the row when a key is later added.
 */
function spinSource(
  callsign: string,
  icyStreamUrl?: string,
): { nowPlayingSource: string | null; nowPlayingConfig: Record<string, string> } {
  const key = process.env[`SPINITRON_KEY_${callsign}`];
  if (key) {
    return {
      nowPlayingSource: "spinitron",
      nowPlayingConfig: { apiKey: key, callsign, stationHandle: callsign },
    };
  }
  if (spinitronWebSourceForCallsign(callsign)) {
    return {
      nowPlayingSource: "spinitron_web",
      nowPlayingConfig: { callsign },
    };
  }
  if (icyStreamUrl) {
    return {
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: icyStreamUrl, callsign },
    };
  }
  return { nowPlayingSource: null, nowPlayingConfig: { callsign } };
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
 *   --- freeform expansion cohort 1 ---
 *   SPINITRON_KEY_WHPK  — https://whpk.uchicago.edu
 *   SPINITRON_KEY_WESU  — https://wesufm.org
 *   SPINITRON_KEY_WZBC  — https://wzbc.org
 *   SPINITRON_KEY_WRCT  — https://wrct.org
 *   SPINITRON_KEY_KXLU  — https://kxlu.com
 *   SPINITRON_KEY_WBRS  — https://wbrs.fm
 *   SPINITRON_KEY_WMFO  — https://wmfo.org
 *   SPINITRON_KEY_WXDU  — https://wxdu.duke.edu
 *   SPINITRON_KEY_WRIR  — https://wrir.org
 *   SPINITRON_KEY_WICB  — https://wicb.org
 *
 * Without a key the station appears on the dial but shows no now-playing data
 * (the Spinitron adapter returns [] gracefully when apiKey is absent).
 *
 * STREAM URLS — all stream directly to the user's browser (Audio element).
 * Icecast streams on port 8000 are not reachable from the Replit container
 * (outbound port 8000 is blocked) but are publicly accessible from browsers.
 * Three stations use CDN-hosted HTTPS streams confirmed reachable from here:
 * WPRB (streamguys1), WKCR (streamguys1), KALX (berkeley.edu:8443).
 * KXLU uses streamguys1 CDN (same as WPRB/WKCR, confirmed for LMU's setup).
 */
/**
 * HOW TO TAG NEW LONGTAIL-SOURCED COLLEGE STATIONS
 * -------------------------------------------------
 * Stations discovered via the Radio Browser auto-discovery pipeline
 * (source="radio_browser") are tagged as "college" automatically:
 *   - at ingest time, when `isCollegeStation(name)` matches a university/
 *     college name pattern (e.g. "WVUM University of Miami Radio")
 *   - at boot, by the `applyCollegeTagMigration` backfill, which catches
 *     rows stored before ingest-time detection was added
 * No manual action is required for those stations.
 *
 * If a Radio Browser station is a college station but its `org` field is
 * ambiguous (e.g. just the callsign with no institutional suffix), add it here
 * with an explicit `tags: ["college"]` and `source: "curated"` to pin it out
 * of the auto-discovery purge cycle.  Use the `spinSource(callsign)` helper
 * to activate its Spinitron feed if one exists.
 *
 * The "longtail" category in `deriveStationCategories` treats curated longtail
 * stations (source="curated", tier="longtail") unconditionally, and promotes
 * radio_browser rows only when they carry a quality signal (proven/promising/
 * raw qualityTier OR a non-null discoveryScore).  A station tagged "college"
 * but without a quality signal will surface in /college but NOT in /longtail —
 * which is the correct separation: campus stations are their own category, not
 * a discovery-tier proxy.
 */
function spinitronCollegeStations(): InsertStation[] {
  /** Safe public tag marking confirmed campus/college stations.
   *  Detection is explicit (opt-in per station), never inferred from the
   *  station name, so classification never silently mis-fires. */
  const COLLEGE: InsertStation["tags"] = ["college"];

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
      scheduleUrl: "https://spinitron.com/WPRB/calendar",
      // Listener-supported non-profit; runs annual pledge drives. /support is
      // their canonical giving page (confirmed path from their nav).
      donateUrl: "https://wprb.com/support",
      // ICY-verified by the 2026-08 source-coverage probe: the StreamGuys CDN
      // stream publishes per-track artist/title metadata directly, while the
      // spinitron_web scrape had stopped producing usable spins. A
      // SPINITRON_KEY_WPRB API key (spinitron source) would still win if one
      // is ever configured — edit both places together.
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "https://wprb.streamguys1.com/live",
        callsign: "WPRB",
      },
      stationClass: "community",
      tags: COLLEGE,
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
      scheduleUrl: "https://wnur.northwestern.edu/schedule/",
      // Listener-supported student station; Northwestern routes giving through
      // the university's portal — /donate on their own domain is the entry point.
      // Spot-check: confirm the page still resolves vs. giving.northwestern.edu.
      donateUrl: "https://wnur.northwestern.edu/donate",
      ...spinSource("WNUR", "https://stream.rcs.revma.com/w4pmmfkdx4zuv"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 310,
    },
    {
      slug: "wrek",
      name: "WREK 91.1 FM",
      org: "Georgia Institute of Technology",
      country: "US",
      // HTTPS audio/mpeg stream confirmed reachable (200) from the Replit
      // container. WREK's Nginx/Icecast endpoint is the station's 128kbps MP3
      // stream; the HTTP port-8000 URL remains available as a legacy mount.
      streamUrl: "https://streaming.wrek.org/main/128kb.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wrek.org",
      scheduleUrl: "https://wrek.org/shows/",
      // Listener-supported non-profit; freeform Georgia Tech station.
      donateUrl: "https://wrek.org/donate",
      ...spinSource("WREK", "https://streaming.wrek.org/main/128kb.mp3"),
      stationClass: "community",
      tags: COLLEGE,
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
      homepageUrl: "https://kdvs.org/programming",
      scheduleUrl: "https://spinitron.com/KDVS/calendar",
      // Freeform non-profit; UC Davis community station with strong DJ culture.
      donateUrl: "https://kdvs.org/donate",
      ...spinSource("KDVS"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 330,
    },
    {
      slug: "whrb",
      name: "WHRB 95.3 FM",
      org: "Harvard University",
      country: "US",
      city: "Cambridge",
      region: "MA",
      // HTTPS stream confirmed reachable (200 audio/mpeg) from the Replit container.
      // URL sourced from their homepage embedded player.
      streamUrl: "https://stream.whrb.org/whrb-mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://whrb.org",
      scheduleUrl: "https://whrb.org/schedule",
      // Listener-supported non-profit; Harvard's independent radio station.
      donateUrl: "https://whrb.org/support",
      ...spinSource("WHRB"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 340,
    },
    {
      slug: "wkcr",
      name: "WKCR 89.9 FM",
      org: "Columbia University",
      country: "US",
      city: "New York",
      region: "NY",
      // CDN stream confirmed reachable (200) from the Replit container.
      streamUrl: "https://wkcr.streamguys1.com/live",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wkcr.org",
      scheduleUrl: "https://wkcr.org/programs/",
      // Listener-supported non-profit; Columbia University's freeform station.
      // Spot-check: Columbia sometimes routes giving through giving.columbia.edu —
      // confirm /donate resolves or update to the university portal if not.
      donateUrl: "https://wkcr.org/donate",
      ...spinSource("WKCR"),
      stationClass: "community",
      tags: COLLEGE,
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
      scheduleUrl: "https://wfmu.org/schedule",
      donateUrl: "https://www.wfmu.org/donate.html",
      ...spinSource("WFMU", "https://stream0.wfmu.org/freeform-128k"),
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
      scheduleUrl: "https://wxyc.org/schedule",
      // Listener-supported non-profit; UNC Chapel Hill, first internet radio
      // station (1994). Runs annual fundraising campaigns.
      donateUrl: "https://wxyc.org/support",
      ...spinSource("WXYC", "https://audio-mp3.ibiblio.org/wxyc.mp3"),
      // WXYC's archive is independent from its live ICY stream. The official
      // daily JSON has stable playcut ids and derives each track timestamp
      // from its show's sign-on plus offset; the history adapter walks one
      // UTC day at a time without touching the live cursor.
      nowPlayingConfig: {
        ...spinSource("WXYC", "https://audio-mp3.ibiblio.org/wxyc.mp3")
          .nowPlayingConfig,
        history: {
          source: "wxyc_history",
          sourceKey: "wxyc",
          url: "https://archive.wxyc.org/api/daily-playlist",
          dateParam: "date",
          archiveUrl: "https://archive.wxyc.org/api/daily-playlist?date={date}",
        },
      },
      stationClass: "community",
      tags: COLLEGE,
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
      // The official KALX schedule page embeds this public Spinitron grid.
      scheduleUrl: "https://spinitron.com/KALX/calendar",
      // Listener-supported non-profit; UC Berkeley's freeform station.
      // Berkeley routes institutional giving through give.berkeley.edu — the
      // /support path on their own domain is the listener-facing entry point.
      // Spot-check: if /support redirects, the direct fund URL is
      // https://give.berkeley.edu/page.aspx?pid=1162
      donateUrl: "https://kalx.berkeley.edu/support",
      ...spinSource("KALX"),
      stationClass: "community",
      tags: COLLEGE,
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
      scheduleUrl: "https://kvrx.org/schedule",
      // Listener-supported non-profit; UT Austin's all-local freeform station.
      donateUrl: "https://kvrx.org/donate",
      ...spinSource("KVRX"),
      stationClass: "community",
      tags: COLLEGE,
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
      scheduleUrl: "https://wmbr.org/schedule.php",
      // Listener-supported non-profit; MIT's community radio station.
      donateUrl: "https://wmbr.org/donate",
      ...spinSource("WMBR", "https://wmbr.org:8002/hi"),
      stationClass: "community",
      tags: COLLEGE,
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
      scheduleUrl: "https://wusb.fm/schedule",
      // Listener-supported non-profit; Stony Brook University community station.
      donateUrl: "https://wusb.fm/support",
      ...spinSource("WUSB", "https://stream.wusb.stonybrook.edu:8092/listen.pl"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 510,
    },
    {
      slug: "wuog",
      name: "WUOG 90.5 FM",
      org: "University of Georgia",
      country: "US",
      city: "Athens",
      region: "GA",
      // HTTPS audio/mpeg stream confirmed reachable (200) from the Replit
      // container. WUOG's Nginx/Icecast endpoint provides the 128kbps MP3 feed.
      streamUrl: "https://stream.wuog.org/stream",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wuog.org",
      scheduleUrl: "https://wuog.org/schedule",
      // Listener-supported non-profit; University of Georgia's community station.
      donateUrl: "https://wuog.org/donate",
      ...spinSource("WUOG"),
      stationClass: "community",
      tags: COLLEGE,
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
      scheduleUrl: "https://wvum.org/schedule",
      // Listener-supported non-profit; University of Miami's student station.
      donateUrl: "https://wvum.org/donate",
      ...spinSource("WVUM"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 530,
    },
    {
      slug: "kvsc",
      name: "KVSC 88.1 FM",
      org: "St. Cloud State University",
      country: "US",
      city: "St. Cloud",
      region: "MN",
      // HTTPS stream on port 443 confirmed reachable (200 audio/mpeg) from the
      // Replit container. URL sourced from their jPlayer config on the listen page.
      streamUrl: "https://corn.kvsc.org:443/broadband",
      streamQuality: "192kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.kvsc.org",
      scheduleUrl: "https://www.kvsc.org/programs/",
      // Listener-supported non-profit; St. Cloud State University. Famous for
      // their annual 50-hour Trivia Weekend fundraiser. /pledge is their
      // standard giving page; spot-check if they've moved to /donate or /give.
      donateUrl: "https://www.kvsc.org/pledge",
      ...spinSource("KVSC"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 540,
    },

    // ── FREEFORM EXPANSION — COHORT 1 ─────────────────────────────────────
    // Ten additional Spinitron-tracked freeform/experimental stations, added
    // as the first measured batch after the core roster demonstrated
    // attribution yield. All use the shared spinSource helper — spinitron_web
    // by default, upgraded automatically when SPINITRON_KEY_<CALLSIGN> is set.
    // Streams left empty where only HTTP-port-8000 Icecast endpoints are
    // known (blocked from the Replit container but browser-accessible).

    {
      slug: "whpk",
      name: "WHPK 88.5 FM",
      org: "University of Chicago",
      country: "US",
      // University of Chicago's own Icecast 2.4.4 server with a TLS front-end
      // at whpk-stream.uchicago.edu — confirmed 200 audio/mpeg from the Replit
      // container (2026-08). Returns 400 on HEAD (normal Icecast behaviour)
      // but streams correctly on GET. 256kbps MP3.
      // CORS: Access-Control-Allow-Origin: * on GET — confirmed browser-safe
      // (2026-08). No mixed-content issues; pure HTTPS, standard port 443.
      streamUrl: "https://whpk-stream.uchicago.edu/stream",
      streamQuality: "256kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://whpk.uchicago.edu",
      scheduleUrl: "https://whpk.uchicago.edu/schedule",
      ...spinSource("WHPK", "https://whpk-stream.uchicago.edu/stream"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 600,
    },
    {
      slug: "wesu",
      name: "WESU 88.1 FM",
      org: "Wesleyan University",
      country: "US",
      // Wesleyan's own Icecast server at radio.wesleyan.edu:8000/stream —
      // HTTP-only; the host does not expose port 8443 or an HTTPS front-end.
      // Investigation (2026-08): radio-browser confirms the HTTP URL is live
      // (lastcheckok=1, 128kbps MP3); no HTTPS CDN or proxy found.
      // streamUrl left empty so the browser player doesn't attempt a mixed-
      // content load; update when an HTTPS endpoint is published.
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wesufm.org",
      scheduleUrl: "https://spinitron.com/WESU/calendar",
      donateUrl: "https://wesufm.org/support",
      ...spinSource("WESU"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 605,
    },
    {
      slug: "wzbc",
      name: "WZBC 90.3 FM",
      org: "Boston College",
      country: "US",
      city: "Boston",
      region: "MA",
      // WZBC's own Icecast server with HTTPS front-end at stream.wzbc.org —
      // confirmed 200 audio/mpeg from the Replit container (2026-08). Returns
      // 400 on HEAD (normal Icecast behaviour) but streams correctly on GET.
      // 128kbps MP3.
      // CORS: Access-Control-Allow-Origin: * on GET — confirmed browser-safe
      // (2026-08). No mixed-content issues; pure HTTPS, standard port 443.
      streamUrl: "https://stream.wzbc.org/wzbc",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wzbc.org",
      scheduleUrl: "https://spinitron.com/WZBC/calendar",
      ...spinSource("WZBC"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 610,
    },
    {
      slug: "wrct",
      name: "WRCT 88.3 FM",
      org: "Carnegie Mellon University",
      country: "US",
      // Cloudflare-proxied HTTPS mirror of the Icecast origin at
      // stream.wrct.org — WRCT's own site links both URLs; streamalt is the
      // CDN-fronted path. Confirmed 200 audio/mpeg from the Replit container
      // (2026-08). ICY headers present; icy-main-stream-url points to the
      // HTTP origin — this is metadata only, not a redirect, so it does not
      // cause mixed-content issues in the browser. 128kbps MP3.
      // CORS: access-control-allow-origin: * from Cloudflare — confirmed
      // browser-safe (2026-08). HTTP/2 on standard port 443.
      streamUrl: "https://streamalt.wrct.org/wrct-hi.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wrct.org",
      scheduleUrl: "https://wrct.org/schedule",
      donateUrl: "https://wrct.org/donate",
      ...spinSource("WRCT"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 615,
    },
    {
      slug: "kxlu",
      name: "KXLU 88.9 FM",
      org: "Loyola Marymount University",
      country: "US",
      city: "Los Angeles",
      region: "CA",
      // StreamGuys CDN stream — same CDN as WPRB and WKCR; /kxlu-hi is the
      // standard high-quality mount naming for StreamGuys-hosted stations.
      streamUrl: "https://kxlu.streamguys1.com/kxlu-hi",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://kxlu.com",
      scheduleUrl: "https://kxlu.com/schedule",
      donateUrl: "https://kxlu.com/donate",
      ...spinSource("KXLU"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 620,
    },
    {
      slug: "wbrs",
      name: "WBRS 100.1 FM",
      org: "Brandeis University",
      country: "US",
      city: "Waltham",
      region: "MA",
      // Investigation (2026-08): wbrs.fm DNS does not resolve; the station
      // is absent from radio-browser. No stream URL (HTTP or HTTPS) found via
      // common Icecast, StreamGuys, Airtime Pro, or Brandeis-domain patterns.
      // streamUrl left empty until a working endpoint is published.
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wbrs.fm",
      scheduleUrl: "https://wbrs.fm/schedule",
      ...spinSource("WBRS"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 625,
    },
    {
      slug: "wmfo",
      name: "WMFO 91.5 FM",
      org: "Tufts University",
      country: "US",
      city: "Medford",
      region: "MA",
      // Shoutcast DNAS at new-webstream.wmfo.org — HTTP-only (port 80);
      // the server does not expose TLS. Investigation (2026-08): 200 audio/aacp
      // confirmed on the HTTP URL, icy-br:52 (52kbps AAC+). No HTTPS CDN
      // or proxy found. Browsers on HTTPS play it through the server-side
      // relay (see stream-relay.ts); the HTTP URL also feeds the ICY watcher.
      // The trailing ";" is Shoutcast's required stream-request path.
      // Spinitron fixture (test/fixtures/spinitron-wmfo.html) is already
      // captured for parseSpinitronWebPage regression testing.
      streamUrl: "http://new-webstream.wmfo.org/;",
      streamQuality: "52kbps AAC+",
      streamFormat: "aac",
      homepageUrl: "https://wmfo.org",
      scheduleUrl: "https://wmfo.org/schedule",
      donateUrl: "https://wmfo.org/donate",
      ...spinSource("WMFO"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 630,
    },
    {
      slug: "wxdu",
      name: "WXDU 88.7 FM",
      org: "Duke University",
      country: "US",
      // Duke's own Icecast server at weeping.wxdu.duke.edu with TLS on port
      // 8443 — confirmed 200 audio/mpeg from the Replit container (2026-08).
      // 128kbps MP3. The server sends no Access-Control-Allow-Origin header,
      // but that is irrelevant for plain <audio src> playback: CORS only
      // blocks programmatic data access (Web Audio API / canvas). The Lore
      // player uses new Audio() + el.src with no crossOrigin attribute and no
      // AudioContext, so Chromium plays this stream without restriction.
      // Browser fetch confirmed 200 audio/mpeg (2026-08).
      streamUrl: "https://weeping.wxdu.duke.edu:8443/wxdu128.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wxdu.duke.edu",
      scheduleUrl: "https://wxdu.duke.edu/schedule",
      ...spinSource("WXDU", "https://weeping.wxdu.duke.edu:8443/wxdu128.mp3"),
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 635,
    },
    {
      slug: "wrir",
      name: "WRIR 97.3 FM",
      org: "WRIR",
      country: "US",
      // Richmond Independent Radio — listener-supported community station, not
      // university-affiliated. Investigation (2026-08): wrir.org is behind
      // Cloudflare bot protection (JS challenge) which blocked direct source
      // inspection. No entry in radio-browser; common HTTPS CDN patterns
      // (StreamGuys, Airtime Pro, radiocult) all returned ECONNREFUSED.
      // streamUrl left empty until a confirmed HTTPS endpoint is found.
      streamUrl: "",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wrir.org",
      scheduleUrl: "https://wrir.org/schedule",
      donateUrl: "https://wrir.org/donate",
      ...spinSource("WRIR"),
      stationClass: "community",
      sortOrder: 640,
    },
    {
      slug: "wicb",
      name: "WICB 91.7 FM",
      org: "Ithaca College",
      country: "US",
      // Third-party Icecast hosting at icecast.do.zufall.co (DigitalOcean) —
      // WICB's site links this as the primary stream. Both MP3 and AAC+
      // mounts confirmed 200 from the Replit container (2026-08); MP3 used
      // for broad player compatibility. 128kbps MP3.
      // CORS: kh15 Icecast build reflects any Origin header back as
      // Access-Control-Allow-Origin — confirmed browser-safe from any origin
      // (2026-08). No mixed-content issues; pure HTTPS, standard port 443.
      streamUrl: "https://icecast.do.zufall.co/wicb_mp3_high",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wicb.org",
      scheduleUrl: "https://wicb.org/schedule/",
      ...spinSource("WICB", "https://icecast.do.zufall.co/wicb_mp3_high"),
      // Audited 2026-09-02: WICB's own site reads the Last 92 from this
      // first-party JSON endpoint. Each row has a stable play id plus a local
      // America/New_York timestamp. Keep it separate from the live ICY source;
      // the endpoint is a shallow rolling archive and does not support paging.
      nowPlayingConfig: {
        ...spinSource("WICB", "https://icecast.do.zufall.co/wicb_mp3_high")
          .nowPlayingConfig,
        history: {
          source: "wicb_history",
          url: "https://api-v2.wicb.org/song/history/WICB",
          archiveUrl: "https://wicb.org/last92/",
        },
      },
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 645,
    },
    {
      slug: "kfjc",
      name: "KFJC 89.7 FM",
      org: "Foothill College",
      country: "US",
      city: "Los Altos Hills",
      region: "CA",
      // KFJC's official listen page publishes these netcast mounts. The
      // station currently serves them over HTTP, so Lore's existing stream
      // relay provides HTTPS browser playback without changing the audio.
      streamUrl: "http://netcast.kfjc.org/kfjc-128k-mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://kfjc.org",
      // The Broadcast Forecast is KFJC's official rolling programming grid.
      scheduleUrl: "https://kfjc.org/listen/broadcast-forecast",
      donateUrl: "https://kfjc.org/support",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: "http://netcast.kfjc.org/kfjc-128k-mp3",
        callsign: "KFJC",
      },
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      tags: COLLEGE,
      sortOrder: 650,
    },
    {
      slug: "wpkn",
      name: "WPKN 89.5 FM",
      org: "WPKN",
      country: "US",
      city: "Bridgeport",
      region: "CT",
      // Published directly in the official wpkn.org audio player.
      streamUrl: "https://ice25.securenetsystems.net/WPKN",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wpkn.org",
      // WPKN's public Spinitron calendar exposes the same weekly programming
      // through the reusable calendar-feed adapter with row-level provenance.
      scheduleUrl: "https://spinitron.com/WPKN/calendar",
      donateUrl: "https://wpkn.org/donate/",
      ...spinSource("WPKN", "https://ice25.securenetsystems.net/WPKN"),
      source: "curated",
      tier: "longtail",
      stationClass: "community",
      sortOrder: 655,
    },
  ];
}

// ---- Jazz cohort (Spinitron, cohort 2) ----------------------------------

/**
 * Jazz-specialist Spinitron stations — cohort 2.
 *
 * All use the shared `spinSource` helper (spinitron_web by default, upgrading
 * to the full spinitron history adapter when the corresponding secret is set):
 *
 *   SPINITRON_KEY_WBGO  — https://wbgo.org      (Newark Public Radio)
 *   SPINITRON_KEY_KCSM  — https://kcsm.org      (Jazz 91, San Mateo)
 *   SPINITRON_KEY_WPFW  — https://wpfw.org      (Pacifica, Washington DC)
 *   SPINITRON_KEY_WDIY  — https://wdiy.org      (WDIY, Lehigh Valley)
 */
function spinitronJazzStations(): InsertStation[] {
  return [
    {
      slug: "wbgo",
      tags: ["public"],
      name: "WBGO 88.3 FM",
      org: "Newark Public Radio",
      country: "US",
      // WBGO's official listening page explicitly marks its old StreamGuys
      // addresses dead and publishes this 128kbps MP3 replacement. Verified
      // with GET + Icy-MetaData:1 on 2026-08-19, including a real track pair.
      streamUrl: "https://ais-sa8.cdnstream1.com/3629_128.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://wbgo.org",
      scheduleUrl: "https://www.wbgo.org/schedule",
      donateUrl: "https://www.wbgo.org/donate",
      ...spinSource("WBGO"),
      stationClass: "community",
      sortOrder: 700,
    },
    {
      slug: "kcsm",
      name: "KCSM 91.1 FM",
      org: "College of San Mateo",
      country: "US",
      // HTTPS audio/mpeg stream confirmed reachable (200) from the Replit
      // container. Securenet Systems provides KCSM's official 96kbps MP3 mount.
      streamUrl: "https://ice7.securenetsystems.net/KCSM2",
      streamQuality: "96kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://kcsm.org",
      scheduleUrl: "https://kcsm.org/schedule",
      donateUrl: "https://kcsm.org/donate",
      ...spinSource("KCSM"),
      stationClass: "community",
      tags: ["college"],
      sortOrder: 705,
    },
    {
      slug: "wpfw",
      tags: ["public"],
      name: "WPFW 89.3 FM",
      org: "Pacifica Foundation",
      country: "US",
      // StreamTheWorld CDN — the standard stream delivery CDN for Pacifica
      // Foundation stations. The redirect URL is publicly documented; the
      // browser follows the 302 transparently for playback.
      streamUrl:
        "https://playerservices.streamtheworld.com/api/livestream-redirect/WPFW_FM.mp3",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.wpfw.org",
      scheduleUrl: "https://www.wpfw.org/schedule",
      donateUrl: "https://www.wpfw.org/donate",
      ...spinSource("WPFW"),
      stationClass: "community",
      sortOrder: 710,
    },
    {
      slug: "wdiy",
      tags: ["public"],
      name: "WDIY 88.1 FM",
      org: "WDIY",
      country: "US",
      // HTTPS audio/mpeg stream confirmed reachable (206 audio) from the Replit
      // container. StreamGuys hosts WDIY's official 128kbps MP3 mount.
      streamUrl: "https://war.streamguys1.com:7883/wdiy_7880",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.wdiy.org",
      scheduleUrl: "https://www.wdiy.org/wdiy-radio-schedule",
      donateUrl: "https://wdiy.org/donate",
      ...spinSource("WDIY", "https://war.streamguys1.com:7883/wdiy_7880"),
      stationClass: "community",
      sortOrder: 715,
    },
  ];
}

// ---- Canadian Spinitron additions (cohort 3) ----------------------------

/**
 * Canadian campus and independent stations with confirmed Spinitron presence —
 * cohort 3. Added after CKCU was upgraded from ICY-null to Spinitron (via the
 * `canadianCampusStations` update), providing the first evidence that the
 * Spinitron adapter yields usable attribution for Canadian callsigns.
 *
 *   SPINITRON_KEY_CKUA  — https://ckua.com      (Alberta independent)
 *   SPINITRON_KEY_CJSF  — https://www.cjsf.ca   (Simon Fraser University)
 *   SPINITRON_KEY_CHUO  — https://www.chuo.fm   (University of Ottawa)
 *
 * Stream URLs are verified HTTPS audio endpoints; the Spinitron web adapter
 * supplies now-playing data independently of stream availability.
 */
function spinitronCanadianAdditions(): InsertStation[] {
  return [
    {
      slug: "ckua",
      tags: ["public"],
      name: "CKUA Radio",
      org: "CKUA Radio Network",
      country: "CA",
      // HTTPS audio/mpeg stream confirmed reachable (200) from the Replit
      // container. StreamOn hosts CKUA's official 64kbps MP3 mount.
      streamUrl: "https://ais-sa1.streamon.fm/7000_64k.mp3",
      streamQuality: "64kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://ckua.com",
      scheduleUrl: "https://ckua.com/schedule",
      donateUrl: "https://ckua.com/donate",
      ...spinSource("CKUA"),
      stationClass: "community",
      sortOrder: 906,
    },
    {
      slug: "cjsf",
      name: "CJSF 90.1 FM",
      org: "Simon Fraser University",
      country: "CA",
      // HTTPS audio/mpeg stream confirmed reachable (200) from the Replit
      // container. CJSF's HTTPS Icecast endpoint provides the 128kbps MP3 feed.
      streamUrl: "https://www.cjsf.ca/streaming",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.cjsf.ca",
      scheduleUrl: "https://www.cjsf.ca/schedule",
      donateUrl: "https://www.cjsf.ca/support",
      ...spinSource("CJSF"),
      stationClass: "community",
      tags: ["college"],
      sortOrder: 907,
    },
    {
      slug: "chuo",
      name: "CHUO 89.1 FM",
      org: "University of Ottawa",
      country: "CA",
      // HTTPS audio/mpeg stream confirmed reachable (200) from the Replit
      // container. StatsRadio's HTTPS Icecast mount provides CHUO's 128kbps MP3
      // feed (the active host is stream2.statsradio.com).
      streamUrl: "https://stream2.statsradio.com:8102/stream",
      streamQuality: "128kbps MP3",
      streamFormat: "mp3",
      homepageUrl: "https://www.chuo.fm",
      scheduleUrl: "https://www.chuo.fm/schedule",
      donateUrl: "https://www.chuo.fm/donate",
      ...spinSource("CHUO"),
      stationClass: "community",
      tags: ["college"],
      sortOrder: 908,
    },
  ];
}

// ---- Spinitron full roster (web-scrape import) --------------------------

/** In-memory cache for the Spinitron station directory. Held for 24 hours so
 *  restarts don't hammer Spinitron. Reset to null on process restart (which
 *  is fine — 24h is a reasonable re-fetch interval). */
let _spinitronDirectoryCache:
  | { stations: SpinitronDirectoryStation[]; fetchedAt: number }
  | null = null;

const SPINITRON_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const SPINITRON_FETCH_TIMEOUT_MS = 12_000;

export interface SpinitronDirectoryStation {
  /** Spinitron public slug / call sign (e.g. "WPRB"). Case-preserved. */
  callsign: string;
  /** Human-readable station name. */
  name: string;
  /** Spinitron's internal numeric station ID, when available from the API. */
  stationId?: number;
  /** University / organization, if known. */
  org?: string;
  /** ISO 3166-1 alpha-2 country code, if known. */
  country?: string;
  /** Broadcast city when the embedded curated roster knows it. */
  city?: string;
  /** State/province/region when the embedded curated roster knows it. */
  region?: string;
  /** Editorial tags that must survive first insert from the fallback roster. */
  tags?: string[];
  /** Station homepage URL from the Spinitron directory. */
  homepageUrl?: string;
  /** Exact official weekly schedule page, when independently verified. */
  scheduleUrl?: string;
}

/**
 * Try to fetch the Spinitron station list from the public API endpoint
 * (`https://spinitron.com/api/stations`). Returns null when the endpoint
 * requires auth (401/403) or is otherwise unreachable — the caller falls
 * back to HTML scraping in that case.
 */
/**
 * Authenticated Spinitron API directory fetch.
 *
 * The Spinitron public API endpoint (`/api/stations`) requires authentication.
 * When `SPINITRON_API_KEY` is set in the environment, this function fetches the
 * full station directory using Bearer token auth. The full directory contains
 * ~300+ stations vs. the ~84-station embedded fallback.
 *
 * Without a key, the endpoint returns 401 and this function returns null,
 * triggering the HTML-scrape and embedded-list fallbacks.
 */
async function fetchSpinitronApiDirectory(): Promise<
  SpinitronDirectoryStation[] | null
> {
  try {
    // Include the Spinitron API key when available. Without it the endpoint
    // returns 401; with it the full ~300+ station directory is returned.
    const apiKey = process.env.SPINITRON_API_KEY;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch("https://spinitron.com/api/stations?count=2000", {
      headers,
      signal: AbortSignal.timeout(SPINITRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return null; // auth required
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    const items = Array.isArray(body)
      ? (body as Array<Record<string, unknown>>)
      : Array.isArray((body as Record<string, unknown>)?.items)
        ? ((body as Record<string, unknown>).items as Array<
            Record<string, unknown>
          >)
        : null;
    if (!items) return null;
    const out: SpinitronDirectoryStation[] = [];
    for (const item of items) {
      const callsign =
        typeof item.callsign === "string" && item.callsign.trim()
          ? item.callsign.trim()
          : typeof item.slug === "string" && item.slug.trim()
            ? item.slug.trim()
            : null;
      const name =
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : null;
      if (!callsign || !name) continue;
      const station: SpinitronDirectoryStation = { callsign, name };
      // Map Spinitron's internal numeric station ID (used for per-station API calls).
      if (typeof item.id === "number") station.stationId = item.id;
      else if (typeof item.id === "string" && /^\d+$/.test(item.id))
        station.stationId = Number(item.id);
      if (typeof item.org === "string" && item.org.trim())
        station.org = item.org.trim();
      if (typeof item.country === "string" && item.country.trim())
        station.country = item.country.trim();
      if (typeof item.web_url === "string" && item.web_url.trim())
        station.homepageUrl = item.web_url.trim();
      else if (typeof item.url === "string" && item.url.trim())
        station.homepageUrl = item.url.trim();
      out.push(station);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Scrape the Spinitron public station directory at `https://spinitron.com/stations`.
 * The HTML lists each station as a row with a `/CALLSIGN/` link and station
 * name. Extracts callsign + name from every anchor that matches the pattern.
 * This is the fallback when the JSON API requires authentication.
 */
async function fetchSpinitronHtmlDirectory(): Promise<
  SpinitronDirectoryStation[]
> {
  try {
    const res = await fetch("https://spinitron.com/stations", {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Lore Radio/1.0 (+https://spinitron.com)",
      },
      signal: AbortSignal.timeout(SPINITRON_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const out: SpinitronDirectoryStation[] = [];
    // Each station appears as a link like:
    //   <a href="/WPRB">WPRB — Princeton Radio</a>
    // or:
    //   <a href="/WPRB/">WPRB</a> ... <td>Princeton University</td>
    //
    // Pattern A — href="/CALLSIGN" with station info in the same anchor text
    // Pattern B — href="/CALLSIGN/" followed by name in surrounding markup
    //
    // We match any anchor whose href is a single path segment (call sign) and
    // extract the text content as the station name. Then look ahead for an
    // org in a sibling <td>.
    const anchorRe =
      /<a\s+href="\/([A-Z0-9]{2,10})\/?"\s*>([^<]{2,80})<\/a>/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = anchorRe.exec(html)) !== null) {
      const callsign = m[1].trim();
      if (seen.has(callsign)) continue;
      // Skip navigation links like /stations, /about, etc. (non-uppercase slugs)
      if (!/^[A-Z]/.test(callsign)) continue;
      seen.add(callsign);
      const rawName = m[2].trim();
      // Name often includes " — Org" or " | Org" — split and use first part
      const name = rawName.split(/\s[—|–]\s/)[0].trim() || rawName;
      const station: SpinitronDirectoryStation = { callsign, name };
      out.push(station);
    }

    // Secondary pass: try to find country from surrounding context for top hits
    // (best-effort, not required — country defaults to US in the roster)
    return out;
  } catch {
    return [];
  }
}

/**
 * Embedded fallback: a broad legacy list of college stations used when
 * both the public API and HTML directory are unavailable. Callsigns here have
 * their web-scrape eligibility checked against SPINITRON_CALLSIGNS before they
 * are assigned a source. The list includes the already-seeded curated stations
 * (harmless — `onConflictDoNothing` skips existing slugs) plus ~80 additional
 * stations spanning US college and community radio.
 *
 * The quality-scoring companion task will tier these; this list is intentionally
 * broad. Stream URLs are left empty (per task spec — stream discovery is separate).
 */
const EMBEDDED_SPINITRON_STATIONS: SpinitronDirectoryStation[] = [
  // ── Already-seeded curated stations (onConflictDoNothing skips these) ──
  { callsign: "WPRB", name: "WPRB 103.3 FM", org: "Princeton University", country: "US" },
  { callsign: "WNUR", name: "WNUR 89.3 FM", org: "Northwestern University", country: "US" },
  { callsign: "WREK", name: "WREK 91.1 FM", org: "Georgia Institute of Technology", country: "US" },
  { callsign: "KDVS", name: "KDVS 90.3 FM", org: "UC Davis", country: "US" },
  { callsign: "WHRB", name: "WHRB 95.3 FM", org: "Harvard University", country: "US", city: "Cambridge", region: "MA", scheduleUrl: "https://spinitron.com/WHRB/calendar" },
  { callsign: "WKCR", name: "WKCR 89.9 FM", org: "Columbia University", country: "US", city: "New York", region: "NY", scheduleUrl: "https://spinitron.com/WKCR/calendar" },
  { callsign: "WFMU", name: "WFMU 91.1 FM", org: "WFMU", country: "US" },
  { callsign: "WXYC", name: "WXYC 89.3 FM", org: "UNC Chapel Hill", country: "US" },
  { callsign: "KALX", name: "KALX 90.7 FM", org: "UC Berkeley", country: "US" },
  { callsign: "KVRX", name: "KVRX 91.7 FM", org: "UT Austin", country: "US" },
  { callsign: "WMBR", name: "WMBR 88.1 FM", org: "MIT", country: "US" },
  { callsign: "WUSB", name: "WUSB 90.1 FM", org: "Stony Brook University", country: "US" },
  { callsign: "WUOG", name: "WUOG 90.5 FM", org: "University of Georgia", country: "US", city: "Athens", region: "GA", scheduleUrl: "https://spinitron.com/WUOG/calendar" },
  { callsign: "WVUM", name: "WVUM 90.5 FM", org: "University of Miami", country: "US" },
  { callsign: "KVSC", name: "KVSC 88.1 FM", org: "St. Cloud State University", country: "US", city: "St. Cloud", region: "MN", scheduleUrl: "https://spinitron.com/KVSC/calendar" },

  // ── New England ─────────────────────────────────────────────────────────
  { callsign: "WMFO", name: "WMFO 91.5 FM", org: "Tufts University", country: "US", city: "Medford", region: "MA", scheduleUrl: "https://spinitron.com/WMFO/calendar" },
  { callsign: "WERS", name: "WERS 88.9 FM", org: "Emerson College", country: "US" },
  { callsign: "WBRS", name: "WBRS 100.1 FM", org: "Brandeis University", country: "US", city: "Waltham", region: "MA", scheduleUrl: "https://spinitron.com/WBRS/calendar" },
  { callsign: "WZBC", name: "WZBC 90.3 FM", org: "Boston College", country: "US", city: "Boston", region: "MA", scheduleUrl: "https://spinitron.com/WZBC/calendar" },
  { callsign: "WTBU", name: "WTBU 89.3 FM", org: "Boston University", country: "US", city: "Boston", region: "MA", scheduleUrl: "https://spinitron.com/WTBU/calendar" },
  { callsign: "WUML", name: "WUML 91.5 FM", org: "UMass Lowell", country: "US" },
  { callsign: "WMWM", name: "WMWM 91.7 FM", org: "Salem State University", country: "US" },
  { callsign: "WCFM", name: "WCFM 91.9 FM", org: "Williams College", country: "US" },
  { callsign: "WGAM", name: "WGAM", org: "University of New Hampshire", country: "US" },

  // ── New York / Mid-Atlantic ──────────────────────────────────────────────
  { callsign: "WRPI", name: "WRPI 91.5 FM", org: "Rensselaer Polytechnic Institute", country: "US" },
  { callsign: "WICB", name: "WICB 91.7 FM", org: "Ithaca College", country: "US" },
  { callsign: "WITR", name: "WITR 89.7 FM", org: "Rochester Institute of Technology", country: "US", homepageUrl: "https://witr.rit.edu/", scheduleUrl: "https://witr.rit.edu/schedule" },
  { callsign: "WRCU", name: "WRCU 90.1 FM", org: "Colgate University", country: "US" },
  { callsign: "WRHU", name: "WRHU 88.7 FM", org: "Hofstra University", country: "US" },
  { callsign: "WVOF", name: "WVOF 88.5 FM", org: "Fairfield University", country: "US" },
  { callsign: "WBAR", name: "WBAR 87.9 FM", org: "Barnard College", country: "US" },
  { callsign: "WGSU", name: "WGSU 89.3 FM", org: "SUNY Geneseo", country: "US" },
  { callsign: "WBMB", name: "WBMB 1690 AM", org: "Baruch College", country: "US" },
  { callsign: "WSBU", name: "WSBU 88.3 FM", org: "St. Bonaventure University", country: "US" },
  { callsign: "WSAM", name: "WSAM", org: "University of Connecticut", country: "US" },
  { callsign: "WRBB", name: "WRBB 104.9 FM", org: "Northeastern University", country: "US" },
  { callsign: "WPTS", name: "WPTS 92.1 FM", org: "University of Pittsburgh", country: "US" },

  // ── Southeast ───────────────────────────────────────────────────────────
  { callsign: "WRAS", name: "WRAS 88.5 FM", org: "Georgia State University", country: "US" },
  { callsign: "WKNC", name: "WKNC 88.1 FM", org: "NC State University", country: "US" },
  { callsign: "WDCE", name: "WDCE 90.1 FM", org: "University of Richmond", country: "US" },
  { callsign: "WUVT", name: "WUVT 90.7 FM", org: "Virginia Tech", country: "US" },
  { callsign: "WUFT", name: "WUFT 89.1 FM", org: "University of Florida", country: "US" },
  { callsign: "WVFS", name: "WVFS 89.7 FM", org: "Florida State University", country: "US" },
  { callsign: "WRGP", name: "WRGP 88.1 FM", org: "Florida International University", country: "US" },
  { callsign: "WLUR", name: "WLUR 91.5 FM", org: "Washington and Lee University", country: "US" },

  // ── Midwest ─────────────────────────────────────────────────────────────
  { callsign: "WLUW", name: "WLUW 88.7 FM", org: "Loyola University Chicago", country: "US", city: "Chicago", region: "IL", tags: ["college"] },
  { callsign: "WHPK", name: "WHPK 88.5 FM", org: "University of Chicago", country: "US" },
  { callsign: "WEFT", name: "WEFT 90.1 FM", org: "WEFT Community Radio", country: "US" },
  { callsign: "WMHW", name: "WMHW 91.5 FM", org: "Central Michigan University", country: "US" },
  { callsign: "WCBN", name: "WCBN 88.3 FM", org: "University of Michigan", country: "US" },
  { callsign: "WDET", name: "WDET 101.9 FM", org: "Wayne State University", country: "US" },
  { callsign: "WUSC", name: "WUSC 90.5 FM", org: "University of South Carolina", country: "US" },
  { callsign: "WORT", name: "WORT 89.9 FM", org: "WORT Community Radio", country: "US" },
  { callsign: "WSUM", name: "WSUM 91.7 FM", org: "University of Wisconsin–Madison", country: "US" },
  { callsign: "WIUX", name: "WIUX 99.1 FM", org: "Indiana University", country: "US" },
  { callsign: "WREX", name: "WREX", org: "University of Illinois", country: "US" },
  { callsign: "WMTU", name: "WMTU 91.9 FM", org: "Michigan Technological University", country: "US" },

  // ── Southwest / Mountain ────────────────────────────────────────────────
  { callsign: "KXUA", name: "KXUA 88.3 FM", org: "University of Arkansas", country: "US" },
  { callsign: "KDUR", name: "KDUR 91.9 FM", org: "Fort Lewis College", country: "US" },
  { callsign: "KUNM", name: "KUNM 89.9 FM", org: "University of New Mexico", country: "US", homepageUrl: "https://www.kunm.org/", scheduleUrl: "https://www.kunm.org/kunm-radio-schedule" },
  { callsign: "KFAI", name: "KFAI 90.3 FM", org: "KFAI Fresh Air Community Radio", country: "US" },
  { callsign: "KAOS", name: "KAOS 89.3 FM", org: "The Evergreen State College", country: "US" },

  // ── West Coast ──────────────────────────────────────────────────────────
  { callsign: "KCSB", name: "KCSB 91.9 FM", org: "UC Santa Barbara", country: "US" },
  { callsign: "KUCR", name: "KUCR 88.3 FM", org: "UC Riverside", country: "US", city: "Riverside", region: "CA", tags: ["college"] },
  { callsign: "KZSC", name: "KZSC 88.1 FM", org: "UC Santa Cruz", country: "US" },
  { callsign: "KUCI", name: "KUCI 88.9 FM", org: "UC Irvine", country: "US", homepageUrl: "https://kuci.org/", scheduleUrl: "https://kuci.org/show-schedule/" },
  { callsign: "KXLU", name: "KXLU 88.9 FM", org: "Loyola Marymount University", country: "US", city: "Los Angeles", region: "CA", tags: ["college"] },
  { callsign: "KSDT", name: "KSDT 95.7 FM", org: "UC San Diego", country: "US" },
  { callsign: "KZSU", name: "KZSU 90.1 FM", org: "Stanford University", country: "US", homepageUrl: "https://kzsu.stanford.edu/", scheduleUrl: "https://kzsu.stanford.edu/schedule/" },
  { callsign: "KSJS", name: "KSJS 90.5 FM", org: "San Jose State University", country: "US", city: "San Jose", region: "CA", tags: ["college"], scheduleUrl: "https://spinitron.com/KSJS/calendar" },
  { callsign: "KCRH", name: "KCRH 89.9 FM", org: "Chabot College", country: "US" },
  { callsign: "KTUH", name: "KTUH 90.3 FM", org: "University of Hawaii", country: "US" },
  { callsign: "KASC", name: "KASC 1260 AM", org: "Arizona State University", country: "US" },
  { callsign: "KUAZ", name: "KUAZ 89.1 FM", org: "University of Arizona", country: "US" },
  { callsign: "KMNR", name: "KMNR 89.7 FM", org: "Missouri S&T", country: "US" },
  { callsign: "KUPS", name: "KUPS 90.1 FM", org: "University of Puget Sound", country: "US" },
  { callsign: "KGRG", name: "KGRG 89.9 FM", org: "Green River College", country: "US" },
  { callsign: "KLCC", name: "KLCC 89.7 FM", org: "Lane Community College", country: "US" },

  // ── Canada / International ──────────────────────────────────────────────
  { callsign: "CKUT", name: "CKUT 90.3 FM", org: "McGill University", country: "CA" },
  { callsign: "CJSR", name: "CJSR 88.5 FM", org: "University of Alberta", country: "CA" },
  { callsign: "CFUV", name: "CFUV 101.9 FM", org: "University of Victoria", country: "CA" },
  { callsign: "CKCU", name: "CKCU 93.1 FM", org: "Carleton University", country: "CA" },
  { callsign: "CISM", name: "CISM 89.3 FM", org: "Université de Montréal", country: "CA" },
  { callsign: "CHMR", name: "CHMR 93.5 FM", org: "Memorial University of Newfoundland", country: "CA" },
];

/**
 * Fetch (or return cached) the full Spinitron station directory.
 *
 * Tries the authenticated JSON API first (requires `SPINITRON_API_KEY`), then
 * HTML scraping. Returns an **empty array** when both sources are unavailable
 * so callers can detect the failure and alert explicitly rather than silently
 * seeding a partial list.
 *
 * The Spinitron public API currently requires authentication (returns 401
 * without a key), and their HTML directory page returns 404. Set
 * `SPINITRON_API_KEY` to import the full ~300+ station directory.
 *
 * Result is cached in memory for 24 hours to avoid hammering Spinitron on
 * every health-check tick. The cached roster itself persists across restarts
 * via the DB; this cache only saves the network round-trips within a single
 * process lifetime.
 */
export async function fetchSpinitronDirectory(): Promise<
  SpinitronDirectoryStation[]
> {
  const now = Date.now();
  if (
    _spinitronDirectoryCache &&
    now - _spinitronDirectoryCache.fetchedAt < SPINITRON_DIRECTORY_TTL_MS
  ) {
    return _spinitronDirectoryCache.stations;
  }

  let stations = await fetchSpinitronApiDirectory();
  let source = stations ? "api" : null;

  if (!stations) {
    const htmlStations = await fetchSpinitronHtmlDirectory();
    if (htmlStations.length > 0) {
      stations = htmlStations;
      source = "html";
    }
  }

  if (!stations || stations.length === 0) {
    // Both live network sources are unavailable (Spinitron API requires auth;
    // HTML directory returns 404). Fall back to the legacy embedded station
    // list so boot is deterministic. Web-scrape eligibility is still gated by
    // SPINITRON_CALLSIGNS below; entries outside it remain honest no-source
    // rows. Full ~300+ station import requires setting SPINITRON_API_KEY.
    stations = EMBEDDED_SPINITRON_STATIONS;
    // eslint-disable-next-line no-useless-assignment
    source = "embedded-fallback";
    console.warn(
      `[lore/spinitron] directory: live sources unavailable (API 401, HTML 404). ` +
        `Using legacy embedded fallback (${stations.length} stations; web scraping remains allowlisted). ` +
        `Set SPINITRON_API_KEY to import the full ~300+ station directory.`,
    );
  } else {
    console.info(
      `[lore/spinitron] directory loaded (${source}): ${stations.length} station(s)`,
    );
  }

  _spinitronDirectoryCache = { stations, fetchedAt: now };
  return stations;
}

/**
 * DB-driven key-upgrade pass: reads ALL Spinitron web-scrape stations from the
 * DB and upgrades any whose callsign has a `SPINITRON_KEY_<CALLSIGN>` env var
 * to the richer `spinitron` history adapter.
 *
 * Reading from the DB (not a local array) means this pass is correct even on
 * restart — it sees the full persisted roster rather than whichever in-memory
 * list was loaded in this process.
 *
 * Returns the number of stations upgraded.
 */
async function runSpinitronKeyUpgradePass(): Promise<number> {
  const webStations = await db
    .select({
      slug: stationsTable.slug,
      nowPlayingConfig: stationsTable.nowPlayingConfig,
    })
    .from(stationsTable)
    .where(
      and(
        sql`now_playing_config->>'callsign' is not null`,
        sql`(${stationsTable.nowPlayingSource} is null or ${stationsTable.nowPlayingSource} = 'spinitron_web')`,
      ),
    );

  let upgraded = 0;
  for (const row of webStations) {
    const config = row.nowPlayingConfig as Record<string, string> | null;
    const callsign = config?.callsign;
    if (!callsign) continue;
    // Normalize callsign to UPPER so SPINITRON_KEY_WPRB matches a stored
    // callsign of "WPRB", "wprb", or any mixed-case form from the directory.
    const normalizedCallsign = callsign.toUpperCase();
    const envKey = process.env[`SPINITRON_KEY_${normalizedCallsign}`];
    if (!envKey) continue;
    await db
      .update(stationsTable)
      .set({
        nowPlayingSource: "spinitron",
        nowPlayingConfig: {
          ...config,
          apiKey: envKey,
          callsign: normalizedCallsign,
          stationHandle: normalizedCallsign,
        },
        updatedAt: sql`now()`,
      })
      .where(eq(stationsTable.slug, row.slug));
    upgraded++;
  }
  return upgraded;
}

/**
 * Stop polling public Spinitron pages that have not been verified to publish
 * spin rows. Existing rows may predate the allowlist and must be repaired at
 * boot because the roster insert is intentionally conflict-safe.
 *
 * The callsign stays in nowPlayingConfig so archive links and a future
 * SPINITRON_KEY_<CALLSIGN> upgrade continue to work.
 */
export async function retireUnverifiedSpinitronWebSources(): Promise<number> {
  const webStations = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      nowPlayingConfig: stationsTable.nowPlayingConfig,
    })
    .from(stationsTable)
    .where(eq(stationsTable.nowPlayingSource, "spinitron_web"));

  const retireIds = webStations
    .filter((row) => {
      const config = row.nowPlayingConfig as Record<string, unknown> | null;
      const callsign =
        typeof config?.callsign === "string"
          ? config.callsign.trim().toUpperCase()
          : "";
      return !callsign || !SPINITRON_CALLSIGNS.has(callsign);
    })
    .map((row) => row.id);

  if (retireIds.length === 0) return 0;

  await db
    .update(stationsTable)
    .set({
      nowPlayingSource: null,
      updatedAt: sql`now()`,
    })
    .where(inArray(stationsTable.id, retireIds));

  console.info(
    `[lore/spinitron] retired ${retireIds.length} unverified web-scrape source(s) to honest no-source state`,
  );
  return retireIds.length;
}
/**
 * Seed the Spinitron station roster idempotently.
 *
 * **Directory source:** Tries the Spinitron API (authenticated via
 * `SPINITRON_API_KEY` when set) then HTML scraping. When both sources are
 * unavailable (API requires auth, HTML directory 404s), the roster is NOT
 * seeded from a partial static list — a warning is emitted instead so the gap
 * is visible and actionable. Set `SPINITRON_API_KEY` to import the full
 * ~300+ station directory.
 *
 * **Idempotent:** all inserts use `onConflictDoNothing` so existing curated
 * rows (e.g. WPRB, WFMU) keep their stream URLs, sort order, and API keys.
 * Safe to call on every restart — runs the directory fetch each time so newly-
 * added Spinitron stations are discovered automatically.
 *
 * **Key upgrade:** for any Spinitron station where `SPINITRON_KEY_<CALLSIGN>`
 * is set in the environment, upgrades `nowPlayingSource` from `"spinitron_web"`
 * to the richer `"spinitron"` history adapter and injects the API key. The
 * upgrade pass reads from the DB, not the local directory array, so it correctly
 * handles curated stations and any previously-seeded roster rows.
 */
export async function seedSpinitronRoster(): Promise<void> {
  // `fetchSpinitronDirectory()` always returns a non-empty list — either from a
  // live network source (API/HTML) or the vetted embedded fallback — so the
  // insert loop below always runs. All inserts use onConflictDoNothing so this
  // is safe on every restart: existing rows are untouched, new ones are added.
  const stations = await fetchSpinitronDirectory();
  if (stations.length === 0) return; // guard only; should not happen

  let inserted = 0;
  let skipped = 0;

  for (const station of stations) {
    const slug = station.callsign.toLowerCase();
    const row: InsertStation = {
      slug,
      name: station.name,
      org: station.org ?? null,
      country: station.country ?? "US",
      city: station.city ?? null,
      region: station.region ?? null,
      streamUrl: "",
      nowPlayingSource: spinitronWebSourceForCallsign(station.callsign),
      nowPlayingConfig: { callsign: station.callsign },
      source: "curated",
      stationClass: "community",
      tags: station.tags ?? collegeTagFromAffiliation(station.org),
      active: true,
      homepageUrl:
        station.homepageUrl ??
        `https://spinitron.com/${encodeURIComponent(station.callsign)}/`,
      scheduleUrl: station.scheduleUrl ?? null,
    };
    const result = await db
      .insert(stationsTable)
      .values(row)
      // Roster affiliation tags are additive: a newly reviewed explicit
      // affiliation repairs older rows without deleting operator tags.
      .onConflictDoUpdate({
        target: stationsTable.slug,
        set: {
          tags: sql`CASE WHEN EXCLUDED.tags IS NULL THEN ${stationsTable.tags} ELSE (
            SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb) FROM (
              SELECT jsonb_array_elements_text(COALESCE(${stationsTable.tags}, '[]'::jsonb)) AS tag
              UNION
              SELECT jsonb_array_elements_text(EXCLUDED.tags) AS tag
            ) merged_tags
          ) END`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: stationsTable.id });
    if (result.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  // The live Spinitron directory does not reliably carry schedule or location
  // metadata, while the reviewed fallback does. Merge that independently
  // verified evidence onto existing rows as well as fresh inserts so deployed
  // stations gain the timezone needed for schedule attribution.
  for (const station of EMBEDDED_SPINITRON_STATIONS) {
    const inferredTimezone = inferTimezone(
      station.city ?? null,
      station.country ?? "US",
    );
    if (
      !station.scheduleUrl &&
      !station.homepageUrl &&
      !station.city &&
      !station.region &&
      !inferredTimezone
    ) {
      continue;
    }
    await db
      .update(stationsTable)
      .set({
        homepageUrl: station.homepageUrl ?? sql`${stationsTable.homepageUrl}`,
        scheduleUrl: station.scheduleUrl ?? sql`${stationsTable.scheduleUrl}`,
        // A newly reviewed source should be retried immediately instead of
        // inheriting the old URL's success/failure backoff window.
        scheduleAttemptedAt: station.scheduleUrl
          ? sql`CASE WHEN ${stationsTable.scheduleUrl} IS DISTINCT FROM ${station.scheduleUrl} THEN NULL ELSE ${stationsTable.scheduleAttemptedAt} END`
          : sql`${stationsTable.scheduleAttemptedAt}`,
        scheduleFailureReason: station.scheduleUrl
          ? sql`CASE WHEN ${stationsTable.scheduleUrl} IS DISTINCT FROM ${station.scheduleUrl} THEN NULL ELSE ${stationsTable.scheduleFailureReason} END`
          : sql`${stationsTable.scheduleFailureReason}`,
        scheduleFailureAt: station.scheduleUrl
          ? sql`CASE WHEN ${stationsTable.scheduleUrl} IS DISTINCT FROM ${station.scheduleUrl} THEN NULL ELSE ${stationsTable.scheduleFailureAt} END`
          : sql`${stationsTable.scheduleFailureAt}`,
        city: station.city ?? sql`${stationsTable.city}`,
        region: station.region ?? sql`${stationsTable.region}`,
        ianaTimezone: inferredTimezone
          ? sql`COALESCE(${stationsTable.ianaTimezone}, ${inferredTimezone})`
          : sql`${stationsTable.ianaTimezone}`,
      })
      .where(eq(stationsTable.slug, station.callsign.toLowerCase()));
  }

  await runSpinitronKeyUpgradePass();
  await retireUnverifiedSpinitronWebSources();

  // Directory-wide diagnostic: query DB for accurate totals — these reflect the
  // cumulative state (all prior runs + this one), not just what changed this run.
  // Filter to stations that carry a Spinitron callsign in nowPlayingConfig so
  // non-Spinitron stations don't inflate the totals.
  const [dbTotals] = await db
    .select({
      webOnly:
        sql<number>`count(*) filter (where now_playing_source = 'spinitron_web')::int`,
      keyActive:
        sql<number>`count(*) filter (where now_playing_source = 'spinitron')::int`,
    })
    .from(stationsTable)
    .where(sql`now_playing_config->>'callsign' is not null`);

  const total = (dbTotals?.webOnly ?? 0) + (dbTotals?.keyActive ?? 0);
  console.info(
    `[lore/spinitron] roster: ${total} total stations in DB ` +
      `(${dbTotals?.webOnly ?? 0} web-scrape-only, ${dbTotals?.keyActive ?? 0} API-key active); ` +
      `directory: ${stations.length} (source: ${stations.length <= 84 ? "embedded-fallback" : "live-api"}), ` +
      `${inserted} added this boot, ${skipped} already existed`,
  );
}

/**
 * Upsert the curated stations by slug. Idempotent — safe to run on every boot.
 * Updates mutable fields (stream URL/quality, links, now-playing config) so a
 * fix in the seed propagates without a migration, but never clobbers the id so
 * existing spins keep pointing at the same station.
 *
 * After upserting, logs which Spinitron college stations have API keys
 * configured and which are still pending — so a restart with a new key
 * immediately confirms activation in the console without digging through config.
 */
export async function seedStations(): Promise<void> {
  // Permanent-removal tombstones ("Remove from Lore"): a seed station whose
  // slug is excluded must NOT be re-created or re-activated on boot — the
  // permanent-remove endpoint leaves the row hidden+inactive and the exclusion
  // row keeps it that way across restarts. Fails open (empty set) so a DB
  // hiccup here can never block seeding, mirroring the discovery worker.
  let excludedSlugs = new Set<string>();
  try {
    const rows = await db
      .select({ slug: stationExclusionsTable.stationSlug })
      .from(stationExclusionsTable);
    excludedSlugs = new Set(
      rows.map((r) => r.slug).filter((s): s is string => s != null),
    );
  } catch (err) {
    console.warn("[seed] station exclusion lookup failed (failing open)", err);
  }
  for (const s of SEED_STATIONS) {
    if (excludedSlugs.has(s.slug)) continue;
    const computedTimezone = inferTimezone(s.city ?? null, s.country ?? null);
    const computedLocation = coarseUsCityLocation(s);
    const forceKnownUnavailable =
      !!s.nowPlayingConfig &&
      typeof s.nowPlayingConfig === "object" &&
      !Array.isArray(s.nowPlayingConfig) &&
      (s.nowPlayingConfig as Record<string, unknown>).knownUnavailable === true;
    await db
      .insert(stationsTable)
      .values({ ...s, ...computedLocation, ianaTimezone: computedTimezone })
      .onConflictDoUpdate({
        target: stationsTable.slug,
        set: {
          name: s.name,
          org: s.org ?? null,
          country: s.country ?? null,
          // Populate seed-owned city data without erasing an operator correction
          // for older stations whose seed does not carry a city.
          city: sql`COALESCE(EXCLUDED.city, ${stationsTable.city})`,
          // Region follows the same seed-owned, operator-correction-safe rule.
          region: sql`COALESCE(EXCLUDED.region, ${stationsTable.region})`,
          latitude: sql`COALESCE(${stationsTable.latitude}, EXCLUDED.latitude)`,
          longitude: sql`COALESCE(${stationsTable.longitude}, EXCLUDED.longitude)`,
          locationSource: sql`CASE WHEN ${stationsTable.latitude} IS NULL OR ${stationsTable.longitude} IS NULL THEN EXCLUDED.location_source ELSE ${stationsTable.locationSource} END`,
          locationConfidence: sql`CASE WHEN ${stationsTable.latitude} IS NULL OR ${stationsTable.longitude} IS NULL THEN EXCLUDED.location_confidence ELSE ${stationsTable.locationConfidence} END`,
          streamUrl: s.streamUrl,
          streamQuality: s.streamQuality ?? null,
          streamFormat: s.streamFormat ?? "aac",
          homepageUrl: s.homepageUrl ?? null,
          scheduleUrl: s.scheduleUrl ?? null,
          donateUrl: s.donateUrl ?? null,
          // Preserve operator-configured source+config when the seed source is
          // null (e.g. CHMR/CISM while no public API has been found).  Using a
          // CASE keyed on EXCLUDED.now_playing_source rather than COALESCE
          // ensures the two columns always move together:
          //   • seed source is NULL  → keep whatever is in the DB (the admin-
          //     configured source AND its accompanying config survive restarts)
          //   • seed source is non-null → apply the seed values for both
          //     source and config (covers upgrades like CKCU null→spinitron)
          // COALESCE alone can't do this because CHMR/CISM seed config is {}
          // (a valid non-null object), so COALESCE would always pick {} and
          // silently erase any adapter callsign/stream-id the operator set.
          nowPlayingSource: forceKnownUnavailable
            ? null
            : sql`CASE WHEN EXCLUDED.now_playing_source IS NULL THEN ${stationsTable.nowPlayingSource} ELSE EXCLUDED.now_playing_source END`,
          nowPlayingConfig: forceKnownUnavailable
            ? s.nowPlayingConfig
            : sql`CASE WHEN EXCLUDED.now_playing_source IS NULL THEN ${stationsTable.nowPlayingConfig} ELSE EXCLUDED.now_playing_config END`,
          stationClass: s.stationClass ?? "curated",
          // crossingEligible is intentionally omitted from the UPDATE set.
          // The seed only writes it on INSERT (DB default = true). Once a
          // station exists, operators can flip crossing_eligible in the DB
          // (e.g. to demote a FIP sub-channel or restore a hidden station)
          // without the change being silently clobbered on the next restart.
          // To push a seed-defined value to an already-existing station, run
          // the reset_crossing_eligible.sql admin script or apply a migration.
          //
          // COALESCE: update with the newly inferred value only when non-null,
          // otherwise keep whatever is already stored (preserves manual corrections
          // and avoids clobbering with null for US stations that lack a city).
          ianaTimezone: sql`COALESCE(EXCLUDED.iana_timezone, ${stationsTable.ianaTimezone})`,
          // Seeded stations are hand-picked by definition; forcing
          // source="curated" exempts a previously auto-enrolled row (e.g.
          // KCHUNG's radio-browser enrollment) from the whitelist purge.
          source: s.source ?? "curated",
          // Reactivate rows a previous ICY failure deactivated (e.g. KCHUNG
          // after its stream moved to Radiocult): every seeded stream is
          // hand-verified, and the poller re-suspends within a few ticks if
          // one is genuinely dead. Without this, a legacy inactive row stays
          // hidden from GET /api/stations (active=true filter) forever.
          active: true,
          // Propagate the favorite flag so hand-verified ICY stations get
          // persistent watcher sockets without a manual DB edit.
          favorite: s.favorite ?? false,
          // Merge seed tags into existing tags (set union) instead of
          // overwriting: seed-declared classification tags (e.g. "college")
          // must reach already-deployed rows on restart, but operator-added
          // tags in the DB must survive. When the seed declares no tags, the
          // stored value is kept untouched (NULL stays NULL).
          tags: sql`CASE WHEN EXCLUDED.tags IS NULL THEN ${stationsTable.tags} ELSE (
            SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM (
              SELECT jsonb_array_elements_text(COALESCE(${stationsTable.tags}, '[]'::jsonb)) AS t
              UNION
              SELECT jsonb_array_elements_text(EXCLUDED.tags) AS t
            ) merged
          ) END`,
          sortOrder: s.sortOrder ?? 0,
          updatedAt: sql`now()`,
        },
      });
    if (forceKnownUnavailable) {
      // A previously configured ICY row must not survive retirement: even
      // though the null source keeps it out of the poller, deleting the stale
      // health row ensures enrollment/coverage surfaces agree with the seed.
      await db
        .delete(radioBrowserStationsTable)
        .where(
          sql`${radioBrowserStationsTable.stationId} IN (
            SELECT id FROM ${stationsTable} WHERE ${stationsTable.slug} = ${s.slug}
          )`,
        );
    }
  }

  // Specialist is a normal visible category, not a second hidden pool.
  // Promote by stable slug so existing Radio Browser identities and spins are
  // retained. Permanent-removal tombstones always win.
  for (const slug of SPECIALIST_RADIO_SLUGS) {
    if (excludedSlugs.has(slug)) continue;
    await db
      .update(stationsTable)
      .set({
        active: true,
        hidden: false,
        eraGenreMode: true,
        tags: sql`CASE WHEN ${stationsTable.tags} @> '["specialist"]'::jsonb
          THEN ${stationsTable.tags}
          ELSE COALESCE(${stationsTable.tags}, '[]'::jsonb) || '["specialist"]'::jsonb
        END`,
        updatedAt: sql`now()`,
      })
      .where(eq(stationsTable.slug, slug));
  }

  // These stations originate in the separately managed Spinitron directory,
  // not SEED_STATIONS. Repair only their independently verified schedule
  // receipts so stale directory URLs cannot return after a restart.
  for (const repair of VERIFIED_SCHEDULE_SOURCE_REPAIRS) {
    await db
      .update(stationsTable)
      .set({
        homepageUrl: repair.homepageUrl,
        scheduleUrl: repair.scheduleUrl,
      })
      .where(eq(stationsTable.slug, repair.slug));
  }

  // ICY-polled curated stations additionally need a health row whose id is
  // environment-specific — upsert it and patch nowPlayingConfig.radioBrowserId.
  await ensureIcyHealthRows();

  // Repair rows that were seeded with a broken spinitron_web source but have
  // an ICY-capable stream (see ICY_REPAIR_STATIONS). Runs every boot AFTER
  // the seed upsert above, because the upsert rewrites nowPlayingConfig from
  // the seed literal (which cannot know the environment-specific
  // radioBrowserId) — this pass re-links the health row and patches the id.
  await repairMisconfiguredSpinitronStations();

  // Diagnostic: report Spinitron key coverage so adding a key + restarting
  // immediately shows up in logs without any further investigation.
  // Curated stations use "spinitron" when a key is set, "spinitron_web" otherwise.
  const spinitronStations = SEED_STATIONS.filter(
    (s) =>
      s.nowPlayingSource === "spinitron" ||
      s.nowPlayingSource === "spinitron_web",
  );
  const active = spinitronStations.filter(
    (s) => s.nowPlayingSource === "spinitron",
  );
  const pending = spinitronStations.filter(
    (s) => s.nowPlayingSource === "spinitron_web",
  );

  if (active.length > 0) {
    console.info(
      `[lore/spinitron] keys active (${active.length}): ${active.map((s) => s.slug.toUpperCase()).join(", ")}`,
    );
  }
  if (pending.length > 0) {
    console.info(
      `[lore/spinitron] web-scrape mode (${pending.length}): ${pending.map((s) => s.slug.toUpperCase()).join(", ")} — add SPINITRON_KEY_<CALLSIGN> secret and restart to activate full history`,
    );
  }
}

/**
 * One-time (idempotent) backfill: compute and store `ianaTimezone` for any
 * station row that has a city/country but no stored timezone yet.
 *
 * Safe to call on every boot — the WHERE clause targets only null rows, so
 * it's a no-op once all rows are filled. Does NOT overwrite an existing value:
 * a manually-corrected timezone set in the DB stays intact.
 */
export async function backfillStationTimezones(): Promise<void> {
  const rows = await db
    .select({
      id: stationsTable.id,
      city: stationsTable.city,
      country: stationsTable.country,
    })
    .from(stationsTable)
    .where(
      and(
        sql`${stationsTable.ianaTimezone} is null`,
        sql`(${stationsTable.city} is not null or ${stationsTable.country} is not null)`,
      ),
    );

  if (rows.length === 0) return;

  let updated = 0;
  for (const row of rows) {
    const tz = inferTimezone(row.city ?? null, row.country ?? null);
    if (!tz) continue;
    await db
      .update(stationsTable)
      .set({ ianaTimezone: tz })
      .where(eq(stationsTable.id, row.id));
    updated++;
  }

  if (updated > 0) {
    console.info(`[lore/timezone] backfilled ianaTimezone for ${updated} station(s)`);
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
const SEED_BLOG_PICKERS: ReadonlyArray<{
  handle: string;
  name: string;
  homeUrl: string;
  feedUrl: string;
  /** Known-flaky/thin feed: health is recorded but never auto-demoted. */
  tolerant?: boolean;
}> = [
  // --- General canon -------------------------------------------------------
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
  {
    handle: "pitchfork",
    name: "Pitchfork",
    homeUrl: "https://pitchfork.com",
    feedUrl: "https://pitchfork.com/feed/rss",
  },
  {
    handle: "pitchfork-reviews",
    name: "Pitchfork Album Reviews",
    homeUrl: "https://pitchfork.com/reviews/albums/",
    feedUrl: "https://pitchfork.com/feed/feed-album-reviews/rss",
  },
  {
    handle: "bandcamp-daily",
    name: "Bandcamp Daily",
    homeUrl: "https://daily.bandcamp.com",
    feedUrl: "https://daily.bandcamp.com/feed",
  },
  {
    handle: "aquarium-drunkard",
    name: "Aquarium Drunkard",
    homeUrl: "https://aquariumdrunkard.com",
    feedUrl: "https://aquariumdrunkard.com/feed/",
  },
  {
    handle: "guardian-music",
    name: "The Guardian — Music",
    homeUrl: "https://www.theguardian.com/music",
    feedUrl: "https://www.theguardian.com/music/rss",
  },
  // --- Metal ---------------------------------------------------------------
  {
    handle: "the-obelisk",
    name: "The Obelisk",
    homeUrl: "https://theobelisk.net",
    feedUrl: "https://theobelisk.net/obelisk/feed/",
  },
  {
    handle: "angry-metal-guy",
    name: "Angry Metal Guy",
    homeUrl: "https://angrymetalguy.com",
    feedUrl: "https://angrymetalguy.com/feed/",
  },
  {
    handle: "invisible-oranges",
    name: "Invisible Oranges",
    homeUrl: "https://www.invisibleoranges.com",
    feedUrl: "https://www.invisibleoranges.com/feed/",
  },
  {
    handle: "decibel-magazine",
    name: "Decibel Magazine",
    homeUrl: "https://www.decibelmagazine.com",
    feedUrl: "https://www.decibelmagazine.com/feed/",
  },
  {
    handle: "last-rites",
    name: "Last Rites",
    homeUrl: "https://yourlastrites.com",
    feedUrl: "https://yourlastrites.com/feed/",
  },
  {
    handle: "no-clean-singing",
    name: "No Clean Singing",
    homeUrl: "https://www.nocleansinging.com",
    feedUrl: "https://www.nocleansinging.com/feed/",
  },
  {
    handle: "heavy-blog-is-heavy",
    name: "Heavy Blog Is Heavy",
    homeUrl: "https://www.heavyblogisheavy.com",
    feedUrl: "https://www.heavyblogisheavy.com/feed/",
  },
  {
    handle: "metal-injection",
    name: "Metal Injection",
    homeUrl: "https://metalinjection.net",
    feedUrl: "https://metalinjection.net/feed/",
  },
  {
    handle: "metalsucks",
    name: "MetalSucks",
    homeUrl: "https://www.metalsucks.net",
    feedUrl: "https://www.metalsucks.net/feed/",
  },
  {
    handle: "loudersound",
    name: "Louder (Metal Hammer / Prog / Classic Rock)",
    homeUrl: "https://www.loudersound.com",
    feedUrl: "https://www.loudersound.com/feeds/all",
    // Louder's aggregate feed is known-flaky (intermittent 5xx / empty
    // responses) — keep it enrolled, never auto-demote.
    tolerant: true,
  },
  // --- Prog / experimental / drone ----------------------------------------
  {
    handle: "the-quietus",
    name: "The Quietus",
    homeUrl: "https://thequietus.com",
    feedUrl: "https://thequietus.com/feed/",
  },
  {
    handle: "the-wire",
    name: "The Wire",
    homeUrl: "https://www.thewire.co.uk",
    // News-only feed — the magazine itself is print/paywalled. Thin by
    // nature, so tolerant.
    feedUrl: "https://www.thewire.co.uk/news/rss",
    tolerant: true,
  },
  {
    handle: "a-closer-listen",
    name: "A Closer Listen",
    homeUrl: "https://acloserlisten.com",
    feedUrl: "https://acloserlisten.com/feed/",
  },
  {
    handle: "tone-glow",
    name: "Tone Glow",
    homeUrl: "https://toneglow.substack.com",
    feedUrl: "https://toneglow.substack.com/feed",
  },
  // --- Jazz ----------------------------------------------------------------
  {
    handle: "free-jazz-collective",
    name: "The Free Jazz Collective",
    homeUrl: "https://www.freejazzblog.org",
    feedUrl: "https://www.freejazzblog.org/feeds/posts/default?alt=rss",
  },
  {
    handle: "london-jazz-news",
    name: "London Jazz News",
    homeUrl: "https://londonjazznews.com",
    // The site announced a move to ukjazznews.com; the old feed still
    // publishes, so treat as flaky rather than dropping it.
    feedUrl: "https://londonjazznews.com/feed/",
    tolerant: true,
  },
  // --- Enrolled but currently blocked from this network (2026-07-16) --------
  // These four are required by the roster spec but their feeds are unreachable
  // from this server today (Cloudflare/Akamai bot walls, empty XML, or
  // HTML-not-RSS). They are seeded TOLERANT: the poller keeps trying, the
  // health endpoint shows the failure streak, they are never auto-demoted,
  // and ingestion starts automatically if the block ever lifts.
  {
    handle: "cvlt-nation",
    name: "CVLT Nation",
    homeUrl: "https://cvltnation.com",
    // Cloudflare 403s non-browser/datacenter requests as of 2026-07-16.
    feedUrl: "https://cvltnation.com/feed/",
    tolerant: true,
  },
  {
    handle: "npr-music",
    name: "NPR Music",
    homeUrl: "https://www.npr.org/music/",
    // feeds.npr.org returns Akamai "Access Denied" from datacenter IPs.
    feedUrl: "https://feeds.npr.org/1039/rss.xml",
    tolerant: true,
  },
  {
    handle: "all-about-jazz",
    name: "All About Jazz",
    homeUrl: "https://www.allaboutjazz.com",
    // Advertised RSS endpoint returns HTTP 200 with an empty body from here.
    feedUrl: "https://www.allaboutjazz.com/rss/news.xml",
    tolerant: true,
  },
  {
    handle: "downbeat",
    name: "DownBeat",
    homeUrl: "https://downbeat.com",
    // Best-known feed path currently serves HTML, not RSS (thin feed — accept).
    feedUrl: "https://downbeat.com/news/rss",
    tolerant: true,
  },
  // --- Tech / recording / production ----------------------------------------
  {
    handle: "sound-on-sound",
    name: "Sound on Sound",
    homeUrl: "https://www.soundonsound.com",
    // Main news/features feed — includes "Classic Album:" deep-dive column.
    // The blog poller detects that prefix and logs series picks (artist + album)
    // rather than routing them through the list-candidates queue.
    feedUrl: "https://www.soundonsound.com/feed",
  },
  // --- Alt-press / critical canon ------------------------------------------
  {
    handle: "consequence-of-sound",
    name: "Consequence of Sound",
    homeUrl: "https://consequenceofsound.net",
    feedUrl: "https://consequenceofsound.net/feed",
  },
  {
    handle: "avclub-music",
    name: "A.V. Club — Music",
    homeUrl: "https://www.avclub.com",
    feedUrl: "https://www.avclub.com/tag/music/rss",
  },
  // --- Deliberately NOT enrolled (per task spec) -----------------------------
  // Boomkat          — no RSS at all; scrape-only (out of scope).
  // JazzTimes        — feed unstable/dead since the 2023 ownership collapse.
  // Rolling Stone / Mojo / Uncut — no useful feeds; list content is one-off
  //                    pages, not feed items.
] as const;

/**
 * Blog pickers that exist in the DB under auto-discovered handles duplicating
 * a canonical seeded picker. Their picks are re-pointed at the canonical
 * picker and the duplicate row is removed, so re-ingest stays idempotent and
 * follow/feed surfaces show one picker per publication.
 */
const BLOG_PICKER_MERGES: Record<string, string[]> = {
  "brooklyn-vegan": ["brooklynvegan"],
  stereogum: ["lede-admin-stereogum-com", "www-stereogum-com"],
  pitchfork: ["pitchfork-com"],
  "tone-glow": ["toneglow-substack-com"],
  "guardian-music": ["the-guardian-music"],
};

/**
 * Fold auto-discovered duplicate blog pickers into their canonical seeded row.
 * Picks colliding on the (picker_id, external_id) unique key are dropped from
 * the alias (the canonical copy wins); everything else — picks, shows,
 * list_sources, queued list candidates — is re-pointed, then the alias row is
 * deleted. Idempotent: once an alias is gone, later runs are no-ops.
 */
async function mergeDuplicateBlogPickers(): Promise<void> {
  for (const [canonicalHandle, aliasHandles] of Object.entries(
    BLOG_PICKER_MERGES,
  )) {
    const [canonical] = await db
      .select({ id: pickersTable.id })
      .from(pickersTable)
      .where(eq(pickersTable.handle, canonicalHandle))
      .limit(1);
    if (!canonical) continue;

    for (const aliasHandle of aliasHandles) {
      const [alias] = await db
        .select({ id: pickersTable.id })
        .from(pickersTable)
        .where(eq(pickersTable.handle, aliasHandle))
        .limit(1);
      if (!alias || alias.id === canonical.id) continue;

      await db.transaction(async (tx) => {
        // Drop alias picks that would collide with a canonical pick on the
        // (picker_id, external_id) unique key — same post, already tracked.
        await tx.execute(sql`
          DELETE FROM picks a
          WHERE a.picker_id = ${alias.id}
            AND a.external_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM picks c
              WHERE c.picker_id = ${canonical.id}
                AND c.external_id = a.external_id
            )
        `);
        await tx
          .update(picksTable)
          .set({ pickerId: canonical.id })
          .where(eq(picksTable.pickerId, alias.id));
        await tx
          .update(showsTable)
          .set({ pickerId: canonical.id })
          .where(eq(showsTable.pickerId, alias.id));
        await tx
          .update(listSourcesTable)
          .set({ pickerId: canonical.id })
          .where(eq(listSourcesTable.pickerId, alias.id));
        // Same-post list candidates: canonical copy wins on (picker_id, guid).
        await tx.execute(sql`
          DELETE FROM blog_list_candidates a
          WHERE a.picker_id = ${alias.id}
            AND EXISTS (
              SELECT 1 FROM blog_list_candidates c
              WHERE c.picker_id = ${canonical.id} AND c.guid = a.guid
            )
        `);
        await tx.execute(sql`
          UPDATE blog_list_candidates
          SET picker_id = ${canonical.id}
          WHERE picker_id = ${alias.id}
        `);
        await tx.delete(pickersTable).where(eq(pickersTable.id, alias.id));
      });
      console.info(
        `[lore] merged duplicate blog picker ${aliasHandle} -> ${canonicalHandle}`,
      );
    }
  }
}

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
        sourceRef: {
          feedUrl: b.feedUrl,
          ...(b.tolerant ? { tolerant: true } : {}),
        },
        description: `Championed on ${b.name} — tracks it writes up become rideable picks.`,
      });
      // Seeded pickers are wanted: re-activate any that a previous run of the
      // health machinery demoted (e.g. before a feed URL was corrected). Reset
      // the failure streak too — otherwise the very next single failure would
      // hit MAX_FAILURES again and instantly re-demote the picker.
      await db
        .update(pickersTable)
        .set({ active: true, health: null, updatedAt: new Date() })
        .where(
          and(eq(pickersTable.handle, b.handle), eq(pickersTable.active, false)),
        );
    } catch (err) {
      console.error("[lore] seedPickers failed for", b.handle, err);
    }
  }
  await mergeDuplicateBlogPickers().catch((err) =>
    console.error("[lore] blog picker merge failed", err),
  );

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

// ---------------------------------------------------------------------------
// Rolling Stone 500 Greatest Albums list seed
// ---------------------------------------------------------------------------

/**
 * Seed the Rolling Stone "500 Greatest Albums of All Time" list into the
 * list_sources + lists tables so it shows up in the admin list-scrape UI and
 * can be triggered via POST /api/admin/lists/scrape.
 *
 * This is additive/idempotent — safe to call on every boot. The actual album
 * entries are populated by the admin-triggered LLM scrape, not here.
 */
export async function seedRollingStone500List(): Promise<{ listId: number; url: string } | null> {
  try {
    // Find or create the Rolling Stone publication list source.
    // list_sources has no unique index on `name`, so we use select-then-insert.
    let [source] = await db
      .select({ id: listSourcesTable.id })
      .from(listSourcesTable)
      .where(and(eq(listSourcesTable.kind, "publication"), eq(listSourcesTable.name, "Rolling Stone")))
      .limit(1);

    if (!source) {
      const [inserted] = await db
        .insert(listSourcesTable)
        .values({
          kind: "publication",
          name: "Rolling Stone",
          homepageUrl: "https://www.rollingstone.com",
        })
        .returning({ id: listSourcesTable.id });
      source = inserted;
    }

    if (!source) {
      console.warn("[lore] seedRollingStone500List: failed to find or create list source");
      return null;
    }

    // Find or create the list record.
    // The unique index on (sourceId, title, year) uses standard NULL semantics:
    // year=null values are considered distinct, so onConflictDoUpdate would
    // never fire for all-time lists. Use select-then-insert instead.
    const RS_LIST_TITLE = "500 Greatest Albums of All Time";
    const RS_LIST_URL =
      "https://www.rollingstone.com/music/music-lists/best-albums-500-greatest-albums-of-all-time-156826/";

    let listId: number;

    const [existingList] = await db
      .select({ id: listsTable.id })
      .from(listsTable)
      .where(
        and(
          eq(listsTable.sourceId, source.id),
          eq(listsTable.title, RS_LIST_TITLE),
        ),
      )
      .limit(1);

    if (existingList) {
      listId = existingList.id;
    } else {
      const [inserted] = await db.insert(listsTable).values({
        sourceId: source.id,
        title: RS_LIST_TITLE,
        year: null,
        kind: "all_time",
        isRanked: true,
        listLength: 500,
        url: RS_LIST_URL,
        retrievedAt: new Date(),
      }).returning({ id: listsTable.id });
      if (!inserted) {
        console.warn("[lore] seedRollingStone500List: failed to insert list row");
        return null;
      }
      listId = inserted.id;
    }

    console.info("[lore] Rolling Stone 500 list seeded (auto-scrape runs at boot when entries are incomplete)");
    return { listId, url: RS_LIST_URL };
  } catch (err) {
    console.error("[lore] seedRollingStone500List failed", err);
    return null;
  }
}

/**
 * Return the current entry count and expected list length for the Rolling Stone
 * 500 list. Used at boot to decide whether a first-pass scrape is needed.
 * Returns listLength=null when the list row is not found.
 */
export async function getRollingStone500EntryCount(
  listId: number,
): Promise<{ entryCount: number; listLength: number | null }> {
  const [[countRow], [listRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(listEntriesTable)
      .where(eq(listEntriesTable.listId, listId)),
    db
      .select({ listLength: listsTable.listLength })
      .from(listsTable)
      .where(eq(listsTable.id, listId))
      .limit(1),
  ]);
  return {
    entryCount: countRow?.n ?? 0,
    listLength: listRow?.listLength ?? null,
  };
}
