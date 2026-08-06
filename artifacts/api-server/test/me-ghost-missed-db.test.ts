// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  stationsTable,
  showsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for GET /api/me/ghost/missed confirming that:
 *
 *  1. A spin attributable to a scheduled show returns a non-null `runId`
 *     matching min(spin.id) for the (station, show, day) group — the same
 *     derivation used by GET /me/overlaps/runs.
 *
 *  2. A spin with no showId (or whose attribution guard rejects it) returns
 *     `runId: null`, and the row still surfaces in the response with correct
 *     stationId, slug, artistName.
 *
 * Seeds are fully isolated (unique slugs/MBIDs per `run`). Cleaned up on
 * completion. Skips gracefully when no real database is reachable.
 */

const run = randomUUID().slice(0, 8);
const SID = `test-ghost-missed-${run}`;

// Recordings
const MBID_A = `test-gm-a-${run}`;  // library artist has artist_mbid
const MBID_B = `test-gm-b-${run}`;  // same artist_mbid as MBID_A

const ARTIST_MBID = `test-gm-artist-${run}`;

// Stations
const SLUG_WITH_SHOW = `test-gm-with-show-${run}`;
const SLUG_NO_SHOW = `test-gm-no-show-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

let userId: number | null = null;
let stationWithShowId: number | null = null;
let stationNoShowId: number | null = null;
let showId: number | null = null;
let spinWithShowId: number | null = null;
let spinNoShowId: number | null = null;

// ---- helpers -----------------------------------------------------------------

async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Spotify connection + lore user (device-key auth pattern used by tests).
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `gm-u-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Recordings: both share the same artist_mbid so they count as same-artist.
  await db.insert(recordingsTable).values([
    { mbid: MBID_A, title: "Track A", artist: `Artist GM ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_B, title: "Track B", artist: `Artist GM ${run}`, artistMbid: ARTIST_MBID },
  ]);

  // Library: MBID_A in user's library (artist_mbid link makes MBID_B a ghost candidate too).
  await db.insert(libraryItemsTable).values([
    { userId: userId!, mbid: MBID_A, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // Station WITH show.
  const [sws] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_WITH_SHOW,
      name: `Test GM With Show ${run}`,
      streamUrl: "http://example.invalid/gm-with-show",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationWithShowId = sws!.id;

  // Station WITHOUT show.
  const [sns] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_NO_SHOW,
      name: `Test GM No Show ${run}`,
      streamUrl: "http://example.invalid/gm-no-show",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationNoShowId = sns!.id;

  // Show on stationWithShow (no scraped_shows entry → attribute guard will fail,
  // so the LEFT JOIN in the ghost/missed query won't match sh.id; runId = null).
  // To get a non-null runId we would need a passing scraped_shows slot, which is
  // complex to set up in isolation without coupling to the scraped_shows table.
  //
  // Instead we test the null-runId path directly (no show) and the non-null-runId
  // path by verifying that when a spin HAS a show_id but the attribution guard
  // fails, run_id is null — while when show_id IS null, run_id is also null.
  // The "consistent with /me/overlaps/runs" assertion uses the DB directly.
  const [sh] = await db
    .insert(showsTable)
    .values({
      stationId: stationWithShowId!,
      name: `Test GM Show ${run}`,
      djName: "DJ Test",
    })
    .returning({ id: showsTable.id });
  showId = sh!.id;

  // Spin with show (played within last 24h).
  const [spWS] = await db
    .insert(spinsTable)
    .values({
      stationId: stationWithShowId!,
      showId: showId!,
      mbid: MBID_B,
      confidence: "recording_id",
      rawArtist: `Artist GM ${run}`,
      rawTitle: "Track B",
      playedAt: new Date(Date.now() - 60 * 60_000), // 1 hour ago
    })
    .returning({ id: spinsTable.id });
  spinWithShowId = spWS!.id;

  // Spin WITHOUT show (no showId) — played within last 24h.
  const [spNS] = await db
    .insert(spinsTable)
    .values({
      stationId: stationNoShowId!,
      showId: null,
      mbid: MBID_B,
      confidence: "recording_id",
      rawArtist: `Artist GM ${run}`,
      rawTitle: "Track B",
      playedAt: new Date(Date.now() - 30 * 60_000), // 30 min ago
    })
    .returning({ id: spinsTable.id });
  spinNoShowId = spNS!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  // Clean up in FK order.
  if (spinWithShowId != null)
    await db.delete(spinsTable).where(eq(spinsTable.id, spinWithShowId));
  if (spinNoShowId != null)
    await db.delete(spinsTable).where(eq(spinsTable.id, spinNoShowId));
  if (showId != null)
    await db.delete(showsTable).where(eq(showsTable.id, showId));
  if (stationWithShowId != null)
    await db.delete(stationsTable).where(eq(stationsTable.id, stationWithShowId));
  if (stationNoShowId != null)
    await db.delete(stationsTable).where(eq(stationsTable.id, stationNoShowId));
  if (userId != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
  for (const mbid of [MBID_A, MBID_B]) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/me/ghost/missed — runId field", () => {
  it("returns 200 with stations array for authenticated user", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/ghost/missed", SID);
    expect(status).toBe(200);
    expect(body).toHaveProperty("stations");
    expect(Array.isArray(body.stations)).toBe(true);
  });

  it("spin with no showId yields runId: null in the response", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/ghost/missed", SID);
    expect(status).toBe(200);

    const noShowRow = body.stations.find(
      (s: { slug: string }) => s.slug === SLUG_NO_SHOW,
    );
    // The station must appear in the response (artist_mbid matches library).
    expect(noShowRow).toBeDefined();
    // No showId on the spin → runId must be null.
    expect(noShowRow.runId).toBeNull();
    // Other fields are present.
    expect(noShowRow).toHaveProperty("day");
    expect(noShowRow).toHaveProperty("showName");
    expect(noShowRow).toHaveProperty("djName");
    expect(noShowRow).toHaveProperty("playedAt");
  });

  it("spin with showId and no scraped_shows entries passes the attribution guard (runId is non-null)", async () => {
    if (!dbAvailable) return;
    // validScheduleShowAttribution's third branch: NOT EXISTS(scraped_shows any match)
    // returns TRUE when there are NO scraped_shows entries for this station+show at all.
    // This is the "directly curated / unscheduled" path: attribution PASSES unconditionally.
    // So: show with no scraped_shows → sh.id IS NOT NULL in the JOIN → runId is non-null.
    const { status, body } = await get("/api/me/ghost/missed", SID);
    expect(status).toBe(200);

    const withShowRow = body.stations.find(
      (s: { slug: string }) => s.slug === SLUG_WITH_SHOW,
    );
    // The station MUST appear: spin is within 24h, artist_mbid matches library, no listens row.
    expect(withShowRow).toBeDefined();
    // Attribution guard passed (NOT EXISTS(scraped_shows) = true) → runId must be non-null.
    expect(withShowRow.runId).not.toBeNull();
    expect(typeof withShowRow.runId).toBe("number");
  });

  it("response shape includes all required new fields", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/ghost/missed", SID);
    expect(status).toBe(200);

    for (const station of body.stations) {
      // Legacy core fields.
      expect(station).toHaveProperty("stationId");
      expect(station).toHaveProperty("slug");
      expect(station).toHaveProperty("name");
      expect(station).toHaveProperty("artistName");
      // New fields.
      expect(station).toHaveProperty("day");
      expect(station).toHaveProperty("showName");
      expect(station).toHaveProperty("djName");
      expect(station).toHaveProperty("playedAt");
      expect("runId" in station).toBe(true); // explicitly present (may be null)
    }
  });

  it("runId (when non-null) equals min(spin.id) for the matching station+show+day group", async () => {
    if (!dbAvailable) return;
    // Insert a second spin at the same (station, show, day) but later, so
    // min(id) = spinWithShowId. Then insert a passing scraped_shows entry.
    //
    // This test verifies the derivation contract directly by querying the DB
    // for the expected runId and comparing against the API response.
    //
    // First compute the expected runId from the DB.
    const played = new Date(Date.now() - 60 * 60_000);
    const day = played.toISOString().slice(0, 10);
    const expectedRows = await db.execute<{ run_id: number }>(sql`
      SELECT min(id) AS run_id
      FROM spins
      WHERE station_id = ${stationWithShowId}
        AND show_id = ${showId}
        AND to_char(played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${day}
    `);
    const expectedRunId = expectedRows.rows[0]?.run_id ?? null;
    // expectedRunId should equal spinWithShowId (the only spin in this group).
    expect(Number(expectedRunId)).toBe(spinWithShowId);

    // Now call the API and verify the runId matches the DB-computed value unconditionally.
    const { body } = await get("/api/me/ghost/missed", SID);
    const withShowRow = body.stations.find(
      (s: { slug: string }) => s.slug === SLUG_WITH_SHOW,
    );
    // Station MUST appear (spin within 24h, artist_mbid matches library, no listens row).
    expect(withShowRow).toBeDefined();
    // NOT EXISTS(scraped_shows) branch guarantees attribution PASSES → runId is non-null.
    expect(withShowRow.runId).not.toBeNull();
    // Derivation contract: API runId === DB min(spin.id) for the group.
    expect(withShowRow.runId).toBe(Number(expectedRunId));
  });
});

describe("GET /api/me/ghost/missed — unauthenticated", () => {
  it("returns empty stations for a session with no library", async () => {
    if (!dbAvailable) return;
    // New anonymous session → auto-provisioned user with empty library.
    const { status, body } = await get("/api/me/ghost/missed");
    expect(status).toBe(200);
    // The response may contain stations (from other users' libraries), but
    // since the anonymous user has no library, their ghost result is empty.
    expect(body).toHaveProperty("stations");
    expect(Array.isArray(body.stations)).toBe(true);
    // No ghost row should reference our test station slugs.
    const slugs = body.stations.map((s: { slug: string }) => s.slug);
    expect(slugs).not.toContain(SLUG_WITH_SHOW);
    expect(slugs).not.toContain(SLUG_NO_SHOW);
  });
});
