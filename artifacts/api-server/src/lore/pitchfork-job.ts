import { db, recordingsTable, trackClaimsTable, libraryItemsTable } from "@workspace/db";
import { isNull, eq, and, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
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
 * - Runs once at boot (after a warmup delay that accounts for the last run
 *   timestamp so frequent restarts don't accumulate multiple passes) and
 *   then every 24 hours.
 * - Idempotency is handled inside fetchPitchforkReview — a recording with an
 *   existing claim is skipped in O(1) via a DB lookup.
 * - Restart-safety: the job writes its start timestamp to the `job_timestamps`
 *   table before the first request.  On restart, if a pass started within the
 *   last 24 h the boot warmup is replaced by the remaining time until the next
 *   scheduled pass, preventing rate-limit bursts during deployment windows.
 */

const MAX_PER_PASS = 500;
const RATE_LIMIT_MS = 2_000;   // base delay between requests
const JITTER_MS = 500;          // ± random jitter added to each delay
const WARMUP_MS = 15 * 60 * 1_000; // 15 min after boot (first-ever run)
const RUN_EVERY_MS = 24 * 60 * 60 * 1_000; // 24 hours

/** Stable key used in job_timestamps to track this job. */
const JOB_KEY = "pitchfork-pass";

let started = false;
const timers: NodeJS.Timeout[] = [];

// ---------------------------------------------------------------------------
// DB-backed last-run timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Read the timestamp of the most recent Pitchfork pass start from the DB.
 * Returns null if the job has never run or the table doesn't exist yet.
 */
async function getLastRunAt(): Promise<Date | null> {
  try {
    const rows = await db.execute<{ last_ran_at: string }>(sql`
      SELECT last_ran_at FROM job_timestamps WHERE key = ${JOB_KEY}
    `);
    if (rows.rows.length === 0) return null;
    return new Date(rows.rows[0].last_ran_at);
  } catch {
    // Table may not exist yet on a brand-new deployment — degrade safely.
    return null;
  }
}

/**
 * Record the current time as the Pitchfork pass start.  Called at the
 * beginning of each pass so that a mid-pass restart sees a recent timestamp
 * and skips an immediate re-run.
 */
async function setLastRunAt(): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO job_timestamps (key, last_ran_at)
      VALUES (${JOB_KEY}, now())
      ON CONFLICT (key) DO UPDATE SET last_ran_at = now()
    `);
  } catch (err) {
    console.warn("[lore] pitchfork-job: failed to record last_ran_at:", err);
  }
}

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
  // Record the pass start timestamp before the first request so that a
  // mid-pass server restart sees a recent timestamp and skips re-running.
  await setLastRunAt();

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

/**
 * Calculate the warmup delay for the first pass.
 *
 * If the job ran within the last 24 h (e.g. before a restart), returns the
 * remaining time until the 24 h boundary — preventing a duplicate pass burst.
 * If the job has never run, returns the standard 15-minute warmup.
 * Always enforces a 30-second minimum so the first async DB read finishes
 * before the timer fires.
 */
async function computeFirstDelay(): Promise<number> {
  const MIN_DELAY_MS = 30_000; // never fire sooner than 30 s after boot
  const lastRan = await getLastRunAt();

  if (lastRan !== null) {
    const msSinceLastRun = Date.now() - lastRan.getTime();
    if (msSinceLastRun < RUN_EVERY_MS) {
      // A pass already started within the 24 h window.  Wait for the remainder
      // of that window rather than running a full new pass immediately.
      const remaining = RUN_EVERY_MS - msSinceLastRun;
      console.info(
        `[lore] pitchfork-job: last pass was ${Math.round(msSinceLastRun / 60_000)} min ago — ` +
        `deferring next pass by ${Math.round(remaining / 60_000)} min to avoid burst`,
      );
      return Math.max(MIN_DELAY_MS, remaining);
    }
  }

  // No recent pass — use the standard 15-minute boot warmup.
  return WARMUP_MS;
}

/** Start the background Pitchfork pre-fetch job. Idempotent — safe to call once at boot. */
export function startPitchforkJob(): void {
  if (started) return;
  started = true;

  // Compute the first-pass delay asynchronously so we can consult the DB.
  void (async () => {
    const firstDelay = await computeFirstDelay();

    const warmup = setTimeout(() => {
      void runPass();
      const interval = setInterval(() => void runPass(), RUN_EVERY_MS);
      timers.push(interval);
    }, firstDelay);
    timers.push(warmup);

    const delayMin = Math.round(firstDelay / 60_000);
    console.info(
      `[lore] pitchfork pre-fetch job scheduled (first pass in ${delayMin} min, 24 h interval)`,
    );
  })();
}

/** Stop the job (tests / graceful shutdown). */
export function stopPitchforkJob(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
