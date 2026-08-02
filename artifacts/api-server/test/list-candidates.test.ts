// @vitest-environment node
/**
 * Stage-2 list extraction worker tests.
 *
 * Pure tests cover parseListMeta (title → year/kind/ranked heuristics).
 * DB tests (guarded by dbAvailable) cover the full processListCandidate flow
 * with a stubbed fetch (post page + MusicBrainz) and an injected fake LLM
 * extractor:
 *   - success: entries extracted, resolved, list + entries created,
 *     exact matches auto-confirmed, listLength recorded
 *   - idempotency: a candidate whose URL already backs a list is skipped
 *   - empty extraction fails loudly and leaves no hollow list row
 *   - fetch failure fails loudly with the error in the note
 *   - writeCandidateOutcome persists status/note/processedAt
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";

import {
  db,
  pickersTable,
  listsTable,
  listEntriesTable,
  listSourcesTable,
  blogListCandidatesTable,
} from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";

import {
  parseListMeta,
  processListCandidate,
  writeCandidateOutcome,
} from "../src/lore/list-candidates.js";
import { configureListExtractor, resetListExtractor } from "../src/lore/list-llm.js";

// ---------------------------------------------------------------------------
// parseListMeta — pure
// ---------------------------------------------------------------------------

describe("parseListMeta", () => {
  it("detects a ranked year-end list with explicit year", () => {
    const m = parseListMeta("The 50 Best Albums of 2026");
    expect(m).toEqual({ year: 2026, kind: "year_end", isRanked: true });
  });

  it("detects a mid-year list and falls back to the publish year", () => {
    const m = parseListMeta(
      "The Best Albums of the Year So Far",
      new Date("2026-06-15T00:00:00Z"),
    );
    expect(m.kind).toBe("mid_year");
    expect(m.year).toBe(2026);
  });

  it("detects an all-time list and clears the year", () => {
    const m = parseListMeta("The 100 Greatest Metal Albums of All Time");
    expect(m.kind).toBe("all_time");
    expect(m.year).toBeNull();
    expect(m.isRanked).toBe(true);
  });

  it("detects AOTY phrasing as year_end", () => {
    const m = parseListMeta(
      "Album of the Year: Our Favorites",
      new Date("2025-12-10T00:00:00Z"),
    );
    expect(m.kind).toBe("year_end");
    expect(m.year).toBe(2025);
  });

  it("treats an unranked roundup without a count as unranked custom", () => {
    const m = parseListMeta("Albums We Loved This Month");
    expect(m.kind).toBe("custom");
    expect(m.isRanked).toBe(false);
  });

  it("detects Top N phrasing as ranked", () => {
    const m = parseListMeta("Top 25 Jazz Records of 2025");
    expect(m.isRanked).toBe(true);
    expect(m.kind).toBe("year_end");
    expect(m.year).toBe(2025);
  });
});

// ---------------------------------------------------------------------------
// DB-backed flow
// ---------------------------------------------------------------------------

let dbAvailable = false;
let pickerId = -1;
const HANDLE = `list-cand-test-${Date.now()}`;
const RUN = Date.now();
const CONTACT = "test-suite/1.0";
const createdListIds: number[] = [];

const realFetch = globalThis.fetch;

/** MB search JSON for a hit; score decides exact vs fuzzy vs unresolved. */
function mbResponse(score: number, mbid: string): Response {
  return new Response(
    JSON.stringify({
      "release-groups": [
        { id: mbid, title: "Some Album", score, "primary-type": "Album" },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  const [ins] = await db
    .insert(pickersTable)
    .values({
      pickerType: "blog",
      name: "List Candidate Test Blog",
      handle: HANDLE,
      homeUrl: "https://list-cand-test.example",
      sourceRef: { feedUrl: "https://list-cand-test.example/feed" },
      trustTier: 2,
      active: true,
    })
    .returning({ id: pickersTable.id });
  pickerId = ins!.id;
});

afterAll(async () => {
  resetListExtractor();
  vi.unstubAllGlobals();
  if (!dbAvailable || pickerId < 0) return;
  if (createdListIds.length > 0) {
    await db
      .delete(listsTable)
      .where(inArray(listsTable.id, createdListIds))
      .catch(() => {});
  }
  await db
    .delete(blogListCandidatesTable)
    .where(eq(blogListCandidatesTable.pickerId, pickerId))
    .catch(() => {});
  await db
    .delete(listSourcesTable)
    .where(eq(listSourcesTable.pickerId, pickerId))
    .catch(() => {});
  await db.delete(pickersTable).where(eq(pickersTable.id, pickerId)).catch(() => {});
});

/** Stub fetch: serve the fake post page + MusicBrainz; pass through the rest. */
function stubFetch(routes: {
  pageHtml?: string | null;
  mbScores?: Record<string, { score: number; mbid: string }>;
}): void {
  vi.stubGlobal(
    "fetch",
    (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("list-cand-test.example")) {
        if (routes.pageHtml == null) {
          throw new Error("connection refused (test)");
        }
        return new Response(routes.pageHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.includes("musicbrainz.org")) {
        for (const [needle, r] of Object.entries(routes.mbScores ?? {})) {
          if (decodeURIComponent(url).toLowerCase().includes(needle.toLowerCase())) {
            return mbResponse(r.score, r.mbid);
          }
        }
        return new Response(JSON.stringify({ "release-groups": [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch,
  );
}

async function makeCandidate(suffix: string, title: string) {
  const [row] = await db
    .insert(blogListCandidatesTable)
    .values({
      pickerId,
      guid: `guid-${suffix}-${Date.now()}`,
      url: `https://list-cand-test.example/posts/${RUN}-${suffix}`,
      title,
      publishedAt: new Date("2026-06-01T00:00:00Z"),
    })
    .returning();
  return row!;
}

describe("processListCandidate", () => {
  it("extracts, resolves, and files a list with auto-confirmed exact entries", async () => {
    if (!dbAvailable) return;

    const candidate = await makeCandidate("ok", "The 2 Best Albums of 2026");
    stubFetch({
      pageHtml:
        "<html><body><h1>The 2 Best Albums of 2026</h1><ol><li>Alpha Band — First Album</li><li>Beta Group — Second Album</li></ol></body></html>",
      mbScores: {
        "Alpha Band": { score: 100, mbid: "mbid-alpha-rg" },
        "Beta Group": { score: 40, mbid: "mbid-beta-rg" },
      },
    });
    configureListExtractor(async () =>
      JSON.stringify([
        { rank: 1, artist: "Alpha Band", album: "First Album" },
        { rank: 2, artist: "Beta Group", album: "Second Album" },
      ]),
    );

    const outcome = await processListCandidate(candidate, CONTACT);
    expect(outcome.status).toBe("extracted");
    expect(outcome.listId).not.toBeNull();
    createdListIds.push(outcome.listId!);

    const [list] = await db
      .select()
      .from(listsTable)
      .where(eq(listsTable.id, outcome.listId!))
      .limit(1);
    expect(list!.url).toBe(candidate.url);
    expect(list!.year).toBe(2026);
    expect(list!.kind).toBe("year_end");
    expect(list!.listLength).toBe(2);

    // Attribution: source is a publication tied to the picker.
    const [src] = await db
      .select()
      .from(listSourcesTable)
      .where(eq(listSourcesTable.id, list!.sourceId))
      .limit(1);
    expect(src!.pickerId).toBe(pickerId);
    expect(src!.kind).toBe("publication");

    const entries = await db
      .select()
      .from(listEntriesTable)
      .where(eq(listEntriesTable.listId, outcome.listId!));
    expect(entries.length).toBe(2);
    const exact = entries.find((e) => e.rawArtist === "Alpha Band")!;
    expect(exact.confidence).toBe("exact");
    expect(exact.confirmed).toBe(true);
    expect(exact.sourceUrl).toBe(candidate.url);
    expect(exact.scrapedAt).toBeInstanceOf(Date);
    expect(exact.extraction).toBe("llm");
    const weak = entries.find((e) => e.rawArtist === "Beta Group")!;
    expect(weak.confidence).toBe("unresolved");
    expect(weak.confirmed).toBe(false);
  }, 30_000);

  it("skips a candidate whose URL already backs a list (idempotent re-poll)", async () => {
    if (!dbAvailable) return;

    const candidate = await makeCandidate("ok", "The 2 Best Albums of 2026 (duplicate feed)");
    // Same URL as the first test's candidate — override url explicitly.
    await db
      .update(blogListCandidatesTable)
      .set({ url: `https://list-cand-test.example/posts/${RUN}-ok` })
      .where(eq(blogListCandidatesTable.id, candidate.id));
    candidate.url = `https://list-cand-test.example/posts/${RUN}-ok`;

    const extractorSpy = vi.fn(async () => "[]");
    configureListExtractor(extractorSpy);

    const outcome = await processListCandidate(candidate, CONTACT);
    expect(outcome.status).toBe("skipped");
    expect(outcome.note).toMatch(/already extracted/);
    // Never re-scraped: the LLM was not called.
    expect(extractorSpy).not.toHaveBeenCalled();
  });

  it("fails loudly on empty extraction and leaves no hollow list row", async () => {
    if (!dbAvailable) return;

    const candidate = await makeCandidate("empty", "Best Albums of 2026: The Slideshow");
    stubFetch({ pageHtml: "<html><body>slideshow requires javascript</body></html>" });
    configureListExtractor(async () => "[]");

    const outcome = await processListCandidate(candidate, CONTACT);
    expect(outcome.status).toBe("failed");
    expect(outcome.note).toMatch(/No entries extracted/i);
    expect(outcome.listId).toBeNull();

    // No hollow list left behind for this URL.
    const rows = await db
      .select({ id: listsTable.id })
      .from(listsTable)
      .where(eq(listsTable.url, candidate.url));
    expect(rows.length).toBe(0);
  });

  it("rejects concurrent processing of the same candidate (in-flight guard)", async () => {
    if (!dbAvailable) return;

    const candidate = await makeCandidate("race", "The 2 Best Albums of 2026 (race)");
    stubFetch({
      pageHtml:
        "<html><body><ol><li>Alpha Band — First Album</li></ol></body></html>",
      mbScores: { "Alpha Band": { score: 100, mbid: "mbid-alpha-rg" } },
    });
    configureListExtractor(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return JSON.stringify([{ rank: 1, artist: "Alpha Band", album: "First Album" }]);
    });

    const [a, b] = await Promise.all([
      processListCandidate(candidate, CONTACT),
      processListCandidate(candidate, CONTACT),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["extracted", "skipped"]);
    const skipped = a.status === "skipped" ? a : b;
    expect(skipped.note).toMatch(/being processed/);
    const extracted = a.status === "extracted" ? a : b;
    createdListIds.push(extracted.listId!);
  }, 30_000);

  it("fails loudly when the post page fetch errors", async () => {
    if (!dbAvailable) return;

    const candidate = await makeCandidate("down", "Top 10 Albums of 2026");
    stubFetch({ pageHtml: null });
    configureListExtractor(async () => "[]");

    const outcome = await processListCandidate(candidate, CONTACT);
    expect(outcome.status).toBe("failed");
    expect(outcome.note.length).toBeGreaterThan(0);
    expect(outcome.listId).toBeNull();
  });
});

describe("writeCandidateOutcome", () => {
  it("persists status, note, and processedAt onto the candidate row", async () => {
    if (!dbAvailable) return;

    const candidate = await makeCandidate("outcome", "Best of 2026 Outcome Test");
    await writeCandidateOutcome(candidate.id, {
      status: "failed",
      note: "HTTP 500",
      listId: null,
    });

    const [row] = await db
      .select()
      .from(blogListCandidatesTable)
      .where(eq(blogListCandidatesTable.id, candidate.id))
      .limit(1);
    expect(row!.status).toBe("failed");
    expect(row!.note).toBe("HTTP 500");
    expect(row!.processedAt).not.toBeNull();
  });
});
