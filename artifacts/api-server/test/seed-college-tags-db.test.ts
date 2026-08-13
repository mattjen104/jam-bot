import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { seedStations } from "../src/lore/seed.js";
import { deriveStationCategories, toStation } from "../src/routes/lore/shared.js";

/**
 * Regression test for seed-tag propagation to already-deployed rows.
 *
 * The /college dial filter depends on `tags: ["college"]` reaching the public
 * `stationCategories` payload. On a pre-existing deployment the stations rows
 * already exist, so the seed's INSERT values never apply — the upsert's
 * UPDATE set must merge the seed tags in, or `/college` silently returns
 * nothing on every environment that predates the tag (the exact gap flagged
 * in code review).
 *
 * Also guards the merge semantics: operator-added tags in the DB must
 * survive the merge (set union, not overwrite), and stations whose seed
 * entry declares no tags must keep their stored tags untouched.
 *
 * Runs against the real seed rows (canonical data, not fixtures) and restores
 * what it changes. Self-skips without a real DB.
 */

const COLLEGE_SLUG = "wprb"; // seeded with tags: ["college"]
const NO_TAG_SLUG = "kexp"; // seed entry declares no tags

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

describe("college tag propagation to existing rows", () => {
  it(
    "re-running the seed adds the college tag to a pre-existing row that lacks it",
    { timeout: 120_000 },
    async () => {
      if (!dbAvailable) return;
      // Simulate a deployment that predates the college tag: the row exists
      // but its tags column is NULL.
      await db
        .update(stationsTable)
        .set({ tags: null })
        .where(eq(stationsTable.slug, COLLEGE_SLUG));

      await seedStations();

      const [row] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, COLLEGE_SLUG))
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.tags).toContain("college");

      // The public payload must now carry the college category label.
      const cats = deriveStationCategories(row!);
      expect(cats).toContain("college");
      expect(toStation(row!).stationCategories).toContain("college");
    },
  );

  it(
    "merging preserves operator-added tags (union, not overwrite)",
    { timeout: 120_000 },
    async () => {
      if (!dbAvailable) return;
      // Operator hand-added a tag in the DB that the seed knows nothing about.
      await db
        .update(stationsTable)
        .set({ tags: ["operator-custom", "college"] })
        .where(eq(stationsTable.slug, COLLEGE_SLUG));

      await seedStations();

      const [row] = await db
        .select({ tags: stationsTable.tags })
        .from(stationsTable)
        .where(eq(stationsTable.slug, COLLEGE_SLUG))
        .limit(1);
      expect(row?.tags).toContain("college");
      expect(row?.tags).toContain("operator-custom");
      // No duplicates from the union.
      expect(row?.tags?.filter((t) => t === "college")).toHaveLength(1);

      // Restore the canonical seed state (just the seed's own tags).
      await db
        .update(stationsTable)
        .set({ tags: ["college"] })
        .where(eq(stationsTable.slug, COLLEGE_SLUG));
    },
  );

  it(
    "a seed entry without tags leaves stored operator tags untouched",
    { timeout: 120_000 },
    async () => {
      if (!dbAvailable) return;
      const [before] = await db
        .select({ tags: stationsTable.tags })
        .from(stationsTable)
        .where(eq(stationsTable.slug, NO_TAG_SLUG))
        .limit(1);
      const originalTags = before?.tags ?? null;

      await db
        .update(stationsTable)
        .set({ tags: ["operator-only"] })
        .where(eq(stationsTable.slug, NO_TAG_SLUG));

      await seedStations();

      const [row] = await db
        .select({ tags: stationsTable.tags })
        .from(stationsTable)
        .where(eq(stationsTable.slug, NO_TAG_SLUG))
        .limit(1);
      // Seed declares no tags for this station → stored value must survive.
      expect(row?.tags).toEqual(["operator-only"]);

      // Restore.
      await db
        .update(stationsTable)
        .set({ tags: originalTags })
        .where(eq(stationsTable.slug, NO_TAG_SLUG));
    },
  );
});
