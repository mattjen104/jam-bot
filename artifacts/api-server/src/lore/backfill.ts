import {
  db,
  stationsTable,
  stationHistoryBackfillTable,
  type Station,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  getHistoryAdapter,
  historySourceContract,
  stationArchiveUrl,
  supportsBackfill,
} from "./adapters.js";
import { ingestRawSpins } from "./resolve.js";
import { isJunkMetadata } from "./icy.js";
import { recordMetadataQuality } from "./metadata-quality.js";
import type {
  HistoryFetchReview,
  HistorySourceContract,
  RawSpin,
} from "./types.js";

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

// One slice per tick. KEXP accepts up to 200 per page; larger slices mean
// fewer ticks to walk years of history without extra API pressure.
const SLICE_PAGE_SIZE = 200;
// Pause between slices. 10 s gives ~72,000 plays/hour walking speed while
// keeping MusicBrainz resolution comfortably under 1 req/sec (most modern
// KEXP plays carry recording_id and skip the MB lookup entirely).
const TICK_MS = 10_000;
// Let boot (seed + live-poll catch-up) settle before the first slice.
const WARMUP_MS = 90_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const AUDIT_LIMIT = 50;

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
let rotationIndex = 0;

export interface HistoryBatchReview {
  accepted: RawSpin[];
  rejected: number;
  duplicate: number;
  outcomes: Array<
    "invalid_row" | "junk_metadata" | "future_dated" | "duplicate" | "ambiguous_row"
  >;
}

/** Reject unsafe historical rows before any resolver or database write. */
export function reviewHistoricalBatch(
  spins: RawSpin[],
  now: Date = new Date(),
): HistoryBatchReview {
  const accepted: RawSpin[] = [];
  const outcomes: HistoryBatchReview["outcomes"] = [];
  const ids = new Set<string>();
  for (const spin of spins) {
    if (!spin.rawArtist?.trim() || !spin.rawTitle?.trim()) {
      outcomes.push("invalid_row");
      continue;
    }
    if (isJunkMetadata(spin.rawArtist, spin.rawTitle)) {
      outcomes.push("junk_metadata");
      continue;
    }
    if (!spin.externalId || !spin.playedAt) {
      outcomes.push("ambiguous_row");
      continue;
    }
    if (
      Number.isNaN(spin.playedAt.getTime()) ||
      spin.playedAt.getTime() > now.getTime() + FUTURE_SKEW_MS
    ) {
      outcomes.push(
        Number.isNaN(spin.playedAt.getTime()) ? "invalid_row" : "future_dated",
      );
      continue;
    }
    if (ids.has(spin.externalId)) {
      outcomes.push("duplicate");
      continue;
    }
    ids.add(spin.externalId);
    accepted.push(spin);
  }
  return {
    accepted,
    rejected: outcomes.length,
    duplicate: outcomes.filter((outcome) => outcome === "duplicate").length,
    outcomes,
  };
}

function isCuratedFrontDoor(station: Station): boolean {
  return station.source === "curated" && station.tier === "flagship";
}

interface StationHistorySelection {
  source: string | null;
  config: Record<string, unknown>;
}

/**
 * History may be supplied by a different first-party system than live
 * now-playing. Operators can set nowPlayingConfig.history = { source, ... }
 * without disturbing the live adapter or its cursor.
 */
function stationHistorySelection(station: Station): StationHistorySelection {
  const nested = station.nowPlayingConfig?.history;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const history = nested as Record<string, unknown>;
    return {
      source:
        typeof history.source === "string" && history.source.trim()
          ? history.source.trim()
          : null,
      config: history,
    };
  }
  return {
    source: station.nowPlayingSource,
    config: station.nowPlayingConfig ?? {},
  };
}

function configuredSourceUrl(
  station: Station,
  spins: RawSpin[] = [],
): string | null {
  const fromSpin = spins.find((spin) => spin.sourceUrl)?.sourceUrl;
  if (fromSpin) return fromSpin;
  const configUrl = stationHistorySelection(station).config.url;
  return typeof configUrl === "string" && configUrl.trim()
    ? configUrl.trim()
    : null;
}

function safeHistorySourceUrl(station: Station, spins: RawSpin[] = []): string | null {
  const fromSpin = configuredSourceUrl(station, spins);
  if (fromSpin) {
    try {
      const url = new URL(fromSpin);
      // Never persist credentials carried in query params.
      for (const key of [...url.searchParams.keys()]) {
        if (/token|key|secret|auth/i.test(key)) url.searchParams.set(key, "[redacted]");
      }
      return url.toString();
    } catch {
      return null;
    }
  }
  switch (stationHistorySelection(station).source) {
    case "kexp_api":
      return "https://api.kexp.org/v2/plays/";
    case "spinitron":
      return "https://spinitron.com/api/spins";
    case "bbc_api":
      return "https://rms.api.bbc.co.uk/v2/services/";
    case "somafm":
      return "https://somafm.com/songs/";
    default:
      return null;
  }
}

async function upsertHistoryLedger(args: {
  station: Station;
  contract: HistorySourceContract;
  status: string;
  sourceUrl?: string | null;
  accepted?: number;
  rejected?: number;
  duplicate?: number;
  imported?: number;
  oldestPublishedAt?: Date | null;
  lastSuccessfulPage?: number | null;
  failure?: string | null;
  accumulate?: boolean;
}): Promise<void> {
  const now = new Date();
  const accepted = args.accepted ?? 0;
  const rejected = args.rejected ?? 0;
  const duplicate = args.duplicate ?? 0;
  const imported = args.imported ?? 0;
  await db
    .insert(stationHistoryBackfillTable)
    .values({
      stationId: args.station.id,
      source: args.contract.source,
      family: args.contract.family,
      surface: args.contract.surface,
      cursorMode: args.contract.cursorMode,
      supportsBackfill: args.contract.supportsBackfill,
      stableIdentity: args.contract.stableIdentity,
      reportedTimestamp: args.contract.reportedTimestamp,
      archiveCitation: args.contract.archiveCitation,
      sourceUrl: args.sourceUrl ?? null,
      status: args.status,
      supportedDepthDays: args.contract.supportedDepthDays,
      oldestPublishedAt: args.oldestPublishedAt ?? null,
      lastSuccessfulPage: args.lastSuccessfulPage ?? null,
      acceptedCount: accepted,
      rejectedCount: rejected,
      duplicateCount: duplicate,
      importedCount: imported,
      lastAttemptAt: now,
      lastSuccessAt: args.failure ? null : now,
      lastFailureAt: args.failure ? now : null,
      lastFailureReason: args.failure ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        stationHistoryBackfillTable.stationId,
        stationHistoryBackfillTable.source,
      ],
      set: {
        family: args.contract.family,
        surface: args.contract.surface,
        cursorMode: args.contract.cursorMode,
        supportsBackfill: args.contract.supportsBackfill,
        stableIdentity: args.contract.stableIdentity,
        reportedTimestamp: args.contract.reportedTimestamp,
        archiveCitation: args.contract.archiveCitation,
        sourceUrl: args.sourceUrl ?? null,
        status: args.status,
        supportedDepthDays: args.contract.supportedDepthDays,
        oldestPublishedAt: args.oldestPublishedAt ?? null,
        lastSuccessfulPage: args.lastSuccessfulPage ?? null,
        acceptedCount: args.accumulate
          ? sql`${stationHistoryBackfillTable.acceptedCount} + ${accepted}`
          : accepted,
        rejectedCount: args.accumulate
          ? sql`${stationHistoryBackfillTable.rejectedCount} + ${rejected}`
          : rejected,
        duplicateCount: args.accumulate
          ? sql`${stationHistoryBackfillTable.duplicateCount} + ${duplicate}`
          : duplicate,
        importedCount: args.accumulate
          ? sql`${stationHistoryBackfillTable.importedCount} + ${imported}`
          : imported,
        lastAttemptAt: now,
        ...(args.failure
          ? { lastFailureAt: now, lastFailureReason: args.failure }
          : { lastSuccessAt: now, lastFailureReason: null }),
        updatedAt: now,
      },
    });
}

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

export interface HistoryAuditResult {
  audited: number;
  usable: number;
  unsupported: number;
  transientFailures: number;
}

let auditRunning = false;
let auditLastResult: HistoryAuditResult | null = null;
let auditStartedAt: string | null = null;
let auditFinishedAt: string | null = null;

export function getStationHistoryAuditStatus() {
  return {
    running: auditRunning,
    startedAt: auditStartedAt,
    finishedAt: auditFinishedAt,
    result: auditLastResult,
  };
}

/** Start the bounded audit off-request; returns false when one is in flight. */
export function startStationHistoryAudit(): boolean {
  if (auditRunning) return false;
  auditRunning = true;
  auditStartedAt = new Date().toISOString();
  auditFinishedAt = null;
  void auditStationHistorySources()
    .then((result) => {
      auditLastResult = result;
    })
    .catch((error) => {
      console.error("[lore] station history audit failed", error);
    })
    .finally(() => {
      auditRunning = false;
      auditFinishedAt = new Date().toISOString();
    });
  return true;
}

/**
 * Bounded, import-free audit of the curated front-door roster. It performs at
 * most one small fetch per supported station and persists only evidence.
 */
export async function auditStationHistorySources(
  limit: number = AUDIT_LIMIT,
): Promise<HistoryAuditResult> {
  const stations = (await db.select().from(stationsTable))
    .filter(isCuratedFrontDoor)
    .slice(0, Math.max(1, limit));
  const result: HistoryAuditResult = {
    audited: 0,
    usable: 0,
    unsupported: 0,
    transientFailures: 0,
  };
  for (const station of stations) {
    result.audited++;
    const selected = stationHistorySelection(station);
    const source = selected.source ?? "none";
    const contract = historySourceContract(source, selected.config);
    const history = getHistoryAdapter(source);
    if (!contract || !history) {
      const unsupportedContract: HistorySourceContract = {
        source,
        family: "official_api",
        surface: station.homepageUrl
          ? "Station website without a configured deterministic history adapter"
          : "No station-published history surface configured",
        cursorMode: "fixed_feed",
        supportsBackfill: false,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: "none",
        supportedDepthDays: null,
        retryPolicy: "unsupported",
      };
      await upsertHistoryLedger({
        station,
        contract: unsupportedContract,
        status: "unsupported",
        sourceUrl: station.homepageUrl,
        failure: "No supported deterministic history surface is configured.",
      });
      result.unsupported++;
      continue;
    }
    let parserReview: HistoryFetchReview | undefined;
    try {
      const batch = await history(selected.config, {
        limit: 25,
        page: 0,
        onReview: (review) => {
          parserReview = review;
        },
      });
      const reviewed = reviewHistoricalBatch(batch);
      const oldest = oldestPlayedAt(reviewed.accepted);
      const status = reviewed.accepted.length ? "usable" : "empty";
      await upsertHistoryLedger({
        station,
        contract,
        status,
        sourceUrl: safeHistorySourceUrl(station, batch),
        accepted: reviewed.accepted.length,
        rejected: reviewed.rejected + (parserReview?.rejected ?? 0),
        duplicate: reviewed.duplicate,
        oldestPublishedAt: oldest,
        lastSuccessfulPage: 0,
      });
      if (reviewed.accepted.length) result.usable++;
      else result.unsupported++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await upsertHistoryLedger({
        station,
        contract,
        status: "transient_failure",
        sourceUrl: safeHistorySourceUrl(station),
        failure: reason.slice(0, 500),
      });
      result.transientFailures++;
    }
  }
  return result;
}

/** Run ONE backfill slice for one station. Returns spins ingested. */
export async function backfillStationHistorySlice(
  stationId: number,
): Promise<number> {
  // Reload for the freshest cursor (this job is the only writer, but restarts
  // and multi-instance safety are cheap here).
  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, stationId))
    .limit(1);
  if (
    !station ||
    station.backfillDone ||
    station.hidden ||
    !isCuratedFrontDoor(station)
  ) {
    return 0;
  }

  const selected = stationHistorySelection(station);
  const history = getHistoryAdapter(selected.source);
  const contract = historySourceContract(
    selected.source,
    selected.config,
  );
  if (
    !history ||
    !contract ||
    !supportsBackfill(selected.source, selected.config)
  ) {
    return 0;
  }

  const cursor = station.backfillCursor ?? new Date().toISOString();
  const floor = backfillFloor();
  if (new Date(cursor) <= floor) {
    await markDone(station, "reached floor");
    return 0;
  }

  let batch: RawSpin[];
  let parserReview: HistoryFetchReview | undefined;
  try {
    batch = await history(selected.config, {
      limit: SLICE_PAGE_SIZE,
      before: cursor,
      onReview: (review) => {
        parserReview = review;
      },
    });
  } catch (err) {
    console.error("[lore] backfill fetch failed", station.slug, err);
    await upsertHistoryLedger({
      station,
      contract,
      status: "transient_failure",
      sourceUrl: safeHistorySourceUrl(station),
      failure: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      accumulate: true,
    });
    return 0; // transient — the next tick retries from the same cursor
  }

  if (!batch.length) {
    await markDone(station, "source history exhausted");
    return 0;
  }

  const reviewed = reviewHistoricalBatch(batch);
  const sourceUrl = safeHistorySourceUrl(station, batch);
  const prepared = reviewed.accepted.map((spin) => {
    const day = spin.playedAt!.toISOString().slice(0, 10);
    return {
      ...spin,
      sourceFamily: contract.family,
      ...(sourceUrl ? { sourceUrl } : {}),
      citationUrl:
        spin.citationUrl ??
        stationArchiveUrl(
        selected.source,
          day,
          selected.config,
        ) ??
        sourceUrl ??
        undefined,
    };
  });

  const parserRejected = parserReview?.rejected ?? 0;
  const parserOutcomes = Array.from(
    { length: parserRejected },
    () => "invalid_row" as const,
  );
  if (reviewed.outcomes.length || parserOutcomes.length) {
    await recordMetadataQuality({
      stationId: station.id,
      source: selected.source ?? "unknown",
      capability: "complete_history",
      outcomes: [...reviewed.outcomes, ...parserOutcomes],
      responded: true,
      detail: "Historical rows rejected before resolution.",
    });
  }

  const logged = await ingestRawSpins(
    station,
    prepared,
    selected.source ?? "unknown",
    { backfill: true },
  );

  const batchOldest = oldestPlayedAt(batch);
  const advanced = nextCursor(station.backfillCursor, batchOldest);
  if (advanced) {
    await db
      .update(stationsTable)
      .set({ backfillCursor: advanced })
      .where(eq(stationsTable.id, station.id));
  } else {
    await upsertHistoryLedger({
      station,
      contract,
      status: "parser_drift",
      sourceUrl,
      accepted: 0,
      rejected: reviewed.rejected + parserRejected,
      duplicate: reviewed.duplicate,
      imported: 0,
      failure: "Source returned rows without a usable reported timestamp.",
      accumulate: true,
    });
    return 0;
  }
  await upsertHistoryLedger({
    station,
    contract,
    status: "running",
    sourceUrl,
    accepted: prepared.length,
    rejected: reviewed.rejected + parserRejected,
    duplicate: reviewed.duplicate,
    imported: logged,
    oldestPublishedAt: batchOldest,
    lastSuccessfulPage: 0,
    accumulate: true,
  });
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
  const selected = stationHistorySelection(station);
  if (selected.source) {
    await db
      .update(stationHistoryBackfillTable)
      .set({
        status: "complete",
        lastSuccessAt: new Date(),
        lastFailureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(stationHistoryBackfillTable.stationId, station.id));
  }
  console.info(`[lore] backfill ${station.slug} complete (${why})`);
}

/** One tick: a single slice for each backfillable, unfinished station. */
async function tick(stationIds: number[]): Promise<void> {
  if (!stationIds.length) return;
  const id = stationIds[rotationIndex % stationIds.length]!;
  rotationIndex = (rotationIndex + 1) % stationIds.length;
  try {
    await backfillStationHistorySlice(id);
  } catch (err) {
    console.error("[lore] backfill slice failed", id, err);
  }
}

/** Operator-facing audit/progress read model for curated front-door stations. */
export async function getStationHistoryBackfillLedger() {
  const rows = await db
    .select({
      station: stationsTable,
      history: stationHistoryBackfillTable,
    })
    .from(stationsTable)
    .leftJoin(
      stationHistoryBackfillTable,
      eq(stationHistoryBackfillTable.stationId, stationsTable.id),
    );
  return rows
    .filter((row) => isCuratedFrontDoor(row.station))
    .map(({ station, history }) => ({
      stationId: station.id,
      slug: station.slug,
      name: station.name,
      configuredSource: station.nowPlayingSource ?? null,
      historySource: stationHistorySelection(station).source,
      liveCursor: station.lastSeenCursor ?? null,
      backfillCursor: station.backfillCursor ?? null,
      backfillDone: station.backfillDone,
      source: history
        ? {
            family: history.family,
            surface: history.surface,
            sourceUrl: history.sourceUrl,
            status: history.status,
            cursorMode: history.cursorMode,
            supportsBackfill: history.supportsBackfill,
            stableIdentity: history.stableIdentity,
            reportedTimestamp: history.reportedTimestamp,
            archiveCitation: history.archiveCitation,
            supportedDepthDays: history.supportedDepthDays,
            oldestPublishedAt: history.oldestPublishedAt?.toISOString() ?? null,
            lastSuccessfulPage: history.lastSuccessfulPage,
            acceptedCount: history.acceptedCount,
            rejectedCount: history.rejectedCount,
            duplicateCount: history.duplicateCount,
            importedCount: history.importedCount,
            lastAttemptAt: history.lastAttemptAt?.toISOString() ?? null,
            lastSuccessAt: history.lastSuccessAt?.toISOString() ?? null,
            lastFailureAt: history.lastFailureAt?.toISOString() ?? null,
            lastFailureReason: history.lastFailureReason,
          }
        : null,
    }));
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
    const rows = await db.select().from(stationsTable);
    ids = rows
      .filter(
        (station) =>
          isCuratedFrontDoor(station) &&
          supportsBackfill(
            stationHistorySelection(station).source,
            stationHistorySelection(station).config,
          ) &&
          !station.backfillDone,
      )
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
