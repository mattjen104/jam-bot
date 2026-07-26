import { db, stationsTable, type Station } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getNowPlayingAdapter,
  getHistoryAdapter,
  isPollable,
} from "./adapters.js";
import { logSpinIfChanged, ingestRawSpins } from "./resolve.js";
import { IcyWatcher } from "./icy-watcher.js";
import type { HistoryAdapter, RawSpin, NowPlayingRaw } from "./types.js";
import {
  recordSpinitronWebResult,
  clearSpinitronWebState,
} from "./spinitron-web-health.js";
import {
  recordFeedFreshnessResult,
  clearFeedFreshnessState,
  getFeedFreshnessStaleStations,
} from "./feed-freshness-health.js";
import {
  initHostMultiplex,
  tryJoinHostGroup,
  leaveHostGroups,
  queueHostProbe,
  backfillHostProbes,
  stopHostMultiplex,
  getStationMultiplexTier,
} from "./host-multiplex.js";
export { getSpinitronWebStaleStations } from "./spinitron-web-health.js";
export { getFeedFreshnessStaleStations } from "./feed-freshness-health.js";

/**
 * History sources with fixed-size feeds (no deep pagination). A poll that
 * returns zero new spins may mean the source went silent — tracked by the
 * feed-freshness health module so operators are alerted before listeners
 * notice an empty timeline.
 */
const FEED_FRESHNESS_SOURCES = new Set(["bbc_api", "somafm"]);

/**
 * Minimal, safe ingestion poller. No background-worker infra exists in the
 * monorepo yet, so this is deliberately the smallest thing that works: one
 * in-process interval per station, staggered on boot so we never hammer sources
 * or MusicBrainz all at once. Every tick is wrapped so a single source failing
 * (or being silent) never throws, never blocks request handling, and never kills
 * the loop. A durable queue/worker can replace this later without touching the
 * adapters or resolver.
 *
 * Two ingest paths, chosen per source:
 *  - History adapters (KEXP/Spinitron/BBC) page recent plays newest-first and
 *    ingest idempotently against a per-station cursor. Every poll walks pages
 *    back until it reaches the last-seen cursor (bounded by a catch-up cap), so
 *    a gap longer than one page — e.g. after downtime — never silently drops
 *    plays. On first enroll (no cursor) it pages a bounded backfill window.
 *  - Now-playing adapters (Radio Paradise / station_page) fetch "the current
 *    track" and log on change.
 */

// Per-source poll cadence.
//
// History-paging sources (Spinitron, KEXP, BBC, SomaFM) return a batch of
// recent plays with stable ids and page back to a per-station cursor, so
// NOTHING is lost by polling rarely — spins are learned late, never missed.
// They run on a relaxed 10–15 minute cadence (plus a show-boundary bias poll,
// see scheduleBoundaryPolls). Now-playing-only sources expose just "the
// current track" with no history, so they must keep song-length cadence or
// spins are genuinely dropped — kcrw is in the history family for idempotent
// dedup but serves a single current track, so it stays tight too.
const POLL_INTERVALS_MS: Record<string, number> = {
  spinitron: 900_000, // 15 min — pages back to cursor; nothing lost
  spinitron_web: 150_000, // 2.5 min — HTML scrape of current playlist only
  kexp_api: 900_000, // 15 min — pages back to cursor; nothing lost
  bbc_api: 600_000, // 10 min — latest-segments feed holds well over 10 min
  somafm: 900_000, // 15 min — feed holds ~20 songs (~1h of music)
  kcrw: 90_000, // 1.5 min — single current track, no history depth
  station_page: 60_000, // 1 min
  radio_paradise: 60_000, // 1 min
  nts_live: 120_000, // 2 min — show-level, changes infrequently
  fip: 60_000, // 1 min — per-track metadata, songs ~3-5 min
  radio_browser_icy: 30_000, // 30 s — ICY metadata is cheap to fetch
  radiojar: 60_000, // 1 min — unauthenticated JSON now-playing endpoint
};
const DEFAULT_POLL_MS = 90_000;

/**
 * Sources whose spin identity changes at show boundaries — they get one extra
 * lightweight poll shortly after each :00/:30 so late-learning is minimized
 * exactly when playlists roll over. History sources lose nothing either way;
 * the boundary poll just tightens freshness where it matters.
 */
const BOUNDARY_POLL_SOURCES = new Set([
  "spinitron",
  "spinitron_web",
  "kexp_api",
  "bbc_api",
  "somafm",
  "nts_live",
]);
// Fire 2 minutes after the half-hour so the source has published the new show.
const BOUNDARY_OFFSET_MS = 120_000;
const STAGGER_MS = 4_000;

// Paging: plays per page, and the max plays a single poll will walk back. A
// steady-state poll finds the cursor on page 0 (one request); the cap bounds
// catch-up after downtime and the first-enroll backfill. ingestRawSpins dedups
// the overlap, so a generous page size costs no extra MusicBrainz calls.
const PAGE_SIZE = 50;
const MAX_CATCHUP = 200;

let started = false;
const timers: NodeJS.Timeout[] = [];

/**
 * Station ids with a poll currently in flight. Prevents overlapping ticks
 * for the same station — e.g. a slow fetch on a tight interval (radio_browser_icy
 * is 30s) can otherwise let two ticks race: both read the same "last spin" before
 * either write commits, both pass the dedup check, and both insert an identical
 * spin. Skipping a tick that's still running is always safe (the next tick
 * picks up the current now-playing state anyway).
 */
const inFlight = new Set<number>();

/**
 * Per-station interval/kickoff handles, keyed by station id.
 * Populated by enrollStationPoller; cleared by unenrollStationPoller.
 * Allows DELETE to immediately stop polling without waiting for a restart.
 */
const stationTimers = new Map<number, NodeJS.Timeout[]>();

/**
 * Persistent ICY watchers, keyed by station id. radio_browser_icy stations
 * get one of these instead of a poll interval — a held-open socket that emits
 * the moment StreamTitle changes (instant now-playing, no 30s worst case).
 * On `persistent-failed` the station falls back to the ordinary interval poll.
 */
const stationWatchers = new Map<number, IcyWatcher>();

/**
 * Station ids currently holding a leased persistent watcher (crossing-score
 * leases, see socket-leases.ts). Distinct from favorites: favorites are pinned
 * by the curator and never evicted; leases rotate on a ~20-minute cycle.
 */
const leasedIds = new Set<number>();

/** True when the station currently holds a watcher lease. */
export function isLeasedStation(stationId: number): boolean {
  return leasedIds.has(stationId);
}

/**
 * Pick the stream URL for a *persistent* connection. When the station's
 * nowPlayingConfig advertises multiple mounts (`mounts: [{url, bitrate?}]`),
 * prefer the lowest-bitrate mount — a held-open socket downloads audio bytes
 * continuously, so the cheapest mount cuts bandwidth with identical metadata.
 * Falls back to the plain `streamUrl` when no mounts are listed.
 */
export function pickWatcherStreamUrl(
  config: Record<string, unknown>,
): string | null {
  const rawMounts = Array.isArray(config["mounts"]) ? config["mounts"] : [];
  const mounts = rawMounts.filter(
    (m): m is { url: string; bitrate?: number } =>
      !!m &&
      typeof m === "object" &&
      typeof (m as { url?: unknown }).url === "string" &&
      ((m as { url: string }).url.length > 0),
  );
  if (mounts.length > 0) {
    const withBitrate = mounts.filter(
      (m) => typeof m.bitrate === "number" && m.bitrate > 0,
    );
    if (withBitrate.length > 0) {
      return withBitrate.reduce((a, b) => (b.bitrate! < a.bitrate! ? b : a))
        .url;
    }
    return mounts[0]!.url;
  }
  const streamUrl = config["streamUrl"];
  return typeof streamUrl === "string" && streamUrl ? streamUrl : null;
}

/**
 * Start a persistent ICY watcher for a station. Returns true when a watcher
 * was started (station has a usable streamUrl), false when the caller should
 * use interval polling instead.
 */
function startStationWatcher(station: Station): boolean {
  const config = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
  const streamUrl = pickWatcherStreamUrl(config);
  if (!streamUrl) return false;

  const watcher = new IcyWatcher(station.slug, streamUrl);
  stationWatchers.set(station.id, watcher);

  watcher.on("metadata-changed", (parsed: { rawArtist?: string; rawTitle: string; durationMs?: number; sourceRecordingId?: string }) => {
    const np: NowPlayingRaw = {
      rawArtist: parsed.rawArtist ?? "",
      rawTitle: parsed.rawTitle,
      ...(parsed.durationMs ? { durationMs: parsed.durationMs } : {}),
      ...(parsed.sourceRecordingId
        ? { recordingId: parsed.sourceRecordingId }
        : {}),
    };
    void logSpinIfChanged(station, np).then((wrote) => {
      if (wrote) {
        console.info(
          `[lore] ${station.slug} now playing (live): ${np.rawArtist} — ${np.rawTitle}`,
        );
      }
    });
  });

  watcher.on("persistent-failed", () => {
    stationWatchers.delete(station.id);
    // A leased station whose socket keeps failing loses the lease — it keeps
    // interval polling until the next lease cycle re-evaluates it.
    leasedIds.delete(station.id);
    console.warn(
      `[lore] ${station.slug}: persistent ICY failed; falling back to interval polling`,
    );
    routePollingTier(station, 0);
  });

  watcher.start();
  return true;
}

/** Stop and remove a station's persistent watcher, when one exists. */
function stopStationWatcher(stationId: number): void {
  const watcher = stationWatchers.get(stationId);
  if (!watcher) return;
  watcher.stop();
  stationWatchers.delete(stationId);
}

/**
 * Route a station into the cheapest non-socket tier. Multiplexed host
 * coverage (one Icecast status poll or AzuraCast SSE connection per host)
 * wins when the station's host is classified for it; otherwise classic
 * per-station interval polling. Unclassified ICY stations get a one-time
 * background host probe (persisted; re-routes live on success) while
 * interval polling covers them in the meantime.
 */
function routePollingTier(station: Station, delayMs: number): void {
  if (station.nowPlayingSource === "radio_browser_icy") {
    if (tryJoinHostGroup(station)) return;
    queueHostProbe(station); // no-op when already classified as "none"
  }
  scheduleIntervalPolling(station, delayMs);
}

/** Schedule the classic interval-poll loop for a station. */
function scheduleIntervalPolling(station: Station, delayMs: number): void {
  const period = intervalFor(station.nowPlayingSource);
  if (
    station.nowPlayingSource &&
    BOUNDARY_POLL_SOURCES.has(station.nowPlayingSource)
  ) {
    boundaryStations.set(station.id, station);
    scheduleBoundaryPolls();
  }
  const kickoff = setTimeout(() => {
    void pollStation(station);
    const interval = setInterval(() => void pollStation(station), period);
    timers.push(interval);
    trackStationTimer(station.id, interval);
  }, delayMs);
  timers.push(kickoff);
  trackStationTimer(station.id, kickoff);
}

function trackStationTimer(stationId: number, handle: NodeJS.Timeout): void {
  const list = stationTimers.get(stationId) ?? [];
  list.push(handle);
  stationTimers.set(stationId, list);
}

function intervalFor(source: string | null | undefined): number {
  if (source) {
    // Per-source override, e.g. LORE_POLL_MS_SPINITRON=300000.
    const env = process.env[`LORE_POLL_MS_${source.toUpperCase()}`];
    const ms = env ? Number(env) : NaN;
    if (Number.isFinite(ms) && ms >= 10_000) return ms;
  }
  return (source && POLL_INTERVALS_MS[source]) || DEFAULT_POLL_MS;
}

// ---- Show-boundary bias -------------------------------------------------

/**
 * Stations enrolled for the extra post-boundary poll, keyed by id. Registered
 * when a boundary-source station starts interval polling; cleared on
 * unenroll/hide so a removed station is never polled again.
 */
const boundaryStations = new Map<number, Station>();
// Single-owner recurring handles — never pushed into `timers`/`stationTimers`
// (those retain fired one-shots forever; a perpetual scheduler would leak).
let boundaryTimer: NodeJS.Timeout | null = null;
let boundaryFanoutTimers: NodeJS.Timeout[] = [];
let boundaryActive = false;

/**
 * Pure: milliseconds until the next :00/:30 boundary plus `offsetMs`.
 * Always returns a positive delay (if we're inside the offset window after a
 * boundary, targets the NEXT one).
 */
export function msUntilNextBoundaryPoll(
  nowMs: number,
  offsetMs: number = BOUNDARY_OFFSET_MS,
): number {
  const HALF_HOUR = 30 * 60 * 1000;
  const sinceBoundary = nowMs % HALF_HOUR;
  const target = sinceBoundary < offsetMs ? offsetMs : HALF_HOUR + offsetMs;
  return target - sinceBoundary;
}

/** Schedule the recurring post-half-hour boundary poll (self-rescheduling). */
function scheduleBoundaryPolls(): void {
  if (boundaryActive) return;
  boundaryActive = true;
  const arm = () => {
    if (!boundaryActive) return; // stopped while a tick was mid-flight
    boundaryTimer = setTimeout(() => {
      boundaryTimer = null;
      // Drop fan-out handles from the previous boundary (all fired by now).
      boundaryFanoutTimers = [];
      // Small stagger so a few dozen boundary polls don't fire in one tick.
      // The stale-row risk is benign: pollStation reloads history stations'
      // rows for the cursor, and a removed station is dropped from
      // boundaryStations on unenroll before its next fire.
      [...boundaryStations.values()].forEach((station, i) => {
        boundaryFanoutTimers.push(
          setTimeout(() => void pollStation(station), i * 500),
        );
      });
      arm();
    }, msUntilNextBoundaryPoll(Date.now()));
  };
  arm();
}

/** Tear down the boundary scheduler (stopLorePoller). */
function stopBoundaryPolls(): void {
  boundaryActive = false;
  if (boundaryTimer) clearTimeout(boundaryTimer);
  boundaryTimer = null;
  for (const t of boundaryFanoutTimers) clearTimeout(t);
  boundaryFanoutTimers = [];
  boundaryStations.clear();
}

/**
 * Page a history source newest-first until the batch reaches `cursor` (the
 * newest externalId we've already ingested), a page runs short (source has no
 * more history), or we hit `maxPlays`. Returns the union of pages; the ingest
 * path dedups the overlap. On first enroll (`cursor` null) it simply pages the
 * bounded backfill window. Never throws — a failed page just ends paging with
 * whatever was collected so far.
 */
export async function fetchPlaysUntilCursor(
  history: HistoryAdapter,
  config: Record<string, unknown>,
  cursor: string | null,
  maxPlays: number,
  pageSize: number = PAGE_SIZE,
): Promise<RawSpin[]> {
  const collected: RawSpin[] = [];
  for (let page = 0; collected.length < maxPlays; page++) {
    const limit = Math.min(pageSize, maxPlays - collected.length);
    let batch: RawSpin[];
    try {
      batch = await history(config, { limit, page });
    } catch (err) {
      console.error("[lore] history page fetch failed", page, err);
      break;
    }
    if (!batch.length) break;
    collected.push(...batch);
    // This page already contains the newest play we've ingested — everything
    // older is known, so stop.
    if (cursor && batch.some((s) => s.externalId === cursor)) break;
    // A short page means the source has no deeper history to walk.
    if (batch.length < limit) break;
  }
  return collected;
}

/**
 * Poll one station once. History sources reload the station row first so the
 * cursor advanced by a previous tick is honored (and to detect first-enroll
 * backfill). Never throws.
 *
 * @internal Exported for integration tests; treat as an implementation detail.
 */
export async function pollStation(station: Station): Promise<void> {
  if (inFlight.has(station.id)) return;
  inFlight.add(station.id);
  const source = station.nowPlayingSource;
  try {
    const history = getHistoryAdapter(source);
    if (history) {
      // Reload for the freshest cursor (advanced by prior ticks / enroll).
      const [fresh] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.id, station.id))
        .limit(1);
      const current = fresh ?? station;
      const cursor = current.lastSeenCursor ?? null;
      const firstEnroll = !cursor;
      const spins = await fetchPlaysUntilCursor(
        history,
        current.nowPlayingConfig ?? {},
        cursor,
        MAX_CATCHUP,
      );
      const logged = await ingestRawSpins(current, spins, source ?? "unknown");
      if (logged > 0) {
        console.info(
          `[lore] ${current.slug} ingested ${logged} spin(s)` +
            (firstEnroll ? " (backfill)" : ""),
        );
      }

      // Feed-freshness health tracking for fixed-size, non-paginating sources
      // (bbc_api, somafm). A poll that returns no new spins after a successful
      // run is normal during low-traffic periods, but sustained silence beyond
      // 2 × the poll interval likely means the feed went dark.
      if (source && FEED_FRESHNESS_SOURCES.has(source)) {
        const pollIntervalMs = intervalFor(source);
        const warning = recordFeedFreshnessResult(
          current.id,
          current.slug,
          source,
          logged > 0 ? "success" : "empty",
          pollIntervalMs,
        );
        if (warning.shouldWarn) {
          console.warn(
            "[lore] feed has been silent beyond 2× poll interval — possible outage or API change",
            {
              source,
              stationId: current.id,
              slug: current.slug,
              lastSpinAt: warning.lastSpinAt.toISOString(),
              staleSinceMs: warning.staleSinceMs,
              thresholdMs: 2 * pollIntervalMs,
            },
          );
        }
      }

      return;
    }

    const nowPlaying = getNowPlayingAdapter(source);
    if (!nowPlaying) return;
    const np = await nowPlaying(station.nowPlayingConfig ?? {});

    if (source === "spinitron_web") {
      if (!np) {
        const warning = recordSpinitronWebResult(
          station.id,
          station.slug,
          "null",
        );
        if (warning.shouldWarn) {
          console.warn("[lore] spinitron_web returned null for a previously-active station", {
            source: "spinitron_web",
            stationId: station.id,
            slug: station.slug,
            lastSuccessAt: warning.lastSuccessAt.toISOString(),
          });
        }
        return;
      }
      recordSpinitronWebResult(station.id, station.slug, "success");
    }

    if (!np) return;
    const wrote = await logSpinIfChanged(station, np);
    if (wrote) {
      console.info(
        `[lore] ${station.slug} now playing: ${np.rawArtist} — ${np.rawTitle}`,
      );
    }
  } catch (err) {
    console.error("[lore] poll failed", station.slug, err);
  } finally {
    inFlight.delete(station.id);
  }
}

/**
 * Start per-station pollers. Idempotent — safe to call once at boot. Reads the
 * station list once, then schedules a staggered, per-source interval per
 * station. If the DB is unreachable at boot it logs and returns without
 * crashing the API.
 */
export async function startLorePoller(): Promise<void> {
  if (started) return;
  started = true;

  let stations: Station[];
  try {
    stations = await db.select().from(stationsTable);
  } catch (err) {
    console.error("[lore] poller could not load stations; not started", err);
    started = false;
    return;
  }

  // Hidden stations are soft-removed: no watcher, no interval poll.
  const pollable = stations.filter(
    (s) => isPollable(s.nowPlayingSource) && !s.hidden,
  );
  console.info(`[lore] starting pollers for ${pollable.length} station(s)`);

  // Install multiplex hooks BEFORE any routing/probing so a fast probe can
  // never complete against the default no-op hooks (which would leave a
  // classified station stuck on interval polling until the next restart).
  // The reenroll hook is watcher-aware: a station that acquired a pinned or
  // leased persistent watcher while its probe was in flight keeps it — the
  // persisted classification simply applies at the next demotion/boot.
  initHostMultiplex({
    fallback: (station) => scheduleIntervalPolling(station, 0),
    reenroll: (station) => {
      if (stationWatchers.has(station.id)) return;
      enrollStationPoller(station);
    },
  });

  // Stagger watcher socket dials — opening hundreds of TCP/TLS connections in
  // the same tick saturates the dialer and produces a boot-time storm of
  // connect timeouts. 250ms apart spreads a few hundred dials over ~1 min
  // while interval pollers keep their own (coarser) stagger.
  const WATCHER_STAGGER_MS = 250;
  let watcherIndex = 0;
  pollable.forEach((station, i) => {
    // Favorite radio_browser_icy stations get a persistent watcher (instant
    // metadata) when a streamUrl is available; everything else — including
    // non-favorite ICY stations — keeps interval polling. The persistent
    // connection budget is curated via the favorite flag (~40 soft cap).
    if (station.nowPlayingSource === "radio_browser_icy" && station.favorite) {
      const config = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
      if (pickWatcherStreamUrl(config)) {
        const delay = watcherIndex++ * WATCHER_STAGGER_MS;
        const handle = setTimeout(() => {
          if (!startStationWatcher(station)) {
            routePollingTier(station, 0);
          }
        }, delay);
        timers.push(handle);
        trackStationTimer(station.id, handle);
        return;
      }
    }
    routePollingTier(station, i * STAGGER_MS);
  });

  // One-off backfill for stations enrolled before host classification existed;
  // no-ops for already-classified rows, so steady-state boots cost nothing.
  backfillHostProbes(pollable);
}

/** Stop all pollers (used in tests / graceful shutdown). */
export function stopLorePoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  stopBoundaryPolls();
  for (const watcher of stationWatchers.values()) watcher.stop();
  stationWatchers.clear();
  stopHostMultiplex();
  started = false;
}

/**
 * Register a newly enrolled station for live polling without restarting the
 * whole poller. Fires an immediate first poll and then schedules the recurring
 * interval at the source-appropriate cadence. Per-station timers are tracked
 * so that unenrollStationPoller can cancel them immediately.
 *
 * Calling this twice for the same station adds a second interval — callers
 * must ensure they call this once per enrollment (admin enroll endpoint does).
 *
 * Called by the admin enrollment endpoint immediately after inserting a new
 * radio_browser_icy station row so it starts appearing in timelines right away.
 */
export function enrollStationPoller(station: Station): void {
  if (!isPollable(station.nowPlayingSource)) return;
  // Clear any existing timers for this station so re-enrollment (e.g. admin
  // calling enroll twice for the same UUID) doesn't create duplicate loops.
  unenrollStationPoller(station.id);
  // Hidden stations are soft-removed: enrollment is a no-op (the unenroll
  // above already stopped anything running, so this doubles as "apply hide").
  if (station.hidden) return;
  if (
    station.nowPlayingSource === "radio_browser_icy" &&
    (station.favorite || leasedIds.has(station.id)) &&
    startStationWatcher(station)
  ) {
    return;
  }
  routePollingTier(station, 0);
}

/**
 * Grant a station a leased persistent watcher (crossing-score leasing).
 * Tears down its interval poller first (unenroll), so promotion is live and
 * never leaves a duplicate poll loop. Returns false — and restores interval
 * polling — when a watcher can't start (no usable stream URL, hidden, or not
 * an ICY station).
 */
export function leaseStationWatcher(station: Station): boolean {
  if (
    station.hidden ||
    station.nowPlayingSource !== "radio_browser_icy" ||
    !isPollable(station.nowPlayingSource)
  ) {
    return false;
  }
  // Favorites already hold a pinned watcher — leasing one is a no-op success.
  if (station.favorite && stationWatchers.has(station.id)) return true;
  unenrollStationPoller(station.id);
  leasedIds.add(station.id);
  if (!startStationWatcher(station)) {
    leasedIds.delete(station.id);
    routePollingTier(station, 0);
    return false;
  }
  return true;
}

/**
 * Release a station's watcher lease and demote it back to interval polling
 * immediately (delay 0 → first poll fires right away, so there is no gap in
 * spin logging). No-op when the station holds no lease.
 */
export function releaseStationLease(station: Station): void {
  if (!leasedIds.delete(station.id)) return;
  unenrollStationPoller(station.id);
  if (!station.hidden) routePollingTier(station, 0);
}

// ---- Coverage classification --------------------------------------------

export type CoverageClass =
  | "instant"
  | "multiplexed"
  | "complete-history"
  | "blind-spot";

/**
 * History sources with real paging depth — a complete recent spin log is
 * recoverable no matter how rarely we poll. kcrw is deliberately excluded:
 * its API serves a single current track, so it has no history safety net.
 */
const COMPLETE_HISTORY_SOURCES = new Set([
  "spinitron",
  "kexp_api",
  "bbc_api",
  "somafm",
]);

/**
 * Classify one station's coverage from its source type and live connection
 * state. Blind spots are the only true risk: no history endpoint AND no
 * persistent connection — spins there are only as fresh as the poll cadence,
 * and anything between polls is lost forever.
 */
export function coverageClassFor(station: Station): CoverageClass {
  if (stationWatchers.has(station.id)) return "instant";
  const mux = getStationMultiplexTier(station.id);
  if (mux) return "multiplexed";
  if (
    station.nowPlayingSource &&
    COMPLETE_HISTORY_SOURCES.has(station.nowPlayingSource)
  ) {
    return "complete-history";
  }
  return "blind-spot";
}

/**
 * Cancel all active poll timers for a station, taking effect immediately.
 * Called by the admin DELETE endpoint so removed stations stop being polled
 * without waiting for a process restart.
 */
export function unenrollStationPoller(stationId: number): void {
  stopStationWatcher(stationId);
  leasedIds.delete(stationId);
  leaveHostGroups(stationId);
  boundaryStations.delete(stationId);
  const handles = stationTimers.get(stationId);
  if (handles) {
    for (const h of handles) clearTimeout(h);
    stationTimers.delete(stationId);
  }
  clearSpinitronWebState(stationId);
  clearFeedFreshnessState(stationId);
}
