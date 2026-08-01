/**
 * Stage-2 list extraction worker.
 *
 * Stage 1 (blog.ts) detects year-end/best-of posts in RSS feeds and queues
 * them in `blog_list_candidates` (status=pending). This worker consumes that
 * queue off the poller hot path: it fetches each flagged post, runs the
 * existing LLM list scraper (list-scraper.ts), resolves entries to
 * MusicBrainz release groups, and files everything into the
 * lists/list_entries provenance model attributed to the source publisher.
 *
 * Design constraints:
 *  - Fully automatic: exact matches auto-confirm; fuzzy/unresolved wait in
 *    the existing admin review queue (list_entries confirm flow).
 *  - Idempotent by post URL: a post whose URL already backs a list is
 *    skipped, so re-polling the same feed never re-scrapes or duplicates.
 *  - Fail loudly: extraction failures (fetch error, LLM error, zero entries)
 *    mark the candidate `failed` with a per-post note visible in admin, and
 *    a failed post can be retried from admin (status reset to pending or a
 *    direct retry call).
 *  - Bounded cost: only flagged candidates ever reach the LLM, at most
 *    MAX_PER_CYCLE per cycle and DAILY_CAP per rolling day, so a misfiring
 *    detector can never flood the scraper.
 */

import {
  db,
  blogListCandidatesTable,
  listsTable,
  listEntriesTable,
  listSourcesTable,
  pickersTable,
  type BlogListCandidate,
} from "@workspace/db";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { scrapeAndPopulateList } from "./list-scraper.js";
import { wireListExtractor } from "./list-wire.js";

// Process at most this many candidates per cycle.
export const MAX_PER_CYCLE = 2;
// Hard cap on LLM extractions per rolling 24h — guard against a misfiring
// detector flooding the scraper.
export const DAILY_CAP = 12;
// Cycle every 15 minutes; wait out boot before the first cycle.
const CYCLE_MS = 15 * 60 * 1000;
const WARMUP_MS = 3 * 60 * 1000;

// ---- Pure helpers (unit-tested; no DB / network) -----------------------

export interface ListMeta {
  year: number | null;
  kind: "year_end" | "mid_year" | "decade" | "all_time" | "genre" | "custom";
  isRanked: boolean;
}

/**
 * Derive list metadata (year, kind, rankedness) from a post title like
 * "The 50 Best Albums of 2026 So Far" or "Album of the Year: Top 25 of 2025".
 * Pure heuristic — wrong guesses are harmless (metadata only, correctable).
 */
export function parseListMeta(title: string, publishedAt?: Date | null): ListMeta {
  const t = title.toLowerCase();

  // Year: prefer an explicit 19xx/20xx in the title, else the publish year.
  const yearMatch = title.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  let year = yearMatch ? parseInt(yearMatch[1]!, 10) : null;

  let kind: ListMeta["kind"] = "custom";
  if (/\ball[\s-]?time\b|\bever\b/.test(t)) {
    kind = "all_time";
    year = null;
  } else if (/\bdecade\b|\b(19[5-9]0|20[0-4]0)s\b/.test(t)) {
    kind = "decade";
  } else if (/so far|mid[\s-]?year|halfway|half of/.test(t)) {
    kind = "mid_year";
    if (year == null && publishedAt) year = publishedAt.getUTCFullYear();
  } else if (
    /year[\s-]?end|of the year\b|\baoty\b/.test(t) ||
    // "Year in Music/Review 2024" — NME, Pitchfork, Consequence of Sound
    /\byear\s+in\s+(music|review|albums|songs|tracks|culture)\b/.test(t) ||
    // "Albums/Songs of 2024" without "the year" — Under the Radar, etc.
    /\b(albums|songs|tracks|records|releases)\s+of\s+(?:19[5-9]\d|20[0-4]\d)\b/.test(t) ||
    (yearMatch != null && /\bbest\b|\btop\b|\bfavorite|\bfavourite/.test(t))
  ) {
    kind = "year_end";
    if (year == null && publishedAt) year = publishedAt.getUTCFullYear();
  }

  // Ranked when the title advertises a count ("Top 25", "50 Best").
  const isRanked = /\btop\s+\d+|\b\d+\s+(best|greatest|essential|favorite|favourite)/.test(t);

  return { year, kind, isRanked };
}

// ---- DB plumbing --------------------------------------------------------

/** Find or create the publication list source for a blog picker. */
async function ensureListSource(pickerId: number): Promise<number | null> {
  const [existing] = await db
    .select({ id: listSourcesTable.id })
    .from(listSourcesTable)
    .where(eq(listSourcesTable.pickerId, pickerId))
    .orderBy(asc(listSourcesTable.id))
    .limit(1);
  if (existing) return existing.id;

  const [picker] = await db
    .select({ name: pickersTable.name, homeUrl: pickersTable.homeUrl })
    .from(pickersTable)
    .where(eq(pickersTable.id, pickerId))
    .limit(1);
  if (!picker) return null;

  const [created] = await db
    .insert(listSourcesTable)
    .values({
      kind: "publication",
      name: picker.name,
      pickerId,
      homepageUrl: picker.homeUrl ?? null,
    })
    .returning({ id: listSourcesTable.id });
  return created?.id ?? null;
}

export interface CandidateOutcome {
  status: "extracted" | "failed" | "skipped";
  note: string;
  listId: number | null;
}

// In-process claim guard: prevents the periodic worker and the admin retry
// endpoint (or an overlapping slow cycle) from processing the same candidate
// concurrently, which would double LLM spend and could duplicate list rows.
const inFlight = new Set<number>();

/**
 * Process one list candidate end-to-end. Never throws.
 * Caller is responsible for persisting the outcome onto the candidate row
 * (see runListCandidateCycle / the admin retry endpoint).
 */
export async function processListCandidate(
  candidate: Pick<
    BlogListCandidate,
    "id" | "pickerId" | "url" | "title" | "publishedAt"
  >,
  contact: string,
): Promise<CandidateOutcome> {
  if (inFlight.has(candidate.id)) {
    return {
      status: "skipped",
      note: "already being processed (concurrent request)",
      listId: null,
    };
  }
  inFlight.add(candidate.id);
  try {
    // Idempotency by post URL: if any list already points at this URL, the
    // post has been extracted (possibly via another picker's feed or the
    // manual admin flow) — never re-scrape or duplicate.
    const [existingList] = await db
      .select({ id: listsTable.id })
      .from(listsTable)
      .where(eq(listsTable.url, candidate.url))
      .limit(1);
    if (existingList) {
      return {
        status: "skipped",
        note: `already extracted as list #${existingList.id}`,
        listId: existingList.id,
      };
    }

    const sourceId = await ensureListSource(candidate.pickerId);
    if (!sourceId) {
      return {
        status: "failed",
        note: "could not resolve a list source for this picker",
        listId: null,
      };
    }

    const meta = parseListMeta(candidate.title, candidate.publishedAt);
    const [listRow] = await db
      .insert(listsTable)
      .values({
        sourceId,
        title: candidate.title,
        year: meta.year,
        kind: meta.kind,
        isRanked: meta.isRanked,
        url: candidate.url,
        retrievedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [listsTable.sourceId, listsTable.title, listsTable.year],
        set: { url: candidate.url, retrievedAt: new Date() },
      })
      .returning({ id: listsTable.id });
    if (!listRow) {
      return { status: "failed", note: "failed to upsert list row", listId: null };
    }

    const result = await scrapeAndPopulateList(listRow.id, candidate.url, contact);

    if (result.error || result.total === 0) {
      // Fail loudly, never silently produce an empty list: remove the list
      // row if nothing landed in it so the UI never shows a hollow list.
      const [{ n }] = (
        await db.execute(
          sql`SELECT COUNT(*)::int AS n FROM list_entries WHERE list_id = ${listRow.id}`,
        )
      ).rows as Array<{ n: number }>;
      if (n === 0) {
        await db.delete(listsTable).where(eq(listsTable.id, listRow.id));
      }
      return {
        status: "failed",
        note: result.error ?? "no entries extracted",
        listId: n === 0 ? null : listRow.id,
      };
    }

    // Record the real extracted length on the list row.
    await db
      .update(listsTable)
      .set({ listLength: result.total })
      .where(eq(listsTable.id, listRow.id));

    return {
      status: "extracted",
      note: `${result.total} entries: ${result.resolved} exact, ${result.fuzzy} fuzzy, ${result.unresolved} unresolved`,
      listId: listRow.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", note: msg, listId: null };
  } finally {
    inFlight.delete(candidate.id);
  }
}

/** Persist a worker outcome onto the candidate row. */
export async function writeCandidateOutcome(
  candidateId: number,
  outcome: CandidateOutcome,
): Promise<void> {
  await db
    .update(blogListCandidatesTable)
    .set({
      status: outcome.status,
      note: outcome.note,
      processedAt: new Date(),
    })
    .where(eq(blogListCandidatesTable.id, candidateId));
}

/** How many candidates were processed in the last rolling 24h. */
async function processedInLastDay(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blogListCandidatesTable)
    .where(gte(blogListCandidatesTable.processedAt, since));
  return row?.n ?? 0;
}

/**
 * One worker cycle: pick up to MAX_PER_CYCLE pending candidates (oldest
 * first) and process them sequentially, respecting the daily cap. Never
 * throws. Exported for the admin retry path and tests.
 */
let cycleRunning = false;

export async function runListCandidateCycle(): Promise<void> {
  if (cycleRunning) return; // never overlap a slow cycle with the next tick
  cycleRunning = true;
  try {
    await runListCandidateCycleInner();
  } finally {
    cycleRunning = false;
  }
}

async function runListCandidateCycleInner(): Promise<void> {
  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (!contact) return; // scraping needs a MB contact for the UA

  const used = await processedInLastDay();
  if (used >= DAILY_CAP) {
    return; // budget exhausted — pending rows simply wait for tomorrow
  }
  const budget = Math.min(MAX_PER_CYCLE, DAILY_CAP - used);

  const pending = await db
    .select({
      id: blogListCandidatesTable.id,
      pickerId: blogListCandidatesTable.pickerId,
      url: blogListCandidatesTable.url,
      title: blogListCandidatesTable.title,
      publishedAt: blogListCandidatesTable.publishedAt,
    })
    .from(blogListCandidatesTable)
    .where(eq(blogListCandidatesTable.status, "pending"))
    .orderBy(asc(blogListCandidatesTable.id))
    .limit(budget);
  if (pending.length === 0) return;

  // The LLM seam is wired lazily; if the integration is unavailable the
  // candidates stay pending (retried next cycle) rather than failing.
  const ready = await wireListExtractor();
  if (!ready) {
    console.warn("[list-candidates] LLM extractor unavailable; leaving candidates pending");
    return;
  }

  for (const c of pending) {
    const outcome = await processListCandidate(c, contact);
    await writeCandidateOutcome(c.id, outcome).catch((e) =>
      console.error("[list-candidates] outcome write failed", c.id, e),
    );
    console.info(
      `[list-candidates] #${c.id} "${c.title}" → ${outcome.status}: ${outcome.note}`,
    );
  }
}

// ---- Lifecycle -----------------------------------------------------------

let started = false;
const timers: NodeJS.Timeout[] = [];

/** Start the periodic extraction worker. Idempotent; never crashes boot. */
export function startListCandidateWorker(): void {
  if (started) return;
  started = true;
  const kickoff = setTimeout(() => {
    void runListCandidateCycle().catch((e) =>
      console.error("[list-candidates] cycle failed", e),
    );
    const interval = setInterval(
      () =>
        void runListCandidateCycle().catch((e) =>
          console.error("[list-candidates] cycle failed", e),
        ),
      CYCLE_MS,
    );
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(kickoff);
  console.info(
    `[lore] list-candidate extraction worker scheduled (warmup ${WARMUP_MS / 1000}s, cycle ${CYCLE_MS / 60000}min, ≤${MAX_PER_CYCLE}/cycle, ≤${DAILY_CAP}/day)`,
  );
}

/** Stop the worker (tests / graceful shutdown). */
export function stopListCandidateWorker(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}

/**
 * Admin-triggered backfill: process up to `limit` pending candidates
 * immediately, bypassing the rolling DAILY_CAP. Designed for first-run
 * batches after a new publication cohort is enrolled (e.g. AOTY import).
 * Never throws.
 */
export async function runListCandidateBatch(limit: number): Promise<{
  processed: number;
  outcomes: Array<{ id: number; title: string; status: string; note: string }>;
}> {
  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (!contact) {
    return { processed: 0, outcomes: [] };
  }

  const pending = await db
    .select({
      id: blogListCandidatesTable.id,
      pickerId: blogListCandidatesTable.pickerId,
      url: blogListCandidatesTable.url,
      title: blogListCandidatesTable.title,
      publishedAt: blogListCandidatesTable.publishedAt,
    })
    .from(blogListCandidatesTable)
    .where(eq(blogListCandidatesTable.status, "pending"))
    .orderBy(asc(blogListCandidatesTable.id))
    .limit(Math.min(limit, 50)); // absolute cap: never more than 50 at once

  if (pending.length === 0) return { processed: 0, outcomes: [] };

  const ready = await wireListExtractor();
  if (!ready) return { processed: 0, outcomes: [] };

  const outcomes: Array<{ id: number; title: string; status: string; note: string }> = [];
  for (const c of pending) {
    const outcome = await processListCandidate(c, contact);
    await writeCandidateOutcome(c.id, outcome).catch((e) =>
      console.error("[list-candidates] batch outcome write failed", c.id, e),
    );
    outcomes.push({ id: c.id, title: c.title, status: outcome.status, note: outcome.note });
  }

  console.info(`[list-candidates] admin batch: processed ${outcomes.length} candidates`);
  return { processed: outcomes.length, outcomes };
}
