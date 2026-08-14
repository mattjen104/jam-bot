import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { applyCollegeTagMigration } from "../src/lore/college-tag-migration.js";

/**
 * Integration tests for applyCollegeTagMigration.
 *
 * Verifies that:
 *   - radio_browser stations whose name matches university/college patterns are
 *     tagged "college" by the migration (including "Campus Radio" / "Campus FM"
 *     variants that require the `\s+` regex to work correctly in SQL).
 *   - Running the migration twice is idempotent — the tag is not duplicated.
 *   - Stations whose names do not match are left unchanged.
 *   - Curated (source="curated") stations are never touched, even when their
 *     name would otherwise match.
 */

const run = randomUUID().slice(0, 8);

// Unique slugs scoped to this test run.
const SLUG_UNIVERSITY = `test-college-university-${run}`;
const SLUG_CAMPUS_RADIO = `test-college-campus-radio-${run}`;
const SLUG_CAMPUS_FM = `test-college-campus-fm-${run}`;
const SLUG_PLAIN = `test-college-plain-${run}`;
const SLUG_CURATED = `test-college-curated-${run}`;
const ALL_SLUGS = [
  SLUG_UNIVERSITY,
  SLUG_CAMPUS_RADIO,
  SLUG_CAMPUS_FM,
  SLUG_PLAIN,
  SLUG_CURATED,
];

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Seed five stations: two should be tagged, two should not, one curated.
  await db.insert(stationsTable).values([
    {
      slug: SLUG_UNIVERSITY,
      name: `WVUM University of Miami Radio ${run}`,
      streamUrl: "https://example.com/stream1",
      source: "radio_browser",
      tags: ["alternative"],
    },
    {
      // "Campus Radio" — the regex case that requires \\s+ to work in SQL.
      slug: SLUG_CAMPUS_RADIO,
      name: `CFUV Campus Radio ${run}`,
      streamUrl: "https://example.com/stream2",
      source: "radio_browser",
      tags: null,
    },
    {
      // "Campus FM" variant.
      slug: SLUG_CAMPUS_FM,
      name: `Student Campus FM ${run}`,
      streamUrl: "https://example.com/stream3",
      source: "radio_browser",
      tags: ["indie"],
    },
    {
      // Plain community station — must not be tagged.
      slug: SLUG_PLAIN,
      name: `City Radio ${run}`,
      streamUrl: "https://example.com/stream4",
      source: "radio_browser",
      tags: ["community"],
    },
    {
      // Curated row whose name contains "college" — must never be touched
      // by the radio_browser-scoped migration.
      slug: SLUG_CURATED,
      name: `College Hill Radio ${run}`,
      streamUrl: "https://example.com/stream5",
      source: "curated",
      tags: ["community"],
    },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(stationsTable).where(inArray(stationsTable.slug, ALL_SLUGS));
});

describe("applyCollegeTagMigration (DB)", () => {
  it("tags radio_browser stations whose name contains 'university'", async () => {
    if (!dbAvailable) return;
    await applyCollegeTagMigration();

    const [row] = await db
      .select({ tags: stationsTable.tags })
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUG_UNIVERSITY));
    expect(row?.tags).toContain("college");
    // Existing tags must be preserved.
    expect(row?.tags).toContain("alternative");
  });

  it("tags radio_browser stations whose name contains 'Campus Radio'", async () => {
    if (!dbAvailable) return;
    // Migration already ran above; station should already be tagged.
    const [row] = await db
      .select({ tags: stationsTable.tags })
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUG_CAMPUS_RADIO));
    expect(row?.tags).toContain("college");
  });

  it("tags radio_browser stations whose name contains 'Campus FM'", async () => {
    if (!dbAvailable) return;
    const [row] = await db
      .select({ tags: stationsTable.tags })
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUG_CAMPUS_FM));
    expect(row?.tags).toContain("college");
    expect(row?.tags).toContain("indie");
  });

  it("does not tag radio_browser stations whose name does not match", async () => {
    if (!dbAvailable) return;
    const [row] = await db
      .select({ tags: stationsTable.tags })
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUG_PLAIN));
    const tags: string[] = Array.isArray(row?.tags) ? (row.tags as string[]) : [];
    expect(tags).not.toContain("college");
  });

  it("does not touch curated stations even when their name matches", async () => {
    if (!dbAvailable) return;
    const [row] = await db
      .select({ tags: stationsTable.tags })
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUG_CURATED));
    const tags: string[] = Array.isArray(row?.tags) ? (row.tags as string[]) : [];
    expect(tags).not.toContain("college");
  });

  it("is idempotent — running twice does not duplicate the college tag", async () => {
    if (!dbAvailable) return;
    await applyCollegeTagMigration();

    const [row] = await db
      .select({ tags: stationsTable.tags })
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUG_UNIVERSITY));
    const tags: string[] = Array.isArray(row?.tags) ? (row.tags as string[]) : [];
    const collegeCount = tags.filter((t) => t === "college").length;
    expect(collegeCount).toBe(1);
  });
});
