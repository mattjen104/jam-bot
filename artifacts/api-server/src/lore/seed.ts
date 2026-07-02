import { db, stationsTable, type InsertStation } from "@workspace/db";
import { sql } from "drizzle-orm";

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
