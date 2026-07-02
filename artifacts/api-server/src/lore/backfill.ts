import { db, stationsTable, type Station } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getHistoryAdapter, supportsBackfill } from "./adapters.js";
import { ingestRawSpins } from "./resolve.js";
import type { RawSpin } from "./types.js";

/**
 * Deep-history backfill job — the slow archaeologist next to the live poller.
 *
 * Live polling only ever moves FORWARD from `lastSeenCursor`; this job walks
 * BACKWARD from `backfillCursor` (the ISO airdate of the oldest play already
 * ingested), one budgeted slice per tick, for every station whose source
 * supports time-anchored history (`FetchRecentOptions.before` — KEXP's
 * `airdate_before`). Each slice:
 *
 *   fetch plays strictly older than the cursor → ingest (backfill mode: no
 *   live-cursor writes, no link enrichment) → move the cursor to the oldest
 *   play of the slice → persist it.
 *
 * Because the cursor is persisted after every slice, the walk is resumable
 * across restarts and interruptions — it never loses its place or re-walks
 * ingested history (re-fetched boundary plays dedup by externalId).
 *
 * Budget honesty: modern KEXP plays carry `recording_id`, so most resolutions
 * are free; older eras lack it and fall to the cached text-resolution path,
 * whose hit/miss cache is what keeps MusicBrainz under 1 req/sec. Slices run
 * strictly one at a time (self-rescheduling, never overlapping intervals) and
 * the floor bounds total depth.
 */

// One slice per tick. A slice is one API page; resolution dominates the time.
const SLICE_PAGE_SIZE = 50;
// Pause between slices — slow and steady; years accumulate in days.
const TICK_MS = 60_000;
// Let boot (seed + live-poll catch-up) settle before the first slice.
const WARMUP_MS = 90_000;

/**
 * Don't walk past this date. Bounds DB growth while still reaching "years,
 * not days"; overridable per deployment.
 */
function backfillFloor(): Date {
  const raw = process.env["LORE_BACKFILL_FLOOR"];
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  return new Date("2020-01-01T00:00:00Z");
}

let started = false;
let timer: NodeJS.Timeout | null = null;

/** Oldest playedAt in a batch, or null when none carry a timestamp. */
export function oldestPlayedAt(spins: RawSpin[]): Date | null {
  let oldest: Date | null = null;
  for (const s of spins) {
    if (s.playedAt && (!oldest || s.playedAt < oldest)) oldest = s.playedAt;
  }
  return oldest;
}

/**
 * Compute the next cursor after a slice. If the source handed back plays but
 * the oldest airdate did not move (all-duplicate boundary page), nudge one
 * second older so the walk can never wedge in place.
 */
export function nextCursor(
  previous: string | null,
  batchOldest: Date | null,
): string | null {
  if (!batchOldest) return null;
  const iso = batchOldest.toISOString();
  if (previous && iso >= previous) {
    return new Date(batchOldest.getTime() - 1000).toISOString();
  }
  return iso;
}

/** Run ONE backfill slice for one station. Returns spins ingested. */
async function backfillSlice(stationId: number): Promise<number> {
  // Reload for the freshest cursor (this job is the only writer, but restarts
  // and multi-instance safety are cheap here).
  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, stationId))
    .limit(1);
  if (!station || station.backfillDone) return 0;

  const history = getHistoryAdapter(station.nowPlayingSource);
  if (!history || !supportsBackfill(station.nowPlayingSource)) return 0;

  const cursor = station.backfillCursor ?? new Date().toISOString();
  const floor = backfillFloor();
  if (new Date(cursor) <= floor) {
    await markDone(station, "reached floor");
    return 0;
  }

  let batch: RawSpin[];
  try {
    batch = await history(station.nowPlayingConfig ?? {}, {
      limit: SLICE_PAGE_SIZE,
      before: cursor,
    });
  } catch (err) {
    console.error("[lore] backfill fetch failed", station.slug, err);
    return 0; // transient — the next tick retries from the same cursor
  }

  if (!batch.length) {
    await markDone(station, "source history exhausted");
    return 0;
  }

  const logged = await ingestRawSpins(
    station,
    batch,
    station.nowPlayingSource ?? "unknown",
    { backfill: true },
  );

  const advanced = nextCursor(station.backfillCursor, oldestPlayedAt(batch));
  if (advanced) {
    await db
      .update(stationsTable)
      .set({ backfillCursor: advanced })
      .where(eq(stationsTable.id, station.id));
  }
  if (logged > 0) {
    console.info(
      `[lore] backfill ${station.slug}: +${logged} spin(s), cursor → ${advanced ?? cursor}`,
    );
  }
  return logged;
}

async function markDone(station: Station, why: string): Promise<void> {
  await db
    .update(stationsTable)
    .set({ backfillDone: true })
    .where(eq(stationsTable.id, station.id));
  console.info(`[lore] backfill ${station.slug} complete (${why})`);
}

/** One tick: a single slice for each backfillable, unfinished station. */
async function tick(stationIds: number[]): Promise<void> {
  for (const id of stationIds) {
    try {
      await backfillSlice(id);
    } catch (err) {
      console.error("[lore] backfill slice failed", id, err);
    }
  }
}

/**
 * Start the backfill job. Idempotent — safe to call once at boot. Slices are
 * strictly sequential: the next tick is scheduled only after the previous one
 * finishes, so a slow MusicBrainz stretch never stacks concurrent walks.
 */
export async function startBackfillJob(): Promise<void> {
  if (started) return;
  started = true;

  let ids: number[];
  try {
    const rows = await db
      .select({
        id: stationsTable.id,
        source: stationsTable.nowPlayingSource,
        done: stationsTable.backfillDone,
      })
      .from(stationsTable);
    ids = rows
      .filter((r) => supportsBackfill(r.source) && !r.done)
      .map((r) => r.id);
  } catch (err) {
    console.error("[lore] backfill could not load stations; not started", err);
    started = false;
    return;
  }

  if (!ids.length) {
    console.info("[lore] backfill: no eligible stations");
    // Not a terminal state — leave the job restartable so an operational DB
    // change (new station, reset flag) can start it in-process later.
    started = false;
    return;
  }
  console.info(`[lore] backfill job started for ${ids.length} station(s)`);

  const loop = async (): Promise<void> => {
    await tick(ids);
    if (started) timer = setTimeout(() => void loop(), TICK_MS);
  };
  timer = setTimeout(() => void loop(), WARMUP_MS);
}

/** Stop the backfill job (tests / graceful shutdown). */
export function stopBackfillJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
