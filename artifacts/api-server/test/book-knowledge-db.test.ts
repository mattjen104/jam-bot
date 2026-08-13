import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import {
  ingestBookSource,
  BOOK_SOURCE_HANDLE,
  type BookSource,
} from "../src/lore/book-knowledge.js";

// DB-backed tests for curated book-fact ingestion: idempotency, the spine
// guard, publication gating (draft demotion without a link), and the
// original-summary rejection path.

const run = randomUUID().slice(0, 8);
const onSpineMbid = `test-book-knowledge-${run}`;
const slugPrefix = `test-book-${run}`;
let dbAvailable = false;

function makeSource(overrides: Partial<BookSource> = {}): BookSource {
  return {
    slug: `${slugPrefix}-a`,
    title: "Test Book",
    author: "Test Author",
    sourceUrl: "https://www.worldcat.org/title/test-book",
    facts: [
      {
        mbid: onSpineMbid,
        coverageLevel: "recording",
        text: "A short original summary of a recording fact for testing.",
        status: "published",
      },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await db.insert(recordingsTable).values({
      mbid: onSpineMbid,
      title: `Book Knowledge Track ${run}`,
      artist: `Book Knowledge Artist ${run}`,
    });
    dbAvailable = true;
  } catch {
    // DB-backed suites may skip when DATABASE_URL is absent.
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db
    .delete(trackClaimsTable)
    .where(like(trackClaimsTable.externalId, `book:${slugPrefix}%`));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, onSpineMbid));
});

describe("ingestBookSource", () => {
  it("inserts a grounded fact once, then dedups on re-ingest (idempotent)", async () => {
    if (!dbAvailable) return;
    const source = makeSource({ slug: `${slugPrefix}-idem` });

    const first = await ingestBookSource(source);
    expect(first.inserted).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await ingestBookSource(source);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);

    const rows = await db
      .select()
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.externalId, `book:${slugPrefix}-idem:0`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceHandle).toBe(BOOK_SOURCE_HANDLE);
    expect(rows[0]!.sourceLabel).toBe("Test Book — Test Author");
    expect(rows[0]!.sourceUrl).toBe("https://www.worldcat.org/title/test-book");
    expect(rows[0]!.status).toBe("published");
  });

  it("skips facts whose recording is not on the spine (never plants rows)", async () => {
    if (!dbAvailable) return;
    const ghostMbid = `test-book-ghost-${run}`;
    const source = makeSource({
      slug: `${slugPrefix}-ghost`,
      facts: [
        {
          mbid: ghostMbid,
          coverageLevel: "recording",
          text: "A fact about a recording Lore has never seen.",
          status: "published",
        },
      ],
    });

    const result = await ingestBookSource(source);
    expect(result.notOnSpine).toBe(1);
    expect(result.inserted).toBe(0);

    const rows = await db
      .select()
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.mbid, ghostMbid));
    expect(rows).toHaveLength(0);
  });

  it("demotes published-intent facts to draft when the book link is unavailable", async () => {
    if (!dbAvailable) return;
    const source = makeSource({
      slug: `${slugPrefix}-nolink`,
      sourceUrl: null,
    });

    const result = await ingestBookSource(source);
    expect(result.inserted).toBe(1);
    expect(result.demotedNoLink).toBe(1);

    const [row] = await db
      .select()
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.externalId, `book:${slugPrefix}-nolink:0`));
    expect(row).toBeDefined();
    // Never published without its grounding link.
    expect(row!.status).toBe("draft");
  });

  it("rejects text that fails the original-summary guard and stores nothing", async () => {
    if (!dbAvailable) return;
    const source = makeSource({
      slug: `${slugPrefix}-verbatim`,
      facts: [
        {
          mbid: onSpineMbid,
          coverageLevel: "recording",
          // Chapter-length text — the shape of a copied excerpt.
          text: "prose ".repeat(120),
          status: "published",
        },
      ],
    });

    const result = await ingestBookSource(source);
    expect(result.rejectedSummary).toBe(1);
    expect(result.inserted).toBe(0);

    const rows = await db
      .select()
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.externalId, `book:${slugPrefix}-verbatim:0`));
    expect(rows).toHaveLength(0);
  });

  it("draft facts stay draft and are not surfaced by the published-claims filter", async () => {
    if (!dbAvailable) return;
    const source = makeSource({
      slug: `${slugPrefix}-draft`,
      facts: [
        {
          mbid: onSpineMbid,
          coverageLevel: "album",
          text: "An album-level fact awaiting admin review.",
          status: "draft",
        },
      ],
    });

    const result = await ingestBookSource(source);
    expect(result.inserted).toBe(1);

    // Mirror the knowledge endpoint's published-only query.
    const publishedRows = await db
      .select()
      .from(trackClaimsTable)
      .where(
        and(
          eq(trackClaimsTable.mbid, onSpineMbid),
          eq(trackClaimsTable.status, "published"),
          eq(trackClaimsTable.externalId, `book:${slugPrefix}-draft:0`),
        ),
      );
    expect(publishedRows).toHaveLength(0);
  });
});
