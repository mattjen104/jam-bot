/**
 * Tests for the for-you ranking engine.
 *
 * Pure-logic tests run without a DB. DB integration tests self-skip
 * when the DB is unavailable (same pattern as entry-db.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryItemsTable,
  recordingsTable,
  stationsTable,
  spinsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import {
  detectThinGenres,
  computeUserSourceAffinity,
  getForYouStations,
  getForYouBlogs,
  MIN_SOURCES_PER_GENRE,
} from "../src/lore/for-you.js";

// Mock external HTTP/side-effect modules so tests are hermetic.
vi.mock("../src/lore/radio-browser.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../src/lore/radio-browser.js")>();
  return {
    ...orig,
    fetchStationsByTag: vi.fn().mockResolvedValue([]),
    filterStations: vi.fn().mockReturnValue([]),
    upsertRadioBrowserStations: vi.fn().mockResolvedValue(0),
  };
});

vi.mock("../src/lore/blog-crossref.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../src/lore/blog-crossref.js")>();
  return { ...orig, queueCrossRefDiscovery: vi.fn() };
});

// ---------------------------------------------------------------------------
// Pure-logic unit tests (no DB)
// ---------------------------------------------------------------------------

describe("detectThinGenres", () => {
  it("returns empty when all genres are covered", () => {
    const items = [
      { tags: ["jazz"], _tier1: 2 },
      { tags: ["jazz"], _tier1: 1 },
      { tags: ["jazz"], _tier1: 3 },
    ];
    expect(detectThinGenres(items, "station")).toEqual([]);
  });

  it("returns a thin pole when overlap count < MIN_SOURCES_PER_GENRE", () => {
    const items = [
      { tags: ["ambient"], _tier1: 1 },
      { tags: ["ambient"], _tier1: 0 },
    ];
    const thin = detectThinGenres(items, "station");
    expect(thin).toHaveLength(1);
    expect(thin[0]!.genre).toBe("ambient");
    expect(thin[0]!.sourceType).toBe("station");
    expect(thin[0]!.coveredCount).toBeLessThan(MIN_SOURCES_PER_GENRE);
  });

  it("counts only items with _tier1 > 0 toward coverage", () => {
    const items = [
      { tags: ["jazz"], _tier1: 5 },
      { tags: ["jazz"], _tier1: 0 },
      { tags: ["jazz"], _tier1: 0 },
    ];
    const thin = detectThinGenres(items, "picker");
    expect(thin[0]!.coveredCount).toBe(1);
  });

  it("handles items with no tags as 'uncategorized'", () => {
    const items = [{ tags: [], _tier1: 1 }];
    const thin = detectThinGenres(items, "station");
    expect(thin[0]!.genre).toBe("uncategorized");
  });

  it("handles multiple genres independently", () => {
    const items = [
      { tags: ["jazz"], _tier1: 2 },
      { tags: ["jazz"], _tier1: 2 },
      { tags: ["jazz"], _tier1: 2 },
      { tags: ["ambient"], _tier1: 1 },
    ];
    const thin = detectThinGenres(items, "station");
    expect(thin.map((t) => t.genre)).toContain("ambient");
    expect(thin.map((t) => t.genre)).not.toContain("jazz");
  });
});

describe("four-tier sort order (pure)", () => {
  type SortableItem = {
    name: string;
    _tier1: number;
    _tier2: number;
    _tier3: number;
    _tier4: number;
  };

  function applySort(items: SortableItem[]): SortableItem[] {
    return [...items].sort(
      (a, b) =>
        b._tier1 - a._tier1 ||
        b._tier2 - a._tier2 ||
        b._tier3 - a._tier3 ||
        b._tier4 - a._tier4,
    );
  }

  it("tier 1 (overlap) is primary sort", () => {
    const items: SortableItem[] = [
      { name: "B", _tier1: 5, _tier2: 0, _tier3: 0, _tier4: 9999 },
      { name: "A", _tier1: 10, _tier2: 0, _tier3: 0, _tier4: 0 },
    ];
    expect(applySort(items)[0]!.name).toBe("A");
  });

  it("tier 2 (keep overlap) breaks ties on tier 1", () => {
    const items: SortableItem[] = [
      { name: "B", _tier1: 5, _tier2: 1, _tier3: 0, _tier4: 999 },
      { name: "A", _tier1: 5, _tier2: 3, _tier3: 0, _tier4: 0 },
    ];
    expect(applySort(items)[0]!.name).toBe("A");
  });

  it("tier 3 (co-picker affinity) breaks ties on tier 2", () => {
    const items: SortableItem[] = [
      { name: "B", _tier1: 5, _tier2: 3, _tier3: 1, _tier4: 999 },
      { name: "A", _tier1: 5, _tier2: 3, _tier3: 4, _tier4: 0 },
    ];
    expect(applySort(items)[0]!.name).toBe("A");
  });

  it("tier 4 (popularity) breaks further ties", () => {
    const items: SortableItem[] = [
      { name: "B", _tier1: 5, _tier2: 3, _tier3: 2, _tier4: 10 },
      { name: "A", _tier1: 5, _tier2: 3, _tier3: 2, _tier4: 100 },
    ];
    expect(applySort(items)[0]!.name).toBe("A");
  });

  it("all-zero tier1 items are ranked purely by popularity (cold-start analog)", () => {
    const items: SortableItem[] = [
      { name: "C", _tier1: 0, _tier2: 0, _tier3: 0, _tier4: 50 },
      { name: "A", _tier1: 0, _tier2: 0, _tier3: 0, _tier4: 200 },
      { name: "B", _tier1: 0, _tier2: 0, _tier3: 0, _tier4: 100 },
    ];
    const sorted = applySort(items);
    expect(sorted.map((i) => i.name)).toEqual(["A", "B", "C"]);
  });
});

// ---------------------------------------------------------------------------
// DB integration tests
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.execute(
      sql`delete from lore_users where spotify_user_id like ${"test-fy-" + run + "%"}`,
    );
  } catch {
    // best-effort
  }
});

/** Helper: insert a lore_user and return its id. */
async function insertTestUser(spotifyId: string): Promise<number> {
  const [row] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: spotifyId })
    .returning({ id: loreUsersTable.id });
  return row!.id;
}

describe("getForYouStations — cold start (no library)", () => {
  it("returns cold_start=true when user has no library", async () => {
    if (!dbAvailable) return;

    const userId = await insertTestUser("test-fy-" + run + "-cold-s");
    const loreUser = {
      id: userId,
      spotifyUserId: "test-fy-" + run + "-cold-s",
      spotifyConnectionId: null,
      createdAt: new Date(),
    };
    const result = await getForYouStations(loreUser);

    expect(result.cold_start).toBe(true);
    expect(result.prompt).toBeTruthy();
    // Cold-start items must omit the overlap proof entirely (not null).
    for (const pole of result.genre_poles) {
      for (const item of pole.items) {
        expect(item.overlap).toBeUndefined();
      }
    }
  });
});

describe("getForYouBlogs — cold start (no library)", () => {
  it("returns cold_start=true when user has no library", async () => {
    if (!dbAvailable) return;

    const userId = await insertTestUser("test-fy-" + run + "-cold-b");
    const loreUser = {
      id: userId,
      spotifyUserId: "test-fy-" + run + "-cold-b",
      spotifyConnectionId: null,
      createdAt: new Date(),
    };
    const result = await getForYouBlogs(loreUser);

    expect(result.cold_start).toBe(true);
    expect(result.prompt).toBeTruthy();
    // Cold-start items must omit the overlap proof entirely (not null).
    for (const pole of result.genre_poles) {
      for (const item of pole.items) {
        expect(item.overlap).toBeUndefined();
      }
    }
  });
});

describe("computeUserSourceAffinity + getForYouStations", () => {
  it("ranks stations with overlap above those without", async () => {
    if (!dbAvailable) return;

    const REC_A = `test-fy-rec-a-${run}`;

    const userId = await insertTestUser("test-fy-" + run + "-affinity");

    await db
      .insert(recordingsTable)
      .values({ mbid: REC_A, title: "Track A", artist: "Artist Alpha" })
      .onConflictDoNothing();

    const [stA] = await db
      .insert(stationsTable)
      .values({
        slug: "test-fy-sta-" + run,
        name: "Station A " + run,
        streamUrl: "http://a.test",
        streamFormat: "mp3",
        active: true,
        clickcount: 100,
        votes: 50,
      })
      .returning({ id: stationsTable.id });

    const [stB] = await db
      .insert(stationsTable)
      .values({
        slug: "test-fy-stb-" + run,
        name: "Station B " + run,
        streamUrl: "http://b.test",
        streamFormat: "mp3",
        active: true,
        clickcount: 10,
        votes: 5,
      })
      .returning({ id: stationsTable.id });

    const stationAId = stA!.id;
    const stationBId = stB!.id;

    await db
      .insert(spinsTable)
      .values({
        stationId: stationAId,
        mbid: REC_A,
        rawTitle: "Track A",
        rawArtist: "Artist Alpha",
        confidence: "text",
        playedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(libraryItemsTable)
      .values({
        userId,
        mbid: REC_A,
        provenance: { kind: "import" },
      })
      .onConflictDoNothing();

    const loreUser = {
      id: userId,
      spotifyUserId: "test-fy-" + run + "-affinity",
      spotifyConnectionId: null,
      createdAt: new Date(),
    };
    await computeUserSourceAffinity(userId, "station");

    // Tier-3 (followed-picker affinity) must be 0 until a follow graph lands.
    // Verify the precomputed column is always 0 at this stage.
    const affinityCheck = await db.execute<{
      co_picker_count: number;
    }>(sql`
      SELECT co_picker_count
      FROM user_source_affinity
      WHERE user_id = ${userId} AND source_type = 'station'
    `);
    for (const row of affinityCheck.rows) {
      expect(row.co_picker_count).toBe(0);
    }

    const result = await getForYouStations(loreUser);
    expect(result.cold_start).toBe(false);

    const allItems =
      result.genre_poles.find((p) => p.genre === "all")?.items ??
      result.genre_poles.flatMap((p) => p.items);

    const stationAItem = allItems.find(
      (i) => i.slug === "test-fy-sta-" + run,
    );
    expect(stationAItem).toBeTruthy();
    expect(stationAItem?.overlap?.overlap_count).toBe(1);
    expect(stationAItem?.overlap?.overlapping_artists).toContain(
      "Artist Alpha",
    );

    const slugs = allItems.map((i) => i.slug);
    const idxA = slugs.indexOf("test-fy-sta-" + run);
    const idxB = slugs.indexOf("test-fy-stb-" + run);
    if (idxA !== -1 && idxB !== -1) {
      expect(idxA).toBeLessThan(idxB);
    }

    // Cleanup — delete child rows before recordings (FK order)
    await db
      .delete(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    await db.execute(
      sql`delete from spins where station_id in (${stationAId}, ${stationBId})`,
    );
    await db.execute(
      sql`delete from user_source_affinity where user_id = ${userId}`,
    );
    await db
      .delete(stationsTable)
      .where(eq(stationsTable.id, stationAId));
    await db
      .delete(stationsTable)
      .where(eq(stationsTable.id, stationBId));
    await db
      .delete(recordingsTable)
      .where(eq(recordingsTable.mbid, REC_A));
  });
});

describe("computeUserSourceAffinity + getForYouBlogs", () => {
  it("ranks blogs with overlap above those without", async () => {
    if (!dbAvailable) return;

    const REC_C = `test-fy-rec-c-${run}`;

    const userId = await insertTestUser("test-fy-" + run + "-blog");

    await db
      .insert(recordingsTable)
      .values({ mbid: REC_C, title: "Track C", artist: "Artist Gamma" })
      .onConflictDoNothing();

    const [pkA] = await db
      .insert(pickersTable)
      .values({
        pickerType: "blog",
        name: "Blog A " + run,
        handle: "blog-a-" + run,
        trustTier: 2,
        active: true,
      })
      .returning({ id: pickersTable.id });

    const [pkB] = await db
      .insert(pickersTable)
      .values({
        pickerType: "blog",
        name: "Blog B " + run,
        handle: "blog-b-" + run,
        trustTier: 2,
        active: true,
      })
      .returning({ id: pickersTable.id });

    const pickerAId = pkA!.id;
    const pickerBId = pkB!.id;

    await db
      .insert(picksTable)
      .values({
        pickerId: pickerAId,
        mbid: REC_C,
        rawArtist: "Artist Gamma",
        rawTitle: "Track C",
        source: "blog_post",
        confidence: "text",
      })
      .onConflictDoNothing();

    await db
      .insert(libraryItemsTable)
      .values({
        userId,
        mbid: REC_C,
        provenance: { kind: "keep" },
      })
      .onConflictDoNothing();

    const loreUser = {
      id: userId,
      spotifyUserId: "test-fy-" + run + "-blog",
      spotifyConnectionId: null,
      createdAt: new Date(),
    };
    await computeUserSourceAffinity(userId, "picker");

    const result = await getForYouBlogs(loreUser);
    expect(result.cold_start).toBe(false);

    const allItems =
      result.genre_poles.find((p) => p.genre === "all")?.items ??
      result.genre_poles.flatMap((p) => p.items);

    const blogAItem = allItems.find((i) => i.handle === "blog-a-" + run);
    expect(blogAItem).toBeTruthy();
    expect(blogAItem?.overlap?.overlap_count).toBe(1);
    expect(blogAItem?.overlap?.overlapping_artists).toContain("Artist Gamma");
    expect(blogAItem?._tier2).toBe(1);

    const handles = allItems.map((i) => i.handle);
    const idxA = handles.indexOf("blog-a-" + run);
    const idxB = handles.indexOf("blog-b-" + run);
    if (idxA !== -1 && idxB !== -1) {
      expect(idxA).toBeLessThan(idxB);
    }

    // Cleanup — delete child rows before recordings (FK order)
    await db
      .delete(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    await db.execute(
      sql`delete from user_source_affinity where user_id = ${userId}`,
    );
    await db.delete(picksTable).where(eq(picksTable.pickerId, pickerAId));
    await db.delete(picksTable).where(eq(picksTable.pickerId, pickerBId));
    await db
      .delete(pickersTable)
      .where(eq(pickersTable.id, pickerAId));
    await db
      .delete(pickersTable)
      .where(eq(pickersTable.id, pickerBId));
    await db
      .delete(recordingsTable)
      .where(eq(recordingsTable.mbid, REC_C));
  });
});

describe("genre filter", () => {
  it("getForYouStations ?genre= filters cold-start stations to empty when no match", async () => {
    if (!dbAvailable) return;

    const userId = await insertTestUser("test-fy-" + run + "-gf");
    const loreUser = {
      id: userId,
      spotifyUserId: "test-fy-" + run + "-gf",
      spotifyConnectionId: null,
      createdAt: new Date(),
    };
    const result = await getForYouStations(loreUser, {
      genre: "nonexistent-genre-xyz",
    });
    expect(result.cold_start).toBe(true);
    for (const pole of result.genre_poles) {
      for (const item of pole.items) {
        expect(
          item.tags.map((t) => t.toLowerCase()).includes("nonexistent-genre-xyz"),
        ).toBe(true);
      }
    }
  });
});

describe("thin-genre enqueue (station discovery)", () => {
  it("calls fetchStationsByTag for each genre pole below MIN_SOURCES_PER_GENRE coverage", async () => {
    if (!dbAvailable) return;

    const { fetchStationsByTag } = await import(
      "../src/lore/radio-browser.js"
    );
    vi.mocked(fetchStationsByTag).mockClear();

    // Unique genre tag unlikely to match any existing station
    const rareGenre = `rare-genre-${run}`;
    const recId = `test-fy-rec-thin-${run}`;

    const userId = await insertTestUser(`test-fy-${run}-thin-enq`);

    await db
      .insert(recordingsTable)
      .values({ mbid: recId, title: "Thin Track", artist: "Thin Artist" })
      .onConflictDoNothing();

    const [stRow] = await db
      .insert(stationsTable)
      .values({
        slug: `thin-enq-st-${run}`,
        name: "Thin Enqueue Station",
        streamUrl: "http://thin-enq.test",
        streamFormat: "mp3",
        active: true,
        tags: [rareGenre],
        clickcount: 1,
        votes: 0,
      })
      .returning({ id: stationsTable.id });
    const stId = stRow!.id;

    await db.execute(
      sql`insert into spins (station_id, mbid, played_at) values (${stId}, ${recId}, now()) on conflict do nothing`,
    );
    await db
      .insert(libraryItemsTable)
      .values({
        userId,
        mbid: recId,
        provenance: { kind: "import" },
        addedAt: new Date(),
      })
      .onConflictDoNothing();

    const loreUser = {
      id: userId,
      spotifyUserId: `test-fy-${run}-thin-enq`,
      spotifyConnectionId: null,
      createdAt: new Date(),
    };

    await getForYouStations(loreUser);

    // Allow the non-blocking enqueue promise to settle
    await new Promise<void>((r) => setTimeout(r, 150));

    // The rare genre has only 1 source with overlap (<MIN_SOURCES_PER_GENRE=3)
    // → thin-genre detection should fire fetchStationsByTag for it
    expect(vi.mocked(fetchStationsByTag)).toHaveBeenCalledWith(rareGenre);

    // Cleanup
    await db
      .delete(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    await db.execute(sql`delete from user_source_affinity where user_id = ${userId}`);
    await db.execute(sql`delete from spins where station_id = ${stId}`);
    await db.delete(stationsTable).where(eq(stationsTable.id, stId));
    await db
      .delete(recordingsTable)
      .where(eq(recordingsTable.mbid, recId));
  });
});
