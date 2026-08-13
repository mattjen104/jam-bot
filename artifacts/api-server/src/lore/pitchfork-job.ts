import { db, recordingsTable, trackClaimsTable, libraryItemsTable } from "@workspace/db";
import { isNull, eq, and, isNotNull } from "drizzle-orm";
import { fetchPitchforkReview, PITCHFORK_HANDLE } from "./pitchfork.js";

/**
 * Background Pitchfork review pre-fetch job.
 *
 * Proactively fetches Pitchfork album reviews for every kept recording so
 * that the Album Investigation sheet shows real data on the first open,
 * rather than "Not yet indexed" (the fire-and-forget inline call only covers
 * the second open).
 *
 * Design notes:
 * - Targets only recordings present in library_items (kept by at least one
 *   listener) to stay focused on tracks people actually care about.
 * - Skips recordings that already have a pitchfork track_claim row.
 * - Bounded at MAX_PER_PASS recordings per run so a large library can't
 *   exhaust the DB connection pool or run for hours.
 * - Respects Pitchfork's implicit rate limit: 1 request / 2 s with ±500 ms
 *   jitter (averages ~2.25 s between requests → ~26 per minute).
 * - Runs once at boot (after a 15-minute warmup to let heavier boot work
 *   settle) and then every 24 hours.
 * - Idempotency is handled inside fetchPitchforkReview — a recording with an
 *   existing claim is skipped in O(1) via a DB lookup.
 */

const MAX_PER_PASS = 500;
const RATE_LIMIT_MS = 2_000;   // base delay between requests
const JITTER_MS = 500;          // ± random jitter added to each delay
const WARMUP_MS = 15 * 60 * 1_000; // 15 min after boot
const RUN_EVERY_MS = 24 * 60 * 60 * 1_000; // 24 hours

let started = false;
const timers: NodeJS.Timeout[] = [];

// ---------------------------------------------------------------------------
// Candidate query
// ---------------------------------------------------------------------------

/**
 * Return up to `limit` distinct recording MBIDs that:
 *  1. Appear in library_items (kept by at least one listener, not removed).
 *  2. Have a resolved recording row (mbid present in recordings table).
 *  3. Do NOT yet have a track_claims row with sourceHandle = 'pitchfork'.
 */
async function findUnchecked(limit: number): Promise<{ mbid: string }[]> {
  // Subquery approach: select distinct mbids from library_items that have a
  // recordings row but no pitchfork claim.  We use a LEFT JOIN to track_claims
  // filtered on the pitchfork handle and test for null to find the gap.
  const rows = await db
    .selectDistinct({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .innerJoin(
      recordingsTable,
      eq(libraryItemsTable.mbid, recordingsTable.mbid),
    )
    .leftJoin(
      trackClaimsTable,
      and(
        eq(trackClaimsTable.mbid, libraryItemsTable.mbid),
        eq(trackClaimsTable.sourceHandle, PITCHFORK_HANDLE),
      ),
    )
    .where(
      and(
        isNull(libraryItemsTable.removedAt),
        isNotNull(libraryItemsTable.mbid),
        isNull(trackClaimsTable.id), // no pitchfork claim yet
      ),
    )
    .limit(limit);

  return rows;
}

// ---------------------------------------------------------------------------
// Per-pass runner
// ---------------------------------------------------------------------------

async function runPass(): Promise<void> {
  let candidates: { mbid: string }[];
  try {
    candidates = await findUnchecked(MAX_PER_PASS);
  } catch (err) {
    console.warn("[lore] pitchfork-job: candidate query failed:", err);
    return;
  }

  if (candidates.length === 0) return;

  console.info(
    `[lore] pitchfork-job: pre-fetching reviews for ${candidates.length} recording(s)`,
  );

  let fetched = 0;
  let stored = 0;

  for (const { mbid } of candidates) {
    try {
      const saved = await fetchPitchforkReview(mbid, null);
      if (saved) stored++;
      fetched++;
    } catch (err) {
      console.warn("[lore] pitchfork-job: fetch failed for", mbid, err);
    }

    // Rate-limit: 1 req / 2 s ± 500 ms jitter
    const delay = RATE_LIMIT_MS + Math.floor((Math.random() * 2 - 1) * JITTER_MS);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  console.info(
    `[lore] pitchfork-job: pass complete — ${fetched} attempted, ${stored} new claims stored`,
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Start the background Pitchfork pre-fetch job. Idempotent — safe to call once at boot. */
export function startPitchforkJob(): void {
  if (started) return;
  started = true;

  const warmup = setTimeout(() => {
    void runPass();
    const interval = setInterval(() => void runPass(), RUN_EVERY_MS);
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(warmup);

  console.info("[lore] pitchfork pre-fetch job scheduled (15 min warmup, 24 h interval)");
}

/** Stop the job (tests / graceful shutdown). */
export function stopPitchforkJob(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
