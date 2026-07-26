import { db, stationsTable, type Station } from "@workspace/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import {
  leaseStationWatcher,
  releaseStationLease,
  pickWatcherStreamUrl,
  isLeasedStation,
} from "./poller.js";

/**
 * Crossing-score socket leasing — the second half of the hybrid connection
 * budget. Favorites pin persistent ICY watchers; whatever is left of the
 * connection budget is leased, on a rotating ~20-minute cycle, to the
 * non-favorite ICY stations most likely to play music from the library.
 *
 * Score = recency-decayed count of "crossings": spins on that station whose
 * MBID appears in anyone's library (shared pool — per-listener crossings are
 * computable downstream off the same spin feed). Exponential decay with a
 * 14-day half-life means a station that crossed three times last week
 * outranks one that crossed ten times two months ago; stations dry for the
 * whole 60-day window score 0 and stay on interval polling.
 *
 * Favorites are never evicted by leasing: the allocator only ever fills
 * `budget - pinned` slots. Promotion/demotion goes through the poller's
 * lease functions, which reuse the enroll/unenroll paths — so a demoted
 * station is back on interval polling in the same tick (no logging gap) and
 * a promoted one upgrades live without a restart.
 */

/** Total persistent-connection budget (favorites + leases). */
export const CONNECTION_BUDGET = (() => {
  const raw = Number(process.env["LORE_CONNECTION_BUDGET"]);
  return Number.isInteger(raw) && raw > 0 ? raw : 40;
})();

/** Lease hold / re-evaluation cadence. */
export const LEASE_CYCLE_MS = 20 * 60_000;

/** Spins older than this never count — a long-dry station ages out fully. */
const CROSSING_WINDOW_DAYS = 60;

/** Exponential decay half-life for crossing recency, in days. */
const DECAY_HALF_LIFE_DAYS = 14;

/** Delay before the first evaluation after boot (let pollers settle). */
const FIRST_EVAL_DELAY_MS = 30_000;

export interface ScoredStation {
  stationId: number;
  slug: string;
  name: string;
  /** Recency-decayed crossing score (unitless; higher = hotter). */
  score: number;
  /** Raw crossing count inside the window, for admin display. */
  crossings: number;
}

export interface LeaseInfo {
  stationId: number;
  slug: string;
  name: string;
  score: number;
  crossings: number;
  leasedAt: string;
  expiresAt: string;
}

/**
 * Pure allocator: pick the station ids that should hold leases. Top `slots`
 * scorers with a strictly positive score, in score order. Exported for tests.
 */
export function pickLeaseTargets(
  scored: ScoredStation[],
  slots: number,
): ScoredStation[] {
  if (slots <= 0) return [];
  return [...scored]
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.stationId - b.stationId)
    .slice(0, slots);
}

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

const activeLeases = new Map<number, LeaseInfo>();
let timer: NodeJS.Timeout | null = null;
let nextEvaluationAt: Date | null = null;
let evaluating = false;

/**
 * Score every non-favorite, non-hidden, active radio_browser_icy station by
 * recency-decayed library crossings over the last CROSSING_WINDOW_DAYS.
 * Stations with no usable stream URL are filtered afterwards (the mounts
 * shape lives in jsonb; cheaper to filter in JS on this small result set).
 */
export async function scoreCrossingCandidates(): Promise<ScoredStation[]> {
  const rows = await db.execute(sql`
    SELECT
      st.id                                   AS station_id,
      st.slug                                 AS slug,
      st.name                                 AS name,
      st.now_playing_config                   AS config,
      count(*)::int                           AS crossings,
      sum(
        exp(
          -ln(2)
          * extract(epoch FROM (now() - s.played_at))
          / (86400.0 * ${DECAY_HALF_LIFE_DAYS})
        )
      )::float8                               AS score
    FROM spins s
    JOIN stations st ON st.id = s.station_id
    WHERE st.now_playing_source = 'radio_browser_icy'
      AND st.active = true
      AND st.hidden = false
      AND st.favorite = false
      AND s.mbid IS NOT NULL
      AND s.played_at > now() - make_interval(days => ${CROSSING_WINDOW_DAYS})
      AND s.mbid IN (SELECT DISTINCT mbid FROM library_items)
    GROUP BY st.id, st.slug, st.name, st.now_playing_config
    ORDER BY score DESC
  `);
  const out: ScoredStation[] = [];
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const config = (r["config"] ?? {}) as Record<string, unknown>;
    if (!pickWatcherStreamUrl(config)) continue; // no persistent-capable mount
    out.push({
      stationId: Number(r["station_id"]),
      slug: String(r["slug"]),
      name: String(r["name"]),
      score: Number(r["score"]),
      crossings: Number(r["crossings"]),
    });
  }
  return out;
}

/** Count pinned favorites (ICY favorites that hold persistent sockets). */
async function countPinnedFavorites(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.favorite, true),
        eq(stationsTable.hidden, false),
        eq(stationsTable.nowPlayingSource, "radio_browser_icy"),
      ),
    );
  return row?.n ?? 0;
}

/**
 * One lease cycle: recompute scores, fill budget-minus-favorites slots with
 * the top scorers, demote lost leases (back to interval polling, no gap) and
 * promote new ones live. Never throws — a failed cycle keeps current leases
 * and retries next tick.
 */
export async function evaluateLeases(): Promise<void> {
  if (evaluating) return; // guard against overlapping cycles
  evaluating = true;
  try {
    const [pinned, scored] = await Promise.all([
      countPinnedFavorites(),
      scoreCrossingCandidates(),
    ]);
    const slots = Math.max(0, CONNECTION_BUDGET - pinned);
    const targets = pickLeaseTargets(scored, slots);
    const targetIds = new Set(targets.map((t) => t.stationId));

    // Demotions first — free the sockets before dialing new ones.
    const demoteIds = [...activeLeases.keys()].filter(
      (id) => !targetIds.has(id),
    );
    if (demoteIds.length > 0) {
      const demoteRows = await db
        .select()
        .from(stationsTable)
        .where(inArray(stationsTable.id, demoteIds));
      const byId = new Map(demoteRows.map((s) => [s.id, s]));
      for (const id of demoteIds) {
        const station = byId.get(id);
        if (station) releaseStationLease(station);
        activeLeases.delete(id);
      }
    }

    // Promotions / renewals. A lease whose watcher persistently failed since
    // the last cycle is no longer held by the poller — re-promote it rather
    // than renewing a dead entry.
    const promoteIds = targets
      .filter(
        (t) => !(activeLeases.has(t.stationId) && isLeasedStation(t.stationId)),
      )
      .map((t) => t.stationId);
    const promoteRows: Station[] = promoteIds.length
      ? await db
          .select()
          .from(stationsTable)
          .where(inArray(stationsTable.id, promoteIds))
      : [];
    const promoteById = new Map(promoteRows.map((s) => [s.id, s]));

    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEASE_CYCLE_MS).toISOString();
    for (const t of targets) {
      const existing = activeLeases.get(t.stationId);
      if (existing && isLeasedStation(t.stationId)) {
        // Renewal — keep leasedAt, refresh score + expiry.
        activeLeases.set(t.stationId, {
          ...existing,
          score: t.score,
          crossings: t.crossings,
          expiresAt,
        });
        continue;
      }
      const station = promoteById.get(t.stationId);
      if (!station) {
        activeLeases.delete(t.stationId);
        continue;
      }
      if (!leaseStationWatcher(station)) {
        activeLeases.delete(t.stationId);
        continue;
      }
      activeLeases.set(t.stationId, {
        stationId: t.stationId,
        slug: t.slug,
        name: t.name,
        score: t.score,
        crossings: t.crossings,
        leasedAt: now.toISOString(),
        expiresAt,
      });
    }

    console.info(
      `[lore:leases] cycle: ${pinned} pinned, ${activeLeases.size}/${slots} leased ` +
        `(budget ${CONNECTION_BUDGET}, ${scored.length} scored candidates)`,
    );
  } catch (err) {
    console.error("[lore:leases] lease evaluation failed", err);
  } finally {
    nextEvaluationAt = new Date(Date.now() + LEASE_CYCLE_MS);
    evaluating = false;
  }
}

/** Start the rotating lease scheduler. Idempotent. */
export function startLeaseScheduler(): void {
  if (timer) return;
  nextEvaluationAt = new Date(Date.now() + FIRST_EVAL_DELAY_MS);
  const kickoff = setTimeout(() => {
    void evaluateLeases();
    timer = setInterval(() => void evaluateLeases(), LEASE_CYCLE_MS);
  }, FIRST_EVAL_DELAY_MS);
  timer = kickoff;
}

/** Stop the scheduler and forget lease state (tests / shutdown). */
export function stopLeaseScheduler(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  nextEvaluationAt = null;
  activeLeases.clear();
}

/**
 * Snapshot for the admin allocation view. The poller's lease set is the
 * source of truth: an admin flag flip (hide/favorite) or a persistent socket
 * failure drops the lease in the poller immediately, so entries the poller no
 * longer holds are pruned here rather than waiting for the next cycle —
 * keeping the endpoint consistent with live state.
 */
export function getLeaseAllocation(): {
  budget: number;
  leases: LeaseInfo[];
  nextEvaluationAt: string | null;
} {
  for (const id of [...activeLeases.keys()]) {
    if (!isLeasedStation(id)) activeLeases.delete(id);
  }
  return {
    budget: CONNECTION_BUDGET,
    leases: [...activeLeases.values()].sort((a, b) => b.score - a.score),
    nextEvaluationAt: nextEvaluationAt ? nextEvaluationAt.toISOString() : null,
  };
}
