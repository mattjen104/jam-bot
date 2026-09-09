/**
 * One-off demo seed for visually verifying the Library set-context deck.
 * Idempotent: deletes any prior demo rows, then inserts a device with one
 * spin-backed keep whose set has a before/after neighbor with artwork.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/seed-deck-demo.ts
 */
import { db, loreUsersTable, stationsTable, recordingsTable, spinsTable, libraryItemsTable, tasteSeedsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const SID = "deck-demo";
const SLUG = "deck-demo-radio";
const MBIDS = ["deck-demo-1", "deck-demo-2", "deck-demo-3"];

// Clean previous demo rows (FK-safe order).
const priorUsers = await db.select({ id: loreUsersTable.id }).from(loreUsersTable).where(eq(loreUsersTable.deviceKey, SID));
const priorUserIds = priorUsers.map((u) => u.id);
if (priorUserIds.length > 0) {
  await db.delete(libraryItemsTable).where(inArray(libraryItemsTable.userId, priorUserIds));
  await db.delete(tasteSeedsTable).where(inArray(tasteSeedsTable.userId, priorUserIds));
  await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, priorUserIds));
}
const priorStations = await db.select({ id: stationsTable.id }).from(stationsTable).where(eq(stationsTable.slug, SLUG));
const priorStationIds = priorStations.map((s) => s.id);
if (priorStationIds.length > 0) {
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, priorStationIds));
  await db.delete(stationsTable).where(inArray(stationsTable.id, priorStationIds));
}
await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, MBIDS));

const [user] = await db.insert(loreUsersTable).values({ deviceKey: SID }).returning({ id: loreUsersTable.id });
const [station] = await db.insert(stationsTable).values({
  slug: SLUG,
  name: "Deck Demo Radio",
  streamUrl: "http://example.invalid/deck-demo",
  stationClass: "community",
  homepageUrl: "https://kexp.org",
  // Hidden so the fake demo station never surfaces in listener-facing lists.
  hidden: true,
}).returning({ id: stationsTable.id });

await db.insert(recordingsTable).values([
  { mbid: "deck-demo-1", title: "Night Bus", artist: "Metro Lines", albumTitle: "City Transfers", artworkUrl: "https://picsum.photos/seed/deck-a/600/600" },
  { mbid: "deck-demo-2", title: "Glass City", artist: "Metro Lines", albumTitle: "City Transfers", artworkUrl: "https://picsum.photos/seed/deck-b/600/600" },
  { mbid: "deck-demo-3", title: "Morning Wire", artist: "Vera Coils", albumTitle: "Soft Circuits", artworkUrl: "https://picsum.photos/seed/deck-c/600/600" },
]);

const now = Date.now();
await db.insert(spinsTable).values({
  stationId: station!.id, mbid: "deck-demo-1", rawArtist: "Metro Lines", rawTitle: "Night Bus",
  confidence: "recording_id", playedAt: new Date(now - 12 * 60_000),
});
const [anchorSpin] = await db.insert(spinsTable).values({
  stationId: station!.id, mbid: "deck-demo-2", rawArtist: "Metro Lines", rawTitle: "Glass City",
  confidence: "recording_id", playedAt: new Date(now - 8 * 60_000),
}).returning({ id: spinsTable.id });
await db.insert(spinsTable).values({
  stationId: station!.id, mbid: "deck-demo-3", rawArtist: "Vera Coils", rawTitle: "Morning Wire",
  confidence: "recording_id", playedAt: new Date(now - 4 * 60_000),
});

await db.insert(libraryItemsTable).values({
  userId: user!.id,
  mbid: "deck-demo-2",
  spinId: anchorSpin!.id,
  provenance: { kind: "keep", stationName: "Deck Demo Radio", stationSlug: SLUG },
});

console.log("seeded deck-demo: sid=deck-demo, station", SLUG, "spin", anchorSpin!.id);
process.exit(0);
