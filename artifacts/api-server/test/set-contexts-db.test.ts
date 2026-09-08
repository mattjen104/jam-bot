// @vitest-environment node
/**
 * Integration tests for POST /api/me/library/set-contexts — the batched
 * "what played around it" read model behind Library crate cover decks.
 *
 * Covers:
 *   1. A spin-backed keep returns the exact before/after neighbors on the
 *      same station, plus the station's homepage URL.
 *   2. Neighbors are station-scoped (a different station's spin at an
 *      intermediate time must not leak in).
 *   3. An artist-file save anchors on the artist's most recent RESOLVED spin
 *      across visible stations.
 *   4. A hidden station's newer spin does not win the artist fallback.
 *   5. A kept item without a retained spin falls back to the artist path.
 *   6. Unknown anchors resolve to an explicit null context.
 *   7. Body validation rejects malformed anchors.
 *
 * All rows are self-contained (unique slugs/MBIDs per run) and cleaned up.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  recordingsTable,
  libraryItemsTable,
  spinsTable,
  stationsTable,
  tasteSeedsTable,
} from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);

const SID = `test-sc-${run}`;
const SLUG_1 = `test-sc-one-${run}`;
const SLUG_2 = `test-sc-two-${run}`;
const SLUG_HIDDEN = `test-sc-hid-${run}`;

const MBID_BEFORE = `sc-before-${run}`;
const MBID_ANCHOR = `sc-anchor-${run}`;
const MBID_AFTER = `sc-after-${run}`;
const ARTIST_KEPT = `SC Kept Artist ${run}`;

const SEED_ARTIST = `SC Seed Artist ${run}`;
const MBID_SEED_OLD = `sc-seed-old-${run}`; // station 1, older
const MBID_SEED_NEW = `sc-seed-new-${run}`; // station 2, newest visible
const MBID_SEED_BEFORE = `sc-seed-before-${run}`;
const MBID_SEED_AFTER = `sc-seed-after-${run}`;
const MBID_SEED_HIDDEN = `sc-seed-hidden-${run}`; // hidden station, even newer

const IMPORT_ARTIST = `SC Import Artist ${run}`;
const MBID_IMPORT = `sc-import-${run}`; // library item WITHOUT spinId
const MBID_IMPORT_SPUN = `sc-import-spun-${run}`;

const MBID_LONE = `sc-lone-${run}`; // kept spin with no neighbor within 20 min
const SID_B = `test-sc-b-${run}`;    // second device: does NOT follow SEED_ARTIST

const T_BEFORE = "2026-09-01T20:00:00.000Z";
const T_ANCHOR = "2026-09-01T20:04:00.000Z";
const T_AFTER = "2026-09-01T20:08:00.000Z";

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userId: number | undefined;
let userBId: number | undefined;
let station1Id: number | undefined;
let station2Id: number | undefined;
let hiddenStationId: number | undefined;
let anchorSpinId: number | undefined;

async function apiPost(path: string, sid: string, body: unknown) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `lore_sid=${sid}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [u] = await db.insert(loreUsersTable).values({ deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  const [uB] = await db.insert(loreUsersTable).values({ deviceKey: SID_B })
    .returning({ id: loreUsersTable.id });
  userBId = uB!.id;

  // The artist-file save that authorizes artist-anchor lookups for SID.
  await db.insert(tasteSeedsTable).values({ userId: userId!, artistName: SEED_ARTIST });

  const [st1] = await db.insert(stationsTable).values({
    slug: SLUG_1,
    name: `SC One ${run}`,
    streamUrl: "http://example.invalid/sc1",
    stationClass: "community",
    homepageUrl: "https://sc-one.example.com",
  }).returning({ id: stationsTable.id });
  station1Id = st1!.id;

  const [st2] = await db.insert(stationsTable).values({
    slug: SLUG_2,
    name: `SC Two ${run}`,
    streamUrl: "http://example.invalid/sc2",
    stationClass: "community",
    homepageUrl: "https://sc-two.example.com",
  }).returning({ id: stationsTable.id });
  station2Id = st2!.id;

  const [sth] = await db.insert(stationsTable).values({
    slug: SLUG_HIDDEN,
    name: `SC Hidden ${run}`,
    streamUrl: "http://example.invalid/sch",
    stationClass: "community",
    hidden: true,
  }).returning({ id: stationsTable.id });
  hiddenStationId = sth!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID_BEFORE, title: `Before Song ${run}`, artist: ARTIST_KEPT,
      artworkUrl: `https://img.example.com/${run}-before.jpg` },
    { mbid: MBID_ANCHOR, title: `Anchor Song ${run}`, artist: ARTIST_KEPT,
      artworkUrl: `https://img.example.com/${run}-anchor.jpg` },
    { mbid: MBID_AFTER, title: `After Song ${run}`, artist: `SC Other ${run}` },
    { mbid: MBID_SEED_OLD, title: `Seed Old ${run}`, artist: SEED_ARTIST },
    { mbid: MBID_SEED_NEW, title: `Seed New ${run}`, artist: SEED_ARTIST,
      artworkUrl: `https://img.example.com/${run}-seed-new.jpg` },
    { mbid: MBID_SEED_BEFORE, title: `Seed Before ${run}`, artist: `SC Neighbor ${run}` },
    { mbid: MBID_SEED_AFTER, title: `Seed After ${run}`, artist: `SC Neighbor ${run}` },
    { mbid: MBID_SEED_HIDDEN, title: `Seed Hidden ${run}`, artist: SEED_ARTIST },
    { mbid: MBID_IMPORT, title: `Import Song ${run}`, artist: IMPORT_ARTIST },
    { mbid: MBID_IMPORT_SPUN, title: `Import Spun ${run}`, artist: IMPORT_ARTIST },
    { mbid: MBID_LONE, title: `Lone Song ${run}`, artist: `SC Lone ${run}` },
  ]).onConflictDoNothing();

  // Station 1 set: before → anchor → after.
  await db.insert(spinsTable).values({
    stationId: station1Id!, mbid: MBID_BEFORE, rawArtist: ARTIST_KEPT,
    rawTitle: `Before Song ${run}`, confidence: "recording_id", playedAt: new Date(T_BEFORE),
  });
  const [anchorSpin] = await db.insert(spinsTable).values({
    stationId: station1Id!, mbid: MBID_ANCHOR, rawArtist: ARTIST_KEPT,
    rawTitle: `Anchor Song ${run}`, confidence: "recording_id", playedAt: new Date(T_ANCHOR),
  }).returning({ id: spinsTable.id });
  anchorSpinId = anchorSpin!.id;
  await db.insert(spinsTable).values({
    stationId: station1Id!, mbid: MBID_AFTER, rawArtist: `SC Other ${run}`,
    rawTitle: `After Song ${run}`, confidence: "recording_id", playedAt: new Date(T_AFTER),
  });

  // Cross-station noise at an intermediate time — must not leak into the set.
  await db.insert(spinsTable).values({
    stationId: station2Id!, mbid: MBID_SEED_OLD, rawArtist: SEED_ARTIST,
    rawTitle: `Seed Old ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-01T20:02:00.000Z"),
  });

  // Seed-artist history: station 1 older, station 2 newest visible…
  await db.insert(spinsTable).values({
    stationId: station1Id!, mbid: MBID_SEED_OLD, rawArtist: SEED_ARTIST,
    rawTitle: `Seed Old ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-08-30T10:00:00.000Z"),
  });
  await db.insert(spinsTable).values({
    stationId: station2Id!, mbid: MBID_SEED_BEFORE, rawArtist: `SC Neighbor ${run}`,
    rawTitle: `Seed Before ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-02T09:58:00.000Z"),
  });
  await db.insert(spinsTable).values({
    stationId: station2Id!, mbid: MBID_SEED_NEW, rawArtist: SEED_ARTIST,
    rawTitle: `Seed New ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-02T10:00:00.000Z"),
  });
  await db.insert(spinsTable).values({
    stationId: station2Id!, mbid: MBID_SEED_AFTER, rawArtist: `SC Neighbor ${run}`,
    rawTitle: `Seed After ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-02T10:03:00.000Z"),
  });
  // …and a hidden station newer still — must be excluded from the fallback.
  await db.insert(spinsTable).values({
    stationId: hiddenStationId!, mbid: MBID_SEED_HIDDEN, rawArtist: SEED_ARTIST,
    rawTitle: `Seed Hidden ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-03T10:00:00.000Z"),
  });

  // Import-artist spins (no keep spin will be retained for this one).
  await db.insert(spinsTable).values({
    stationId: station1Id!, mbid: MBID_IMPORT_SPUN, rawArtist: IMPORT_ARTIST,
    rawTitle: `Import Spun ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-01T18:00:00.000Z"),
  });

  // A lone late-night spin on station 1 — nearest prior spin (20:08) is far
  // outside the 20-minute set-boundary window, so it must get no neighbors.
  const [loneSpin] = await db.insert(spinsTable).values({
    stationId: station1Id!, mbid: MBID_LONE, rawArtist: `SC Lone ${run}`,
    rawTitle: `Lone Song ${run}`, confidence: "recording_id",
    playedAt: new Date("2026-09-01T22:00:00.000Z"),
  }).returning({ id: spinsTable.id });

  // Library items: spin-backed keeps + one spinless import.
  await db.insert(libraryItemsTable).values([
    { userId: userId!, mbid: MBID_ANCHOR, provenance: { kind: "keep" }, spinId: anchorSpinId! },
    { userId: userId!, mbid: MBID_IMPORT, provenance: { kind: "import", service: "spotify" } },
    { userId: userId!, mbid: MBID_LONE, provenance: { kind: "keep" }, spinId: loneSpin!.id },
  ]).onConflictDoNothing();

  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", r));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  const stationIds = [station1Id, station2Id, hiddenStationId].filter(Boolean) as number[];
  const allUserIds = [userId, userBId].filter(Boolean) as number[];
  // library_items.spin_id FK: items must go before spins.
  await db.delete(libraryItemsTable).where(inArray(libraryItemsTable.userId, allUserIds));
  await db.delete(tasteSeedsTable).where(inArray(tasteSeedsTable.userId, allUserIds));
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, allUserIds));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [
    MBID_BEFORE, MBID_ANCHOR, MBID_AFTER,
    MBID_SEED_OLD, MBID_SEED_NEW, MBID_SEED_BEFORE, MBID_SEED_AFTER, MBID_SEED_HIDDEN,
    MBID_IMPORT, MBID_IMPORT_SPUN, MBID_LONE,
  ]));
});

describe("POST /api/me/library/set-contexts", () => {
  it("returns before/after neighbors and station URL for a spin-backed keep", async () => {
    if (!dbAvailable) return;
    const { status, body } = await apiPost("/api/me/library/set-contexts", SID, {
      anchors: [{ mbid: MBID_ANCHOR }],
    });
    expect(status).toBe(200);
    const contexts = body.contexts as Record<string, any>;
    const ctx = contexts[`mbid:${MBID_ANCHOR}`];
    expect(ctx).toBeTruthy();
    expect(ctx.station.slug).toBe(SLUG_1);
    expect(ctx.station.homepageUrl).toBe("https://sc-one.example.com");
    expect(ctx.anchor.mbid).toBe(MBID_ANCHOR);
    expect(ctx.anchor.artworkUrl).toContain(run);
    expect(ctx.anchorKind).toBe("kept-spin");
    expect(ctx.before.mbid).toBe(MBID_BEFORE);
    expect(ctx.before.title).toBe(`Before Song ${run}`);
    expect(ctx.after.mbid).toBe(MBID_AFTER);
  });

  it("omits neighbors across the 20-minute set boundary", async () => {
    if (!dbAvailable) return;
    const { status, body } = await apiPost("/api/me/library/set-contexts", SID, {
      anchors: [{ mbid: MBID_LONE }],
    });
    expect(status).toBe(200);
    const ctx = (body.contexts as Record<string, any>)[`mbid:${MBID_LONE}`];
    expect(ctx).toBeTruthy();
    expect(ctx.anchor.mbid).toBe(MBID_LONE);
    expect(ctx.before).toBeNull();
    expect(ctx.after).toBeNull();
  });

  it("anchors an artist-file save on the most recent resolved visible set", async () => {
    if (!dbAvailable) return;
    const { status, body } = await apiPost("/api/me/library/set-contexts", SID, {
      anchors: [{ artist: SEED_ARTIST }, { artist: `SC Nobody ${run}` }],
    });
    expect(status).toBe(200);
    const contexts = body.contexts as Record<string, any>;
    const ctx = contexts[`artist:${SEED_ARTIST.toLowerCase()}`];
    expect(ctx).toBeTruthy();
    // Newest visible spin is on station 2 (the hidden station's newer spin loses).
    expect(ctx.station.slug).toBe(SLUG_2);
    expect(ctx.anchor.mbid).toBe(MBID_SEED_NEW);
    expect(ctx.anchorKind).toBe("artist-fallback");
    expect(ctx.before.mbid).toBe(MBID_SEED_BEFORE);
    expect(ctx.after.mbid).toBe(MBID_SEED_AFTER);
    // Unknown artist → explicit null.
    expect(contexts[`artist:sc nobody ${run}`]).toBeNull();
  });

  it("refuses artist anchors outside the requesting listener's taste universe", async () => {
    if (!dbAvailable) return;
    // SID_B follows no artists — the same anchor that resolves for SID must
    // stay null for them.
    const { status, body } = await apiPost("/api/me/library/set-contexts", SID_B, {
      anchors: [{ artist: SEED_ARTIST }],
    });
    expect(status).toBe(200);
    const contexts = body.contexts as Record<string, any>;
    expect(contexts[`artist:${SEED_ARTIST.toLowerCase()}`]).toBeNull();
  });

  it("falls back to the artist path for a kept item with no retained spin", async () => {
    if (!dbAvailable) return;
    const { status, body } = await apiPost("/api/me/library/set-contexts", SID, {
      anchors: [{ mbid: MBID_IMPORT }],
    });
    expect(status).toBe(200);
    const contexts = body.contexts as Record<string, any>;
    const ctx = contexts[`mbid:${MBID_IMPORT}`];
    expect(ctx).toBeTruthy();
    expect(ctx.anchor.mbid).toBe(MBID_IMPORT_SPUN);
    expect(ctx.station.slug).toBe(SLUG_1);
  });

  it("rejects malformed anchor bodies", async () => {
    if (!dbAvailable) return;
    expect((await apiPost("/api/me/library/set-contexts", SID, {})).status).toBe(400);
    expect((await apiPost("/api/me/library/set-contexts", SID, { anchors: [{}] })).status).toBe(400);
    expect((await apiPost("/api/me/library/set-contexts", SID, { anchors: ["x"] })).status).toBe(400);
  });
});
