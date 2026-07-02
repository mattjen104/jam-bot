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
];

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
}
