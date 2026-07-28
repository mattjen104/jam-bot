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
 *
 * Show-scoped scoring: when a station has a currently-airing scraped_show
 * (determined via stations.iana_timezone), crossings are restricted to spins
 * that played during that show's recurring weekly time window. This means the
 * lease scorer ranks on the active show's catalogue affinity, not a 30-DJ
 * station average. Stations without schedule data or no currently-airing show
 * fall back to the station-wide score.
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
  /**
   * DJ name of the currently-airing scraped_show, when the score was
   * narrowed to that show's recurring time window. Undefined for
   * station-wide fallback scores.
   */
  activeDj?: string;
  /** Whether this score was narrowed to the active show's time window. */
  scopedToShow?: boolean;
}

export interface LeaseInfo {
  stationId: number;
  slug: string;
  name: string;
  score: number;
  crossings: number;
  leasedAt: string;
  expiresAt: string;
  /** DJ name of the show that was airing when this lease was evaluated. */
  activeDj?: string;
  /** True when the crossing score was narrowed to the active show's window. */
  scopedToShow?: boolean;
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
 *
 * When a station has a currently-airing scraped_show (resolved via
 * stations.iana_timezone), the crossing score is narrowed to spins that
 * played during that show's recurring weekly time window — so we rank on the
 * active DJ's catalogue affinity, not a station-wide average across all
 * hosts. Stations without timezone data or no matching show at the current
 * wall-clock time fall back to the unscoped station-wide score.
 *
 * Stations with no usable stream URL are filtered afterwards (the mounts
 * shape lives in jsonb; cheaper to filter in JS on this small result set).
 */
export async function scoreCrossingCandidates(): Promise<ScoredStation[]> {
  // Run both queries in parallel: station-wide (always) + show-scoped
  // (only for stations with a currently-airing scraped_show).
  const [stationRows, showRows] = await Promise.all([
    // ── Station-wide fallback ──────────────────────────────────────────────
    db.execute(sql`
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
    `),

    // ── Show-scoped score ──────────────────────────────────────────────────
    // Find each station's currently-airing scraped_show, then restrict
    // historical spins to the recurring weekly time window for that show.
    // Uses DISTINCT ON to pick exactly one show per station (in case two
    // rows overlap at the boundary minute).
    db.execute(sql`
      WITH currently_airing AS (
        SELECT DISTINCT ON (ss.station_id)
          ss.station_id,
          ss.dj_name,
          ss.day_of_week,
          ss.start_time,
          ss.end_time
        FROM scraped_shows ss
        JOIN stations st ON st.id = ss.station_id
        WHERE st.iana_timezone IS NOT NULL
          AND to_char(now() AT TIME ZONE st.iana_timezone, 'Dy')
                = ss.day_of_week
          AND to_char(now() AT TIME ZONE st.iana_timezone, 'HH24:MI')
                >= ss.start_time
          AND to_char(now() AT TIME ZONE st.iana_timezone, 'HH24:MI')
                < ss.end_time
        ORDER BY ss.station_id, ss.start_time
      )
      SELECT
        st.id                                   AS station_id,
        st.slug                                 AS slug,
        st.name                                 AS name,
        st.now_playing_config                   AS config,
        ca.dj_name                              AS active_dj,
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
      JOIN currently_airing ca ON ca.station_id = st.id
      WHERE st.now_playing_source = 'radio_browser_icy'
        AND st.active = true
        AND st.hidden = false
        AND st.favorite = false
        AND s.mbid IS NOT NULL
        AND s.played_at > now() - make_interval(days => ${CROSSING_WINDOW_DAYS})
        AND s.mbid IN (SELECT DISTINCT mbid FROM library_items)
        AND to_char(
              s.played_at AT TIME ZONE st.iana_timezone,
              'Dy'
            ) = ca.day_of_week
        AND to_char(
              s.played_at AT TIME ZONE st.iana_timezone,
              'HH24:MI'
            ) >= ca.start_time
        AND to_char(
              s.played_at AT TIME ZONE st.iana_timezone,
              'HH24:MI'
            ) < ca.end_time
      GROUP BY st.id, st.slug, st.name, st.now_playing_config, ca.dj_name
      ORDER BY score DESC
    `),
  ]);

  // Build a map of show-scoped results; skip zero-crossing entries so a show
  // with no library history doesn't wipe out a useful station-wide score.
  const showScopedMap = new Map<
    number,
    { score: number; crossings: number; activeDj: string | null }
  >();
  for (const r of showRows.rows as Array<Record<string, unknown>>) {
    const id = Number(r["station_id"]);
    const crossings = Number(r["crossings"]);
    if (crossings > 0) {
      showScopedMap.set(id, {
        score: Number(r["score"]),
        crossings,
        activeDj: r["active_dj"] != null ? String(r["active_dj"]) : null,
      });
    }
  }

  const stationBase: ScoredStation[] = [];
  for (const r of stationRows.rows as Array<Record<string, unknown>>) {
    const config = (r["config"] ?? {}) as Record<string, unknown>;
    if (!pickWatcherStreamUrl(config)) continue; // no persistent-capable mount
    stationBase.push({
      stationId: Number(r["station_id"]),
      slug: String(r["slug"]),
      name: String(r["name"]),
      score: Number(r["score"]),
      crossings: Number(r["crossings"]),
    });
  }

  return mergeShowScoped(stationBase, showScopedMap);
}

/**
 * Merge show-scoped override scores onto station-wide base scores.
 *
 * When a station has a show-scoped entry with crossings > 0, its score and
 * crossing count are replaced by the show-scoped values and `scopedToShow` is
 * set. Stations absent from `showScopedMap` (or present with zero crossings)
 * keep their station-wide values unchanged.
 *
 * Exported for unit testing without a DB.
 */
export function mergeShowScoped(
  base: ScoredStation[],
  showScopedMap: ReadonlyMap<
    number,
    { score: number; crossings: number; activeDj: string | null }
  >,
): ScoredStation[] {
  return base.map((s) => {
    const scoped = showScopedMap.get(s.stationId);
    if (!scoped || scoped.crossings === 0) return s;
    return {
      ...s,
      score: scoped.score,
      crossings: scoped.crossings,
      scopedToShow: true,
      activeDj: scoped.activeDj ?? undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Follow-bonus multiplier
// ---------------------------------------------------------------------------

/**
 * Score multiplier applied when the currently-airing show's DJ name matches
 * a handle the user follows. The goal is to make a followed person's time
 * slot consistently win a lease during their broadcast.
 *
 * Value chosen empirically: 3× is large enough to beat a strong unfollowed
 * station (crossing score ~1–5) while not being so extreme that a brand-new
 * followed DJ with a single crossing dominates indefinitely.
 *
 * Set to 1 to disable without code changes (env-override not needed — this
 * path is currently dormant until the follow-graph DB table ships).
 */
export const FOLLOW_BONUS = 3;

/**
 * Apply a `FOLLOW_BONUS` multiplier to stations whose active show's DJ name
 * fuzzy-matches any handle in `followedDjNames`.
 *
 * Matching is case-insensitive and normalises runs of non-alphanumeric
 * characters to a single space so "DJ Snake", "dj-snake", and "djsnake" all
 * match each other. Only stations with `score > 0` receive the bonus — a
 * station with zero library crossings must earn a real crossing first.
 *
 * `followedDjNames` should contain lowercased normalised handles. Pass an
 * empty Set when the follow graph is unavailable (current default until the
 * `picker_follows` table ships).
 *
 * Exported for unit testing without a DB.
 */
export function applyFollowBonus(
  stations: ScoredStation[],
  followedDjNames: ReadonlySet<string>,
): ScoredStation[] {
  if (followedDjNames.size === 0) return stations;
  return stations.map((s) => {
    if (s.score <= 0 || !s.activeDj) return s;
    const normalised = normaliseDjName(s.activeDj);
    if (!followedDjNames.has(normalised)) return s;
    return { ...s, score: s.score * FOLLOW_BONUS };
  });
}

/** Lowercased, punctuation-collapsed name for fuzzy DJ handle matching. */
export function normaliseDjName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    // Apply follow-bonus before selecting lease targets so followed DJs win
    // slots during their broadcast. The follow graph doesn't exist in DB yet
    // (picker_follows table is a follow-up task), so we pass an empty set —
    // this is a no-op today but the wiring is in place for when follows land.
    const boosted = applyFollowBonus(scored, new Set());
    const targets = pickLeaseTargets(boosted, slots);
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
        // Renewal — keep leasedAt, refresh score + expiry + show scope.
        activeLeases.set(t.stationId, {
          ...existing,
          score: t.score,
          crossings: t.crossings,
          expiresAt,
          activeDj: t.activeDj,
          scopedToShow: t.scopedToShow,
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
        activeDj: t.activeDj,
        scopedToShow: t.scopedToShow,
      });
    }

    const showScopedCount = targets.filter((t) => t.scopedToShow).length;
    console.info(
      `[lore:leases] cycle: ${pinned} pinned, ${activeLeases.size}/${slots} leased ` +
        `(budget ${CONNECTION_BUDGET}, ${scored.length} scored candidates, ` +
        `${showScopedCount} show-scoped)`,
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
