import { db, stationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getHistoryAdapter, supportsBackfill } from "./adapters.js";
import { oldestPlayedAt } from "./backfill.js";
import { ingestRawSpins } from "./resolve.js";
import type { HistoryAdapter, RawSpin } from "./types.js";

/**
 * Nightly archive reconciliation — the auditor next to the live poller.
 *
 * Live polling captures spins as they happen, but a restart or outage leaves
 * permanent holes in a documented run. For sources that publish complete
 * time-anchored playlists (`supportsBackfill`, currently KEXP), the station's
 * own published record is the authority for the archive: once a day this job
 * re-reads the recent window (~48h) of that record and inserts anything the
 * poller missed. Dedup rides the existing station+externalId key, so
 * already-ingested spins cost one pre-filter query and nothing more.
 *
 * Deliberately NOT the backfill job: backfill walks ever deeper into history
 * behind a persisted cursor; reconciliation re-sweeps a fixed recent window
 * and keeps no state between sweeps. Reconciled spins keep full link
 * enrichment (the window is small) but never touch `lastSeenCursor` — that
 * belongs to the live poller alone.
 */

// How far back each sweep re-reads the published record.
const WINDOW_HOURS = 48;
// One sweep per day per station.
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
// Let boot (seed + live catch-up + backfill warmup) settle first.
const WARMUP_MS = 5 * 60 * 1000;
// Paging within a sweep: page size, polite pause between pages, and a hard
// page cap so a misbehaving source can never turn one sweep into a crawl.
const PAGE_SIZE = 50;
const PAGE_PAUSE_MS = 2_000;
const MAX_PAGES = 20;

let started = false;
let timer: NodeJS.Timeout | null = null;

/** Start of the reconciliation window: `hours` before `now`. */
export function windowStart(now: Date, hours: number = WINDOW_HOURS): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/**
 * Page a time-anchored history source backward from `now` until the batch
 * reaches `start` (a play at or older than the window edge), a page comes back
 * empty, the walk stops advancing, or the page cap trips. Returns only plays
 * INSIDE the window — the boundary play that proved we reached the edge is
 * older than the window and is dropped. Never throws; a failed page ends the
 * sweep with whatever was collected.
 */
export async function collectWindowPlays(
  history: HistoryAdapter,
  config: Record<string, unknown>,
  start: Date,
  now: Date,
  opts?: {
    pageSize?: number;
    maxPages?: number;
    pauseMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<RawSpin[]> {
  const pageSize = opts?.pageSize ?? PAGE_SIZE;
  const maxPages = opts?.maxPages ?? MAX_PAGES;
  const pauseMs = opts?.pauseMs ?? PAGE_PAUSE_MS;
  const sleep =
    opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const collected: RawSpin[] = [];
  let before = now.toISOString();
  for (let page = 0; page < maxPages; page++) {
    if (page > 0 && pauseMs > 0) await sleep(pauseMs);
    let batch: RawSpin[];
    try {
      batch = await history(config, { limit: pageSize, before });
    } catch (err) {
      console.error("[lore] reconcile page fetch failed", err);
      break;
    }
    if (!batch.length) break;

    collected.push(...batch.filter((s) => s.playedAt && s.playedAt >= start));

    const oldest = oldestPlayedAt(batch);
    // No timestamps at all — cannot anchor the walk; stop with what we have.
    if (!oldest) break;
    // Reached (or passed) the window edge — the record is covered.
    if (oldest <= start) break;

    // Advance strictly older; nudge 1s when a boundary page didn't move so the
    // walk can never wedge in place (same guard as the backfill cursor).
    const nextBefore =
      oldest.toISOString() < before
        ? oldest.toISOString()
        : new Date(oldest.getTime() - 1000).toISOString();
    before = nextBefore;
  }
  return collected;
}

/** One reconciliation sweep for one station. Returns spins inserted. */
async function sweepStation(stationId: number): Promise<number> {
  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, stationId))
    .limit(1);
  if (!station) return 0;

  const history = getHistoryAdapter(station.nowPlayingSource);
  if (!history || !supportsBackfill(station.nowPlayingSource)) return 0;

  const now = new Date();
  const start = windowStart(now);
  const plays = await collectWindowPlays(
    history,
    station.nowPlayingConfig ?? {},
    start,
    now,
  );
  if (!plays.length) {
    console.info(
      `[lore] reconcile ${station.slug}: window ${start.toISOString()}..${now.toISOString()}, fetched 0`,
    );
    return 0;
  }

  const inserted = await ingestRawSpins(
    station,
    plays,
    station.nowPlayingSource ?? "unknown",
    { reconcile: true },
  );
  console.info(
    `[lore] reconcile ${station.slug}: window ${start.toISOString()}..${now.toISOString()}, ` +
      `fetched ${plays.length}, inserted ${inserted}`,
  );
  return inserted;
}

/** One daily tick: sweep each eligible station, strictly sequentially. */
async function tick(stationIds: number[]): Promise<void> {
  for (const id of stationIds) {
    try {
      await sweepStation(id);
    } catch (err) {
      console.error("[lore] reconcile sweep failed", id, err);
    }
  }
}

/**
 * Start the reconciliation job. Idempotent — safe to call once at boot. Sweeps
 * are self-rescheduling (next tick only after the previous finishes), so a
 * slow resolution stretch never stacks concurrent sweeps.
 */
export async function startReconcileJob(): Promise<void> {
  if (started) return;
  started = true;

  let ids: number[];
  try {
    const rows = await db
      .select({ id: stationsTable.id, source: stationsTable.nowPlayingSource })
      .from(stationsTable);
    ids = rows.filter((r) => supportsBackfill(r.source)).map((r) => r.id);
  } catch (err) {
    console.error("[lore] reconcile could not load stations; not started", err);
    started = false;
    return;
  }

  if (!ids.length) {
    console.info("[lore] reconcile: no eligible stations");
    // Leave restartable so an operational DB change can start it in-process.
    started = false;
    return;
  }
  console.info(`[lore] reconcile job started for ${ids.length} station(s)`);

  const loop = async (): Promise<void> => {
    await tick(ids);
    if (started) timer = setTimeout(() => void loop(), SWEEP_EVERY_MS);
  };
  timer = setTimeout(() => void loop(), WARMUP_MS);
}

/** Stop the reconciliation job (tests / graceful shutdown). */
export function stopReconcileJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
