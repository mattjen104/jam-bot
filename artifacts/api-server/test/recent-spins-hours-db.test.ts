// @vitest-environment node
/**
 * Integration tests for the rolling-hours window on
 * GET /api/stations/recent-spins (station fresh-set "new music" scan).
 *
 * Verifies:
 *   - `hours` produces a rolling window: a spin inside the window appears,
 *     a spin older than the window does not.
 *   - Each spin carries `playedAtHour` (UTC hour 0-23) matching played_at.
 *   - `isFirstSpin` uses the rolling-window boundary: an MBID that aired
 *     before the window opened is NOT a first spin inside it.
 *   - `hours` validation: out-of-range values are rejected with 400.
 *
 * All seeds use a run-isolated prefix; cleanup runs in afterAll in FK order.
 * Tests skip silently when no DB is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  recordingsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);

const STATION_SLUG = `rsh-station-${run}`;
// Inside-window spin (2 hours ago) — has NEVER aired before → first spin.
const MBID_FRESH = `rsh-fresh-${run}`;
// Inside-window spin whose MBID ALSO aired long before the window → repeat.
const MBID_REPEAT = `rsh-repeat-${run}`;
// Outside-window-only spin (10 days ago) — must not appear with hours=48.
const MBID_STALE = `rsh-stale-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let stationId: number | null = null;

// Fixed played_at 2 hours ago for the fresh spin, so playedAtHour is exact.
const FRESH_PLAYED_AT = new Date(Date.now() - 2 * 3_600_000);

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  try {
    const result = await db.execute<{ one: number }>(
      { sql: "select 1 as one", params: [], typings: [] } as never,
    );
    if (result.rows[0]?.one === 1) dbAvailable = true;
  } catch {
    return; // DB not available — tests will skip
  }

  await db.insert(recordingsTable).values([
    { mbid: MBID_FRESH, title: "Fresh Cut", artist: `Fresh Artist ${run}` },
    { mbid: MBID_REPEAT, title: "Repeat Cut", artist: `Repeat Artist ${run}` },
    { mbid: MBID_STALE, title: "Stale Cut", artist: `Stale Artist ${run}` },
  ]);

  const [stn] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test RSH Station ${run}`,
      streamUrl: "http://example.invalid/rsh",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = stn!.id;

  const now = Date.now();
  await db.insert(spinsTable).values([
    // Inside the 48h window, first-ever appearance.
    {
      stationId: stationId!,
      mbid: MBID_FRESH,
      confidence: "text",
      rawTitle: "Fresh Cut",
      rawArtist: "Fresh Artist",
      playedAt: FRESH_PLAYED_AT,
    },
    // Inside the window…
    {
      stationId: stationId!,
      mbid: MBID_REPEAT,
      confidence: "text",
      rawTitle: "Repeat Cut",
      rawArtist: "Repeat Artist",
      playedAt: new Date(now - 3 * 3_600_000),
    },
    // …but the same MBID also aired 5 days ago (before the window opened).
    {
      stationId: stationId!,
      mbid: MBID_REPEAT,
      confidence: "text",
      rawTitle: "Repeat Cut",
      rawArtist: "Repeat Artist",
      playedAt: new Date(now - 5 * 24 * 3_600_000),
    },
    // Only aired 10 days ago — outside a 48h window entirely.
    {
      stationId: stationId!,
      mbid: MBID_STALE,
      confidence: "text",
      rawTitle: "Stale Cut",
      rawArtist: "Stale Artist",
      playedAt: new Date(now - 10 * 24 * 3_600_000),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  for (const mbid of [MBID_FRESH, MBID_REPEAT, MBID_STALE]) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
});

const TEST_TIMEOUT = 90_000;

type SpinItem = {
  mbid: string | null;
  playedAt: string;
  playedAtHour: number;
  isFirstSpin: boolean;
  djName: string | null;
  showName: string | null;
};
type StationItem = { stationSlug: string; spins: SpinItem[] };

describe("GET /api/stations/recent-spins?hours=48 — rolling window", () => {
  it("returns in-window spins with playedAtHour and excludes out-of-window spins", async () => {
    if (!dbAvailable) return;

    const { status, body } = await get("/api/stations/recent-spins?hours=48");
    expect(status).toBe(200);

    const stationItem = (body.items as StationItem[]).find(
      (i) => i.stationSlug === STATION_SLUG,
    );
    expect(stationItem).toBeDefined();

    const mbids = stationItem!.spins.map((sp) => sp.mbid);
    expect(mbids).toContain(MBID_FRESH);
    expect(mbids).toContain(MBID_REPEAT);
    // The stale MBID last aired 10 days ago — outside the rolling window.
    expect(mbids).not.toContain(MBID_STALE);

    // playedAtHour is the UTC hour of played_at.
    const fresh = stationItem!.spins.find((sp) => sp.mbid === MBID_FRESH)!;
    expect(fresh.playedAtHour).toBe(FRESH_PLAYED_AT.getUTCHours());
    expect(fresh.playedAtHour).toBeGreaterThanOrEqual(0);
    expect(fresh.playedAtHour).toBeLessThanOrEqual(23);
    // djName / showName are present (null when no valid schedule join).
    expect("djName" in fresh).toBe(true);
    expect("showName" in fresh).toBe(true);
  }, TEST_TIMEOUT);

  it("computes isFirstSpin against the rolling-window boundary", async () => {
    if (!dbAvailable) return;

    const { body } = await get("/api/stations/recent-spins?hours=48");
    const stationItem = (body.items as StationItem[]).find(
      (i) => i.stationSlug === STATION_SLUG,
    )!;

    const fresh = stationItem.spins.find((sp) => sp.mbid === MBID_FRESH)!;
    const repeat = stationItem.spins.find((sp) => sp.mbid === MBID_REPEAT)!;

    // Never aired before the window opened → first spin.
    expect(fresh.isFirstSpin).toBe(true);
    // Same MBID aired 5 days ago (before the window) → NOT a first spin.
    expect(repeat.isFirstSpin).toBe(false);
  }, TEST_TIMEOUT);

  it("rejects out-of-range hours values", async () => {
    if (!dbAvailable) return;

    for (const bad of ["0", "169", "1.5", "abc"]) {
      const { status } = await get(`/api/stations/recent-spins?hours=${bad}`);
      expect(status, `hours=${bad}`).toBe(400);
    }
  }, TEST_TIMEOUT);

  it("still requires date when hours is absent (backward compat)", async () => {
    if (!dbAvailable) return;

    const { status } = await get("/api/stations/recent-spins");
    expect(status).toBe(400);
  }, TEST_TIMEOUT);
});
