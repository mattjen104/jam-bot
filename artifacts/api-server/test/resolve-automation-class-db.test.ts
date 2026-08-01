// @vitest-environment node
/**
 * Integration tests for resolveAutomationClass — the per-slot resolver that
 * converts a stored 'mixed' automation_class to 'human' or 'automated' based
 * on whether a scraped_shows slot covers the query time.
 *
 * Requires a real DB; self-skips when no connection is available.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  stationsTable,
  scrapedShowsTable,
  showsTable,
} from "@workspace/db";
import { resolveAutomationClass } from "../src/lore/scraped-shows-sync.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
const STATION_SLUG = `test-mixed-${run}`;
// All times are in UTC — using the "UTC" timezone keeps DOW/time conversion
// trivial and deterministic regardless of where the test runs.
const TZ = "UTC";

// Slot: Monday 10:00–12:00 UTC, show name "Morning Mix"
const SHOW_NAME = "Morning Mix";
const SLOT_DOW = "Mon";
const SLOT_START = "10:00";
const SLOT_END = "12:00";

// Monday 2024-01-08 10:30 UTC — inside the slot
const INSIDE_SLOT = new Date("2024-01-08T10:30:00Z");
// Monday 2024-01-08 13:00 UTC — same day, after end_time → outside
const AFTER_SLOT = new Date("2024-01-08T13:00:00Z");
// Tuesday 2024-01-09 10:30 UTC — right time but wrong DOW → outside
const WRONG_DOW = new Date("2024-01-09T10:30:00Z");

import { sql } from "drizzle-orm";

let dbAvailable = false;
let stationId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Insert a minimal 'mixed' station
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test Mixed Station ${run}`,
      streamUrl: "https://example.com/stream",
      streamFormat: "aac",
      ianaTimezone: TZ,
      automationClass: "mixed",
      active: true,
    })
    .returning({ id: stationsTable.id });
  stationId = station.id;

  // Insert a scraped_shows slot: Mon 10:00–12:00
  await db.insert(scrapedShowsTable).values({
    stationId: stationId!,
    showName: SHOW_NAME,
    dayOfWeek: SLOT_DOW,
    startTime: SLOT_START,
    endTime: SLOT_END,
    djName: "DJ Test",
  });

  // lookupScrapedShowId joins shows ← scraped_shows, so we need a shows row too
  await db.insert(showsTable).values({
    stationId: stationId!,
    name: SHOW_NAME,
    djName: "DJ Test",
  });
});

afterAll(async () => {
  if (!dbAvailable || stationId == null) return;
  // Clean up in FK order: shows → scraped_shows → stations
  await db.delete(showsTable).where(eq(showsTable.stationId, stationId));
  await db
    .delete(scrapedShowsTable)
    .where(eq(scrapedShowsTable.stationId, stationId));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveAutomationClass", () => {
  it("returns the class unchanged for non-mixed values", async () => {
    expect(await resolveAutomationClass(0, TZ, "human")).toBe("human");
    expect(await resolveAutomationClass(0, TZ, "automated")).toBe("automated");
    expect(await resolveAutomationClass(0, TZ, null)).toBeNull();
  });

  it("returns 'automated' for a mixed station with no timezone", async () => {
    if (!dbAvailable) return;
    const result = await resolveAutomationClass(stationId!, null, "mixed");
    expect(result).toBe("automated");
  });

  it("resolves 'mixed' to 'human' when a scraped show slot covers the query time", async () => {
    if (!dbAvailable) return;
    const result = await resolveAutomationClass(
      stationId!,
      TZ,
      "mixed",
      INSIDE_SLOT,
    );
    expect(result).toBe("human");
  });

  it("resolves 'mixed' to 'automated' after the show slot ends (same DOW, past end_time)", async () => {
    if (!dbAvailable) return;
    const result = await resolveAutomationClass(
      stationId!,
      TZ,
      "mixed",
      AFTER_SLOT,
    );
    expect(result).toBe("automated");
  });

  it("resolves 'mixed' to 'automated' on a day with no scheduled show", async () => {
    if (!dbAvailable) return;
    const result = await resolveAutomationClass(
      stationId!,
      TZ,
      "mixed",
      WRONG_DOW,
    );
    expect(result).toBe("automated");
  });

  it("resolves 'mixed' to 'automated' for a station with no scraped shows at all", async () => {
    if (!dbAvailable) return;
    // stationId + 99999 is guaranteed not to exist and has no scraped_shows
    const result = await resolveAutomationClass(
      stationId! + 99999,
      TZ,
      "mixed",
      INSIDE_SLOT,
    );
    expect(result).toBe("automated");
  });
});
