import { useState, useEffect, useCallback, useRef } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AdminNav } from "@/components/AdminNav";
import type {
  PlaybackHealthResponse,
  StoreAuditResponse,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Info,
  KeyRound,
  Loader2,
  Radio,
  RefreshCw,
  ShoppingBag,
  Tag,
  Wifi,
} from "lucide-react";

const REFRESH_INTERVAL_MS = 30_000;

// ─── API shapes ────────────────────────────────────────────────────────────

interface FeedFreshnessStation {
  stationId: number;
  slug: string;
  source: string;
  pollIntervalMs: number;
  lastSpinAt: string | null;
  lastEmptyAt: string;
  consecutiveEmpties: number;
  staleSinceMs: number;
  thresholdMs: number;
}

interface FeedFreshnessResponse {
  monitoringSince: string;
  staleCount: number;
  stations: FeedFreshnessStation[];
}

interface ResolutionLatencyStation {
  stationId: number;
  slug: string;
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

interface ResolutionLatencyResponse {
  monitoringSince: string;
  slowThresholdMs: number;
  slowCount: number;
  stations: ResolutionLatencyStation[];
}

function formatHealthWindow(value: string | null): string {
  if (!value) return "No samples yet";
  return new Date(value).toLocaleString();
}
interface SpinitronWebStation {
  stationId: number;
  slug: string;
  lastSuccessAt: string | null;
  lastNullAt: string;
  consecutiveNulls: number;
  staleSinceMs: number;
}

interface SpinitronWebResponse {
  staleCount: number;
  stations: SpinitronWebStation[];
}

interface ReleaseYearHealth {
  totalNull: number;
  /** Eligible work: null year, null checked_at, has spins, non-synthetic MBID. */
  inQueue: number;
  /** Checked by backfill but MB returned no date — won't be retried. */
  permMiss: number;
  /** Null year, null checked_at, but synthetic (sp:) or never aired — backfill skips these. */
  ineligible: number;
  lastCheckedAt: string | null;
  /** Release-date backfill (Set B): recent recordings (release_year >= currentYear-1) still missing release_date. */
  datePending: number;
  /** Set B rows not yet attempted (exact backfill target predicate). */
  dateInQueue: number;
  /** Set B rows where MB was checked but returned no date — won't be retried. */
  datePermMiss: number;
  /** Max release_date_checked_at among recent recordings — shows job progress. */
  dateLastCheckedAt: string | null;
  /** Recent unique unresolved artist/title identities awaiting convergence. */
  unmatchedCandidates: number;
  /** Recent identities promoted to a canonical MusicBrainz recording. */
  unmatchedResolved: number;
  /** Recent identities deferred after a temporary provider failure. */
  unmatchedDeferred: number;
  /** Recent identities with a durable no-match result. */
  unmatchedUnavailable: number;
  unmatchedLastAttemptAt: string | null;
}

interface DurationHealth {
  totalNull: number;
  inQueue: number;
  permMiss: number;
  ineligible: number;
  lastCheckedAt: string | null;
}

interface GenreStationCoverage {
  stationId: number;
  slug: string;
  eligible: number;
  attempted: number;
  enriched: number;
  attemptedCoverage: number | null;
  genreCoverage: number | null;
}

interface GenreEnrichmentHealth {
  total: number;
  pending: number;
  transientFailure: number;
  noResult: number;
  enriched: number;
  ineligible: number;
  recentWindowDays: number;
  recentEligible: number;
  recentAttempted: number;
  recentEnriched: number;
  recentAttemptedCoverage: number | null;
  recentGenreCoverage: number | null;
  attemptsLast24h: number;
  oldestPendingAt: string | null;
  lastAttemptAt: string | null;
  stationCoverage: GenreStationCoverage[];
}

interface HistoryAuditResult {
  audited: number;
  usable: number;
  unsupported: number;
  transientFailures: number;
}

interface HistoryAuditStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  result: HistoryAuditResult | null;
}

interface StationHistoryLedgerSource {
  family: string;
  surface: string;
  sourceUrl: string | null;
  status: string;
  cursorMode: string;
  supportsBackfill: boolean;
  stableIdentity: string;
  reportedTimestamp: string;
  archiveCitation: string;
  supportedDepthDays: number | null;
  oldestPublishedAt: string | null;
  lastSuccessfulPage: number | null;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  importedCount: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

interface StationHistoryLedgerStation {
  stationId: number;
  slug: string;
  name: string;
  configuredSource: string | null;
  historySource: string | null;
  liveCursor: string | null;
  backfillCursor: string | null;
  backfillDone: boolean;
  source: StationHistoryLedgerSource | null;
}

interface StationHistoryResponse {
  audit: HistoryAuditStatus;
  stations: StationHistoryLedgerStation[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Entry point ───────────────────────────────────────────────────────────

export default function AdminHealth() {
  const { token, saveToken, clearToken } = useAdminToken();
  if (!token) return <TokenGate onSave={saveToken} />;
  return <HealthPanel token={token} onClearToken={clearToken} />;
}

// ─── Token gate ────────────────────────────────────────────────────────────

function TokenGate({ onSave }: { onSave: (t: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-8 shadow-lg">
        <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-wide text-primary">
          <KeyRound className="h-3.5 w-3.5" />
          Admin access
        </div>
        <h1 className="mt-3 font-serif text-3xl font-normal text-foreground">
          Enter admin token
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Stored in your browser — you won't need to re-enter it.
        </p>
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) onSave(draft.trim());
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Token"
            autoFocus
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full bg-primary px-5 py-2 text-base font-normal text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────

function HealthPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [feedFreshness, setFeedFreshness] = useState<FeedFreshnessResponse | null>(null);
  const [ffError, setFfError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [resolutionLatency, setResolutionLatency] = useState<ResolutionLatencyResponse | null>(null);
  const [rlError, setRlError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [playbackHealth, setPlaybackHealth] = useState<PlaybackHealthResponse | null>(null);
  const [phError, setPhError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [spiWeb, setSpiWeb] = useState<SpinitronWebResponse | null>(null);
  const [swError, setSwError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [ryHealth, setRyHealth] = useState<ReleaseYearHealth | null>(null);
  const [ryError, setRyError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [durationHealth, setDurationHealth] = useState<DurationHealth | null>(null);
  const [durationError, setDurationError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [genreHealth, setGenreHealth] = useState<GenreEnrichmentHealth | null>(null);
  const [genreError, setGenreError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true);
      setLoadError(null);

      const headers = { "x-admin-token": token };

      // ── Feed-freshness (independent error path) ─────────────────────────
      const ffPromise = (async () => {
        let ffRes: Response;
        try {
          ffRes = await fetch("/api/admin/feed-freshness-health", { headers });
        } catch (err) {
          setFfError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setFeedFreshness(null);
          return false;
        }
        if (ffRes.ok) {
          setFeedFreshness((await ffRes.json()) as FeedFreshnessResponse);
          setFfError(null);
          return true;
        }
        const body = (await ffRes.json().catch(() => ({}))) as { error?: string };
        setFfError({
          kind: ffRes.status === 401 ? "auth" : "server",
          message: body.error ?? `HTTP ${ffRes.status}`,
        });
        setFeedFreshness(null);
        return false;
      })();

      // ── Resolution latency (independent error path) ─────────────────────
      const rlPromise = (async () => {
        let rlRes: Response;
        try {
          rlRes = await fetch("/api/admin/resolution-latency-health", { headers });
        } catch (err) {
          setRlError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setResolutionLatency(null);
          return false;
        }
        if (rlRes.ok) {
          setResolutionLatency((await rlRes.json()) as ResolutionLatencyResponse);
          setRlError(null);
          return true;
        }
        const body = (await rlRes.json().catch(() => ({}))) as { error?: string };
        setRlError({
          kind: rlRes.status === 401 ? "auth" : "server",
          message: body.error ?? `HTTP ${rlRes.status}`,
        });
        setResolutionLatency(null);
        return false;
      })();

      const phPromise = (async () => {
        let response: Response;
        try {
          response = await fetch("/api/admin/playback-health", { headers });
        } catch (err) {
          setPhError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setPlaybackHealth(null);
          return false;
        }
        if (response.ok) {
          setPlaybackHealth((await response.json()) as PlaybackHealthResponse);
          setPhError(null);
          return true;
        }
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setPhError({
          kind: response.status === 401 ? "auth" : "server",
          message: body.error ?? `HTTP ${response.status}`,
        });
        setPlaybackHealth(null);
        return false;
      })();

      // ── Spinitron-web (independent error path) ──────────────────────────
      const swPromise = (async () => {
        let swRes: Response;
        try {
          swRes = await fetch("/api/admin/spinitron-web-health", { headers });
        } catch (err) {
          setSwError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setSpiWeb(null);
          return false;
        }
        if (swRes.ok) {
          setSpiWeb((await swRes.json()) as SpinitronWebResponse);
          setSwError(null);
          return true;
        }
        const body = (await swRes.json().catch(() => ({}))) as { error?: string };
        setSwError({
          kind: swRes.status === 401 ? "auth" : "server",
          message: body.error ?? `HTTP ${swRes.status}`,
        });
        setSpiWeb(null);
        return false;
      })();

      // ── Release-year health (independent: never poisons the core sections) ─
      const ryPromise = (async () => {
        let ryRes: Response;
        try {
          ryRes = await fetch("/api/admin/release-year-health", { headers });
        } catch (err) {
          // Network-level failure (no response at all).
          setRyError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setRyHealth(null);
          return false;
        }

        if (ryRes.ok) {
          setRyHealth((await ryRes.json()) as ReleaseYearHealth);
          setRyError(null);
          return true;
        } else {
          const body = (await ryRes.json().catch(() => ({}))) as { error?: string };
          const isAuth = ryRes.status === 401;
          setRyError({
            kind: isAuth ? "auth" : "server",
            message:
              body.error ??
              (isAuth
                ? "check your admin token"
                : "unable to load release year counts"),
          });
          setRyHealth(null);
          return false;
        }
      })();

      // ── Duration health (independent: never poisons the core sections) ──
      const durationPromise = (async () => {
        let durationRes: Response;
        try {
          durationRes = await fetch("/api/admin/duration-health", { headers });
        } catch (err) {
          setDurationError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setDurationHealth(null);
          return false;
        }
        if (durationRes.ok) {
          setDurationHealth((await durationRes.json()) as DurationHealth);
          setDurationError(null);
          return true;
        }
        const body = (await durationRes.json().catch(() => ({}))) as { error?: string };
        setDurationError({
          kind: durationRes.status === 401 ? "auth" : "server",
          message: body.error ?? `HTTP ${durationRes.status}`,
        });
        setDurationHealth(null);
        return false;
      })();

      const genrePromise = (async () => {
        let response: Response;
        try {
          response = await fetch("/api/admin/genre-enrichment-health", { headers });
        } catch (err) {
          setGenreError({
            kind: "server",
            message: err instanceof Error ? err.message : "Network error",
          });
          setGenreHealth(null);
          return false;
        }
        if (response.ok) {
          setGenreHealth((await response.json()) as GenreEnrichmentHealth);
          setGenreError(null);
          return true;
        }
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setGenreError({
          kind: response.status === 401 ? "auth" : "server",
          message: body.error ?? `HTTP ${response.status}`,
        });
        setGenreHealth(null);
        return false;
      })();

      try {
        const [ffOk, rlOk, phOk, swOk, ryOk, durationOk, genreOk] = await Promise.all([
          ffPromise,
          rlPromise,
          phPromise,
          swPromise,
          ryPromise,
          durationPromise,
          genrePromise,
        ]);
        // Only show the top-level error when every endpoint fails at once.
        // Each section already renders its own per-section banner; the shared
        // top-level banner is a last-resort "nothing works at all" indicator.
        if (!ffOk && !rlOk && !phOk && !swOk && !ryOk && !durationOk && !genreOk) {
          setLoadError("All health endpoints failed — check server logs");
        }
        setLastRefreshed(new Date());
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    // Defer into a microtask callback so state updates happen asynchronously
    // (from the fetch result) rather than synchronously in the effect body.
    void Promise.resolve().then(() => fetchAll());
    timerRef.current = setInterval(() => void fetchAll({ silent: true }), REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll]);

  const totalStale = (feedFreshness?.staleCount ?? 0) + (spiWeb?.staleCount ?? 0);
  const playbackDegradedCount =
    playbackHealth?.summaries.filter((summary) => summary.health === "degraded").length ?? 0;
  // "All healthy" only when both feed sections loaded without error and report no stale stations.
  const allHealthy =
    !loading &&
    !loadError &&
    !ffError &&
    !swError &&
    totalStale === 0;

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-wide text-primary">
              <Radio className="h-3.5 w-3.5" />
              Admin · Feed health
            </div>
            <h1 className="mt-2 font-serif text-4xl font-normal text-foreground">
              Station feed health
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              Alerts when a feed goes silent. Refreshes every 30 seconds.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
            <button
              onClick={() => void fetchAll()}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {lastRefreshed && (
              <span className="text-[13px] text-muted-foreground">
                Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={onClearToken}
              className="text-[13px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>

        <AdminNav token={token} />

        {/* Monitoring-since banner */}
        {!loading && feedFreshness && (
          <MonitoringBanner monitoringSince={feedFreshness.monitoringSince} />
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Top-level error — only when all three endpoints fail simultaneously */}
        {!loading && loadError && (
          <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-base text-destructive">
            <span className="font-normal">Error loading health data:</span> {loadError}
          </div>
        )}

        {/* All healthy */}
        {allHealthy && (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-zinc-500" />
            <p className="text-lg font-normal text-foreground">All feeds healthy</p>
            <p className="max-w-xs text-base text-muted-foreground">
              No silent stations detected. BBC and SomaFM feeds are receiving spins on schedule.
            </p>
          </div>
        )}

        {/* Feed freshness section — error or data, independent of spinitron-web */}
        {!loading && ffError && (
          <SectionErrorBanner
            icon={<Clock className="h-4 w-4" />}
            title="Silent feeds"
            kind={ffError.kind}
            message={ffError.message}
            data-testid="ff-error-banner"
          />
        )}
        {!loading && !ffError && feedFreshness && feedFreshness.staleCount > 0 && (
          <section className="mt-10">
            <SectionHeading
              icon={<Clock className="h-4 w-4" />}
              title="Silent feeds"
              badge={feedFreshness.staleCount}
              description="Stations whose fixed-size feed (BBC, SomaFM) hasn't produced a new spin within 2× its poll interval."
            />
            <div className="mt-4 flex flex-col gap-3">
              {feedFreshness.stations.map((s) => (
                <FeedFreshnessCard key={s.stationId} station={s} />
              ))}
            </div>
          </section>
        )}

        {/* Resolution latency section — independent of feed freshness */}
        {!loading && rlError && (
          <SectionErrorBanner
            icon={<Clock className="h-4 w-4" />}
            title="Slow track resolution"
            kind={rlError.kind}
            message={rlError.message}
            data-testid="rl-error-banner"
          />
        )}
        {!loading && !rlError && resolutionLatency && (
          <section className="mt-10" data-testid="resolution-latency-section">
            <SectionHeading
              icon={<Clock className="h-4 w-4" />}
              title="Slow track resolution"
              badge={resolutionLatency.slowCount}
              description={`Stations whose rolling median source-to-resolved latency exceeds ${formatDuration(resolutionLatency.slowThresholdMs)}.`}
            />
            {resolutionLatency.slowCount === 0 ? (
              <div className="mt-4">
                <HealthyRow label="Resolution latency" detail="All stations resolving quickly" />
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {resolutionLatency.stations.map((s) => (
                  <ResolutionLatencyCard key={s.stationId} station={s} />
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && phError && (
          <SectionErrorBanner
            icon={<Radio className="h-4 w-4" />}
            title="Listener playback"
            kind={phError.kind}
            message={phError.message}
            data-testid="playback-health-error"
          />
        )}
        {!loading && !phError && playbackHealth && (
          <section className="mt-10" data-testid="playback-health-section">
            <SectionHeading
              icon={<Radio className="h-4 w-4" />}
              title="Listener playback"
              badge={playbackDegradedCount}
                description={`Rolling ${playbackHealth.rollupWindowDays}-day rollup · last sample ${formatHealthWindow(playbackHealth.lastSampleAt)}. Degraded above ${formatDuration(playbackHealth.thresholds.startupP95DegradedMs)} p95 or ${(playbackHealth.thresholds.failureRateDegraded * 100).toFixed(0)}% failures.`}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Window began {formatHealthWindow(playbackHealth.windowStartedAt)}.
            </p>
            {playbackHealth.summaries.length === 0 ? (
              <div className="mt-4">
                <HealthyRow
                  label="Playback measurements"
                  detail="Waiting for sampled listener sessions."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card/60">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-normal">Station</th>
                      <th className="px-3 py-3 font-normal">Source</th>
                      <th className="px-3 py-3 font-normal">Tap → audio</th>
                      <th className="px-3 py-3 font-normal">Stalls</th>
                      <th className="px-3 py-3 font-normal">Recovered</th>
                      <th className="px-3 py-3 font-normal">Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...playbackHealth.summaries]
                      .sort((a, b) =>
                        Number(b.health === "degraded") -
                        Number(a.health === "degraded"))
                      .map((summary) => (
                        <tr
                          key={`${summary.stationSlug}:${summary.transport}:${summary.format}:${summary.warmed === true ? "warmed" : "ordinary"}`}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="px-4 py-3 font-mono text-foreground">
                            {summary.stationSlug}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {summary.transport} · {summary.format} ·{" "}
                            {summary.warmed === true ? "warmed" : "ordinary"}
                          </td>
                          <td className="px-3 py-3 text-foreground">
                            {summary.startupP50Ms === null
                              ? "—"
                              : `${formatDuration(summary.startupP50Ms)} p50`}
                            {summary.startupP95Ms === null
                              ? ""
                              : ` · ${formatDuration(summary.startupP95Ms)} p95`}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {summary.stallCount}
                            {summary.stallP95Ms === null
                              ? ""
                              : ` · ${formatDuration(summary.stallP95Ms)} p95`}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {summary.recoveryCount}
                          </td>
                          <td
                            className={`px-3 py-3 ${
                              summary.health === "degraded"
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {(summary.failureRate * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Spinitron web section — error or data, independent of feed-freshness */}
        {!loading && swError && (
          <SectionErrorBanner
            icon={<Wifi className="h-4 w-4" />}
            title="Spinitron scraper failures"
            kind={swError.kind}
            message={swError.message}
            data-testid="sw-error-banner"
          />
        )}
        {!loading && !swError && spiWeb && spiWeb.staleCount > 0 && (
          <section className="mt-10">
            <SectionHeading
              icon={<Wifi className="h-4 w-4" />}
              title="Spinitron scraper failures"
              badge={spiWeb.staleCount}
              description="Spinitron-web stations returning consecutive null results for more than 10 minutes."
            />
            <div className="mt-4 flex flex-col gap-3">
              {spiWeb.stations.map((s) => (
                <SpinitronWebCard key={s.stationId} station={s} />
              ))}
            </div>
          </section>
        )}

        {/* Release year enrichment health — always independent */}
        {!loading && ryHealth !== null && (
          <ReleaseYearHealthSection health={ryHealth} token={token} onRunComplete={() => void fetchAll({ silent: true })} />
        )}
        {!loading && ryError !== null && (
          <ReleaseYearErrorBanner kind={ryError.kind} message={ryError.message} />
        )}

        {!loading && durationHealth !== null && (
          <DurationHealthSection
            health={durationHealth}
            token={token}
            onRunComplete={() => void fetchAll({ silent: true })}
          />
        )}
        {!loading && durationError !== null && (
          <SectionErrorBanner
            icon={<Clock className="h-4 w-4" />}
            title="Duration enrichment"
            kind={durationError.kind}
            message={durationError.message}
            data-testid="duration-error-banner"
          />
        )}

        {!loading && genreHealth !== null && (
          <GenreEnrichmentHealthSection health={genreHealth} />
        )}
        {!loading && genreError !== null && (
          <SectionErrorBanner
            icon={<Tag className="h-4 w-4" />}
            title="Genre enrichment"
            kind={genreError.kind}
            message={genreError.message}
            data-testid="genre-error-banner"
          />
        )}

        {!loading && <StationHistorySection token={token} />}
        {!loading && <StationStoreAuditSection token={token} />}

        {/* Radio Browser bulk re-probe + fingerprint scout — admin tools */}
        {!loading && <BulkReprobeSection token={token} />}
        {!loading && <ScoutReportSection token={token} />}

        {/* Free-metadata source coverage ledger + probe/repair tool */}
        {!loading && <SourceCoverageSection token={token} />}

        {/* Healthy sub-sections when one section is OK but the other is stale */}
        {!loading && !ffError && !swError && totalStale > 0 && (
          <div className="mt-8 flex flex-col gap-2">
            {feedFreshness && feedFreshness.staleCount === 0 && (
              <HealthyRow label="Feed freshness" detail="BBC and SomaFM feeds are on schedule." />
            )}
            {spiWeb && spiWeb.staleCount === 0 && (
              <HealthyRow label="Spinitron scraper" detail="All spinitron_web stations are returning results." />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

/** Constant above which we consider the monitoring state "established". */
const SETTLED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function MonitoringBanner({ monitoringSince }: { monitoringSince: string }) {
  const since = new Date(monitoringSince);
  // Capture "now" once at mount via a state initializer so render stays pure.
  const [mountedAt] = useState(() => Date.now());
  const uptimeMs = mountedAt - since.getTime();
  const isNew = uptimeMs < SETTLED_THRESHOLD_MS;

  return (
    <div
      className={`mt-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-base ${
        isNew
          ? "border-zinc-500/30 bg-zinc-500/5 text-zinc-700 dark:text-zinc-300"
          : "border-border bg-card/60 text-muted-foreground"
      }`}
    >
      <Info className={`mt-0.5 h-4 w-4 shrink-0 ${isNew ? "text-zinc-500" : "text-muted-foreground"}`} />
      <div>
        <span className="font-normal text-foreground">
          Monitoring since {since.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="ml-1">({formatDuration(uptimeMs)} ago)</span>
        {isNew && (
          <p className="mt-0.5 text-sm">
            Health state resets on every server restart — data may not yet reflect pre-restart
            conditions. Results will stabilise after feeds have had time to report.
          </p>
        )}
        {!isNew && (
          <span className="ml-1 text-sm">· Health state resets on server restart.</span>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  badge,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  badge: number;
  description: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">{icon}</span>
        <h2 className="font-normal text-foreground">{title}</h2>
        <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
          {badge}
        </span>
      </div>
      <p className="mt-1 text-base text-muted-foreground">{description}</p>
    </div>
  );
}

function HealthyRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-zinc-500" />
      <div>
        <span className="text-base font-normal text-foreground">{label}</span>
        <span className="ml-2 text-base text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

function FeedFreshnessCard({ station }: { station: FeedFreshnessStation }) {
  const silentFor = formatDuration(station.staleSinceMs);
  const threshold = formatDuration(station.thresholdMs);
  const pollInterval = formatDuration(station.pollIntervalMs);

  return (
    <div className="rounded-xl border border-zinc-500/30 bg-zinc-500/5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <div>
            <span className="font-mono text-base font-normal text-foreground">
              {station.slug}
            </span>
            <span className="ml-2 rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[13px] text-muted-foreground">
              {station.source}
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-500/20 px-2.5 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
          silent {silentFor}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-base sm:grid-cols-3">
        <DataRow label="Last spin" value={formatTimestamp(station.lastSpinAt)} />
        <DataRow label="Last poll" value={formatTimestamp(station.lastEmptyAt)} />
        <DataRow label="Consecutive empty" value={String(station.consecutiveEmpties)} />
        <DataRow label="Poll interval" value={pollInterval} />
        <DataRow label="Alert threshold" value={threshold} />
      </dl>
    </div>
  );
}

function ResolutionLatencyCard({ station }: { station: ResolutionLatencyStation }) {
  return (
    <div className="rounded-xl border border-zinc-500/30 bg-zinc-500/5 px-5 py-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
        <span className="font-mono text-base font-normal text-foreground">{station.slug}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-base sm:grid-cols-4">
        <DataRow label="Samples" value={String(station.sampleCount)} />
        <DataRow label="Median" value={formatDuration(station.medianMs)} />
        <DataRow label="p95" value={formatDuration(station.p95Ms)} />
        <DataRow label="Max" value={formatDuration(station.maxMs)} />
      </dl>
    </div>
  );
}

function SpinitronWebCard({ station }: { station: SpinitronWebStation }) {
  const silentFor = formatDuration(station.staleSinceMs);

  return (
    <div className="rounded-xl border border-zinc-500/30 bg-zinc-500/5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <span className="font-mono text-base font-normal text-foreground">
            {station.slug}
          </span>
          <span className="rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[13px] text-muted-foreground">
            spinitron_web
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-500/20 px-2.5 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
          failing {silentFor}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-base sm:grid-cols-3">
        <DataRow label="Last success" value={formatTimestamp(station.lastSuccessAt)} />
        <DataRow label="Last null" value={formatTimestamp(station.lastNullAt)} />
        <DataRow label="Consecutive nulls" value={String(station.consecutiveNulls)} />
      </dl>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function formatCoverage(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function GenreEnrichmentHealthSection({
  health,
}: {
  health: GenreEnrichmentHealth;
}) {
  const laggingStations = health.stationCoverage.filter(
    (station) =>
      station.eligible > 0 &&
      (station.attemptedCoverage ?? 0) < 0.95,
  );

  return (
    <section className="mt-10">
      <SectionHeading
        icon={<Tag className="h-4 w-4" />}
        title="Genre enrichment"
        badge={health.pending + health.transientFailure}
        description={`Durable provider outcomes and ${health.recentWindowDays}-day coverage for active front-door stations.`}
      />
      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-5">
          {[
            ["Pending", health.pending, "never attempted"],
            ["Transient", health.transientFailure, "will retry"],
            ["No result", health.noResult, "definitive empty"],
            ["Enriched", health.enriched, "genre found"],
            ["Ineligible", health.ineligible, "provider-only ID"],
          ].map(([label, value, detail]) => (
            <div key={String(label)}>
              <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
                {Number(value).toLocaleString()}
              </dd>
              <dd className="text-sm text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <DataRow
            label="Recent attempted"
            value={`${formatCoverage(health.recentAttemptedCoverage)} · ${health.recentAttempted}/${health.recentEligible}`}
          />
          <DataRow
            label="Recent genre coverage"
            value={`${formatCoverage(health.recentGenreCoverage)} · ${health.recentEnriched}/${health.recentEligible}`}
          />
          <DataRow
            label="Attempts in 24h"
            value={health.attemptsLast24h.toLocaleString()}
          />
          <DataRow
            label="Oldest pending evidence"
            value={formatTimestamp(health.oldestPendingAt)}
          />
          <DataRow
            label="Last attempt"
            value={formatTimestamp(health.lastAttemptAt)}
          />
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              Station attempted coverage
            </p>
            <span className="text-sm text-muted-foreground">
              {laggingStations.length === 0
                ? "All eligible stations ≥95%"
                : `${laggingStations.length} below 95%`}
            </span>
          </div>
          {laggingStations.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {laggingStations.map((station) => (
                <div
                  key={station.stationId}
                  className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2"
                >
                  <span className="font-mono text-sm text-foreground">
                    {station.slug}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {formatCoverage(station.attemptedCoverage)}
                    {" · "}
                    {station.attempted}/{station.eligible}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Release year enrichment health ───────────────────────────────────────

function SectionErrorBanner({
  icon,
  title,
  kind,
  message,
  "data-testid": testId,
}: {
  icon: React.ReactNode;
  title: string;
  kind: "auth" | "server";
  message: string;
  "data-testid"?: string;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">{icon}</span>
        <h2 className="font-normal text-foreground">{title}</h2>
      </div>
      <div
        className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4"
        role="alert"
        data-testid={testId}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-base font-normal text-destructive">
              {kind === "auth"
                ? "Authentication error — could not load this section"
                : "Server error — could not load this section"}
            </p>
            <p className="mt-1 text-sm text-destructive/80">{message}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReleaseYearErrorBanner({
  kind,
  message,
}: {
  kind: "auth" | "server";
  message: string;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">
          <Tag className="h-4 w-4" />
        </span>
        <h2 className="font-normal text-foreground">Release year enrichment</h2>
      </div>
      <div
        className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4"
        role="alert"
        data-testid="ry-error-banner"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-base font-normal text-destructive">
              {kind === "auth"
                ? "Authentication error — could not load release year health"
                : "Server error — could not load release year health"}
            </p>
            <p className="mt-1 text-sm text-destructive/80">{message}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

interface RunBatchResult {
  scanned: number;
  found: number;
  remaining: number;
}

interface DurationRunBatchResult {
  scanned: number;
  updated: number;
  noResult: number;
  failed: number;
  remaining: number;
}

interface UnmatchedRunBatchResult {
  candidates?: number;
  scanned?: number;
  attempted?: number;
  resolved?: number;
  deferred?: number;
  unavailable?: number;
  definitiveMiss?: number;
  remaining?: number;
  skipped?: boolean;
}

function DurationHealthSection({
  health,
  token,
  onRunComplete,
}: {
  health: DurationHealth;
  token: string;
  onRunComplete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<DurationRunBatchResult | string | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueDone = health.inQueue === 0;

  const handleRunBatch = useCallback(async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const response = await fetch("/api/admin/duration-backfill/run", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setRunResult(body.error ?? `HTTP ${response.status}`);
      } else {
        setRunResult((await response.json()) as DurationRunBatchResult);
        onRunComplete();
      }
    } catch (err) {
      setRunResult(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => setRunResult(null), 8_000);
    }
  }, [onRunComplete, token]);

  return (
    <section className="mt-10" data-testid="duration-health-section">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">
          <Clock className="h-4 w-4" />
        </span>
        <h2 className="font-normal text-foreground">Duration enrichment</h2>
        {health.totalNull > 0 && (
          <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
            {health.totalNull.toLocaleString()} missing
          </span>
        )}
      </div>
      <p className="mt-1 text-base text-muted-foreground">
        Missing track lengths prevent expiry hints. A paced background job checks
        aired recordings against MusicBrainz, then verifies an existing Spotify
        match when MusicBrainz has no length.
      </p>
      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-4">
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Total missing
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {health.totalNull.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">duration_ms IS NULL</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              In backfill queue
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {health.inQueue.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">aired, eligible, not checked</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Provider miss
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {health.permMiss.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">no trusted length found</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Ineligible
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {health.ineligible.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">synthetic or never aired</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <button
            onClick={() => void handleRunBatch()}
            disabled={running || queueDone}
            className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${running ? "animate-spin" : ""}`} />
            {running ? "Running…" : "Run batch now"}
          </button>
          <span className="text-sm text-muted-foreground">
            {queueDone
              ? "Queue is clear."
              : `Last checked ${formatTimestamp(health.lastCheckedAt)}`}
          </span>
          {runResult !== null && (
            <span className="text-sm text-muted-foreground" data-testid="duration-run-receipt">
              {typeof runResult === "string" ? (
                <span className="text-destructive">{runResult}</span>
              ) : (
                <>
                  scanned <span className="font-mono text-foreground">{runResult.scanned}</span>
                  {" · updated "}
                  <span className="font-mono text-foreground">{runResult.updated}</span>
                  {" · no result "}
                  <span className="font-mono text-foreground">{runResult.noResult}</span>
                  {" · failed "}
                  <span className="font-mono text-amber-600 dark:text-amber-400">
                    {runResult.failed}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function ReleaseYearHealthSection({
  health,
  token,
  onRunComplete,
}: {
  health: ReleaseYearHealth;
  token: string;
  onRunComplete: () => void;
}) {
  const {
    totalNull,
    inQueue,
    permMiss,
    ineligible,
    lastCheckedAt,
    datePending,
    dateInQueue,
    datePermMiss,
    dateLastCheckedAt,
    unmatchedCandidates = 0,
    unmatchedResolved = 0,
    unmatchedDeferred = 0,
    unmatchedUnavailable = 0,
    unmatchedLastAttemptAt = null,
  } = health;
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunBatchResult | string | null>(null);
  const [unmatchedRunning, setUnmatchedRunning] = useState(false);
  const [unmatchedRunResult, setUnmatchedRunResult] =
    useState<UnmatchedRunBatchResult | string | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmatchedResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRunBatch = useCallback(async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/admin/release-year-backfill/run", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRunResult(body.error ?? `HTTP ${res.status}`);
      } else {
        const data = (await res.json()) as RunBatchResult;
        setRunResult(data);
        onRunComplete();
      }
    } catch (err) {
      setRunResult(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
      // Clear the inline result after 8 s so it doesn't linger.
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => setRunResult(null), 8_000);
    }
  }, [token, onRunComplete]);

  const handleRunUnmatchedBatch = useCallback(async () => {
    setUnmatchedRunning(true);
    setUnmatchedRunResult(null);
    try {
      const res = await fetch("/api/admin/unmatched-spin-backfill/run", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setUnmatchedRunResult(body.error ?? `HTTP ${res.status}`);
      } else {
        setUnmatchedRunResult((await res.json()) as UnmatchedRunBatchResult);
        onRunComplete();
      }
    } catch (err) {
      setUnmatchedRunResult(err instanceof Error ? err.message : "Request failed");
    } finally {
      setUnmatchedRunning(false);
      if (unmatchedResultTimerRef.current) {
        clearTimeout(unmatchedResultTimerRef.current);
      }
      unmatchedResultTimerRef.current = setTimeout(
        () => setUnmatchedRunResult(null),
        8_000,
      );
    }
  }, [token, onRunComplete]);

  const queueDone = inQueue === 0;

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">
          <Tag className="h-4 w-4" />
        </span>
        <h2 className="font-normal text-foreground">Release year enrichment</h2>
        {totalNull > 0 && (
          <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
            {totalNull.toLocaleString()} unknown
          </span>
        )}
      </div>
      <p className="mt-1 text-base text-muted-foreground">
        Recordings without a release year pass through the age filter unchecked
        (First/Current/Catalog/Deep). The backfill job queries MusicBrainz for
        aired, non-synthetic recordings continuously to fill the gap.
      </p>

      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">
            Recent unmatched spin convergence
          </h3>
          <span className="text-[12px] text-muted-foreground">
            (last 30 days · scored MusicBrainz matches only)
          </span>
          <button
            onClick={() => void handleRunUnmatchedBatch()}
            disabled={unmatchedRunning || unmatchedCandidates === 0}
            className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${unmatchedRunning ? "animate-spin" : ""}`} />
            {unmatchedRunning ? "Running…" : "Resolve batch now"}
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Unresolved station metadata is retried in bounded background batches.
          Clear misses are remembered; temporary MusicBrainz failures remain deferred.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-4">
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Candidates
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {unmatchedCandidates.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">not yet attempted</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Resolved
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {unmatchedResolved.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">canonical recording attached</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Deferred
            </dt>
            <dd
              className="mt-0.5 font-mono text-2xl tabular-nums text-amber-600 dark:text-amber-400"
              data-testid="unmatched-deferred-count"
            >
              {unmatchedDeferred.toLocaleString()}
            </dd>
            <dd className="text-sm text-amber-600/80 dark:text-amber-400/80">
              retryable provider failure
            </dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-destructive">
              Definitive misses
            </dt>
            <dd
              className="mt-0.5 font-mono text-2xl tabular-nums text-destructive"
              data-testid="unmatched-definitive-miss-count"
            >
              {unmatchedUnavailable.toLocaleString()}
            </dd>
            <dd className="text-sm text-destructive/80">permanent no match</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
          <span>
            {unmatchedLastAttemptAt
              ? `Last lookup: ${formatTimestamp(unmatchedLastAttemptAt)}`
              : "No convergence lookup has run yet."}
          </span>
          {unmatchedRunResult !== null && (
            <span data-testid="unmatched-run-receipt">
              {typeof unmatchedRunResult === "string" ? (
                <span className="text-destructive">{unmatchedRunResult}</span>
              ) : (
                <>
                  attempted{" "}
                  <span className="font-mono text-foreground">
                    {(
                      unmatchedRunResult.attempted ??
                      unmatchedRunResult.scanned ??
                      0
                    ).toLocaleString()}
                  </span>
                  {" · resolved "}
                  <span className="font-mono text-foreground">
                    {(unmatchedRunResult.resolved ?? 0).toLocaleString()}
                  </span>
                  {" · deferred "}
                  <span className="font-mono text-amber-600 dark:text-amber-400">
                    {(unmatchedRunResult.deferred ?? 0).toLocaleString()}
                  </span>
                  {" · definitive misses "}
                  <span className="font-mono text-destructive">
                    {(
                      unmatchedRunResult.definitiveMiss ??
                      unmatchedRunResult.unavailable ??
                      0
                    ).toLocaleString()}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-4">
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Total missing
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {totalNull.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">release_year IS NULL</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              In backfill queue
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {inQueue.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">aired, eligible, not yet checked</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Permanent MB miss
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {permMiss.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">checked, no date on MB</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Ineligible
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {ineligible.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">synthetic or never aired</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <p className="flex-1 text-sm text-muted-foreground">
            {totalNull === 0 && (
              <span className="text-zinc-500">All recordings have a release year ✓</span>
            )}
            {totalNull > 0 && queueDone && lastCheckedAt && (
              <>
                <span className="text-zinc-500">
                  Queue exhausted — no eligible work remaining.
                </span>
                <span className="ml-2">
                  Last MB lookup:{" "}
                  <span className="font-mono text-foreground">
                    {formatTimestamp(lastCheckedAt)}
                  </span>
                </span>
              </>
            )}
            {totalNull > 0 && !queueDone && lastCheckedAt && (
              <>
                <span className="text-zinc-500">Backfill in progress.</span>
                <span className="ml-2">
                  Last MB lookup:{" "}
                  <span className="font-mono text-foreground">
                    {formatTimestamp(lastCheckedAt)}
                  </span>
                </span>
              </>
            )}
            {totalNull > 0 && !queueDone && !lastCheckedAt && (
              <span className="text-zinc-500">
                Backfill not yet started — will begin after a short delay on
                server boot.
              </span>
            )}
          </p>

          <div className="flex shrink-0 items-center gap-3">
            {runResult !== null && (
              <span className="text-sm text-muted-foreground">
                {typeof runResult === "string" ? (
                  <span className="text-destructive">{runResult}</span>
                ) : (
                  <span>
                    found{" "}
                    <span className="font-mono text-foreground">{runResult.found}</span>
                    {" of "}
                    <span className="font-mono text-foreground">{runResult.scanned}</span>
                    {" scanned · "}
                    <span className="font-mono text-foreground">{runResult.remaining}</span>
                    {" remaining"}
                  </span>
                )}
              </span>
            )}
            <button
              onClick={() => void handleRunBatch()}
              disabled={running || inQueue === 0}
              className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${running ? "animate-spin" : ""}`} />
              {running ? "Running…" : "Run batch now"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Release-date backfill coverage ─────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-foreground">Release date enrichment</h3>
          <span className="text-[12px] text-muted-foreground">
            (recent releases only — premiere tier)
          </span>
          {datePending > 0 && (
            <span className="ml-auto rounded-full bg-zinc-500/15 px-2 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
              {datePending.toLocaleString()} pending
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Full partial-ISO dates (e.g. 2025-03) are needed for the Dial&rsquo;s
          First/premiere tier. Only recordings with{" "}
          <span className="font-mono text-xs">release_year &ge; currentYear&minus;1</span> are
          targeted — the full back-catalog is deliberately skipped.
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-3">
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Pending dates
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {datePending.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">recent, release_date IS NULL</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              In queue
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {dateInQueue.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">eligible, not yet checked</dd>
          </div>
          <div>
            <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
              Permanent MB miss
            </dt>
            <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
              {datePermMiss.toLocaleString()}
            </dd>
            <dd className="text-sm text-muted-foreground">checked, no date on MB</dd>
          </div>
        </dl>
        <div className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          {datePending === 0 && (
            <span className="text-zinc-500">All recent recordings have a release date ✓</span>
          )}
          {datePending > 0 && dateInQueue === 0 && dateLastCheckedAt && (
            <>
              <span className="text-zinc-500">Date queue exhausted.</span>
              <span className="ml-2">
                Last checked:{" "}
                <span className="font-mono text-foreground">
                  {formatTimestamp(dateLastCheckedAt)}
                </span>
              </span>
            </>
          )}
          {datePending > 0 && dateInQueue > 0 && dateLastCheckedAt && (
            <>
              <span className="text-zinc-500">Date backfill in progress.</span>
              <span className="ml-2">
                Last checked:{" "}
                <span className="font-mono text-foreground">
                  {formatTimestamp(dateLastCheckedAt)}
                </span>
              </span>
            </>
          )}
          {datePending > 0 && dateInQueue > 0 && !dateLastCheckedAt && (
            <span className="text-zinc-500">
              Date backfill not yet started — will run with the year backfill job.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Radio Browser bulk re-probe ───────────────────────────────────────────

interface BulkReprobeStatus {
  running: boolean;
  total: number;
  probed: number;
  recovered: number;
  stillBad: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/**
 * Admin tool: re-probe every icy_unsupported Radio Browser station. The POST
 * starts a background run on the server (single-flight); this section polls
 * the status endpoint while a run is in flight and renders the final
 * probed/recovered/stillBad summary.
 */
function BulkReprobeSection({ token }: { token: string }) {
  const [status, setStatus] = useState<BulkReprobeStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/radio-browser/bulk-reprobe/status", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) return;
      const data = (await res.json()) as BulkReprobeStatus;
      setStatus(data);
      if (!data.running && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      // transient poll failure — keep the last status
    }
  }, [token]);

  useEffect(() => {
    // Defer into a microtask so state updates happen asynchronously rather
    // than synchronously in the effect body (same pattern as fetchAll above).
    void Promise.resolve().then(() => fetchStatus());
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // When this page opens or reloads during a server-side re-probe run, the
  // initial GET may already report running=true. Keep polling in that case
  // too; previously only the browser that initiated the POST polled progress.
  useEffect(() => {
    if (!status?.running) return;
    if (!pollRef.current) {
      pollRef.current = setInterval(() => void fetchStatus(), 5_000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.running, fetchStatus]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void fetchStatus(), 5_000);
  }, [fetchStatus]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/radio-browser/bulk-reprobe", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: BulkReprobeStatus;
      };
      if (!res.ok && res.status !== 409) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        if (body.status) setStatus(body.status);
        startPolling();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setStarting(false);
    }
  }, [token, startPolling]);

  const running = status?.running ?? false;

  return (
    <section className="mt-10" data-testid="bulk-reprobe-section">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">
          <RefreshCw className="h-4 w-4" />
        </span>
        <h2 className="font-normal text-foreground">Re-probe unsupported streams</h2>
      </div>
      <p className="mt-1 text-base text-muted-foreground">
        Radio Browser stations marked ICY-unsupported are never re-checked
        automatically. This probes each one again (~3s apart), reactivates
        streams that now answer with metadata, and re-enrolls their pollers
        live.
      </p>
      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => void handleStart()}
            disabled={starting || running}
            className="rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-sm text-foreground transition hover:bg-secondary disabled:opacity-50"
            data-testid="bulk-reprobe-start"
          >
            {running ? "Re-probing…" : "Re-probe all unsupported"}
          </button>
          {status && (status.running || status.finishedAt) && (
            <span className="text-sm text-muted-foreground" data-testid="bulk-reprobe-summary">
              {status.running
                ? `${status.probed} of ${status.total} probed · ${status.recovered} recovered`
                : `Done: ${status.probed} probed · ${status.recovered} recovered · ${status.stillBad} still unsupported`}
            </span>
          )}
        </div>
        {(error ?? status?.error) && (
          <p className="mt-2 text-sm text-destructive">{error ?? status?.error}</p>
        )}
      </div>
    </section>
  );
}

// ─── Fingerprint scout report ──────────────────────────────────────────────

interface ScoutReportRow {
  stationId: number;
  stationName: string;
  samples: number;
  recognitions: number;
  crossings: number;
  firstPlays: number;
  lastSampledAt: string | null;
  flag: "promote" | "remove" | "scouting";
}

interface ScoutReport {
  available: boolean;
  stations: ScoutReportRow[];
}

const SCOUT_FLAG_LABEL: Record<ScoutReportRow["flag"], string> = {
  promote: "Promote candidate",
  remove: "Remove candidate",
  scouting: "Still scouting",
};

const SCOUT_FLAG_CLASS: Record<ScoutReportRow["flag"], string> = {
  promote: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  remove: "bg-red-500/15 text-red-600 dark:text-red-400",
  scouting: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

/**
 * Per-station results from the rotating audio-fingerprint scout: samples
 * taken, recognition rate, taste crossings, first plays, and the computed
 * promote/remove/still-scouting flag. The report only flags — the admin
 * decides; nothing is auto-removed.
 */
function ScoutReportSection({ token }: { token: string }) {
  const [report, setReport] = useState<ScoutReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/fingerprint-scout/report", {
          headers: { "x-admin-token": token },
        });
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as ScoutReport;
        if (!cancelled) {
          setReport(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed");
      }
    };
    // Defer into a microtask so state updates happen asynchronously rather
    // than synchronously in the effect body (same pattern as fetchAll above).
    void Promise.resolve().then(() => load());
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  return (
    <section className="mt-10" data-testid="scout-report-section">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">
          <Radio className="h-4 w-4" />
        </span>
        <h2 className="font-normal text-foreground">Fingerprint scout</h2>
        {report && report.stations.length > 0 && (
          <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-sm font-normal text-zinc-600 dark:text-zinc-400">
            {report.stations.length} scouted
          </span>
        )}
      </div>
      <p className="mt-1 text-base text-muted-foreground">
        The scout rotates through metadata-dark stations, fingerprinting one
        every couple of minutes. High crossings or first plays flag a station
        worth keeping; nothing recognized after enough samples flags a
        removal candidate. You decide — nothing is removed automatically.
      </p>
      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && report && !report.available && (
          <p className="text-base text-muted-foreground">
            Scout disabled — no AudD API key configured.
          </p>
        )}
        {!error && report && report.stations.length === 0 && report.available && (
          <p className="text-base text-muted-foreground">
            No stations sampled yet. The scout starts on the next tick.
          </p>
        )}
        {!error && report && report.stations.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[13px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">Station</th>
                  <th className="py-2 pr-4 font-normal">Samples</th>
                  <th className="py-2 pr-4 font-normal">Recognized</th>
                  <th className="py-2 pr-4 font-normal">Crossings</th>
                  <th className="py-2 pr-4 font-normal">First plays</th>
                  <th className="py-2 font-normal">Flag</th>
                </tr>
              </thead>
              <tbody>
                {report.stations.map((row) => (
                  <tr key={row.stationId} className="border-t border-border/60" data-testid={`scout-row-${row.stationId}`}>
                    <td className="py-2 pr-4 text-foreground">{row.stationName}</td>
                    <td className="py-2 pr-4 font-mono">{row.samples}</td>
                    <td className="py-2 pr-4 font-mono">
                      {row.recognitions}
                      {row.samples > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          ({Math.round((row.recognitions / row.samples) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono">{row.crossings}</td>
                    <td className="py-2 pr-4 font-mono">{row.firstPlays}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[13px] ${SCOUT_FLAG_CLASS[row.flag]}`}>
                        {SCOUT_FLAG_LABEL[row.flag]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Source coverage ───────────────────────────────────────────────────────

interface SourceCoverageStation {
  id: number;
  slug: string;
  name: string;
  hidden: boolean;
  source: string | null;
  streamUrl: string | null;
  class: "healthy" | "recoverable" | "no_source" | "unavailable";
  fingerprintCandidate: boolean;
  guidance: string;
  lastUsableAt: string | null;
  lastArtist: string | null;
  lastTitle: string | null;
  probe: {
    kind: string;
    outcome: string;
    detail: string | null;
    resolvedUrl: string | null;
    sampleArtist: string | null;
    sampleTitle: string | null;
    probedAt: string;
  } | null;
}

interface SourceCoverageLedger {
  generatedAt: string;
  rosterSize: number;
  counts: Record<string, number>;
  fingerprintCandidateCount: number;
  stations: SourceCoverageStation[];
}

interface SourceProbeRunStatus {
  running: boolean;
  total: number;
  probed: number;
  usable: number;
  blank: number;
  unsupported: number;
  unreachable: number;
  repaired: number;
  skippedHidden: number;
  skippedOverride: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const COVERAGE_CLASS_LABEL: Record<SourceCoverageStation["class"], string> = {
  healthy: "Healthy",
  recoverable: "Recoverable",
  no_source: "No public source",
  unavailable: "Off-air / unreachable",
};

const COVERAGE_CLASS_STYLE: Record<SourceCoverageStation["class"], string> = {
  healthy: "text-zinc-500",
  recoverable: "text-amber-600 dark:text-amber-400",
  no_source: "text-destructive",
  unavailable: "text-muted-foreground",
};

function SourceCoverageSection({ token }: { token: string }) {
  const [ledger, setLedger] = useState<SourceCoverageLedger | null>(null);
  const [status, setStatus] = useState<SourceProbeRunStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/source-coverage", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setLedger((await res.json()) as SourceCoverageLedger);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, [token]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/source-coverage/probe/status", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) return;
      const data = (await res.json()) as SourceProbeRunStatus;
      setStatus(data);
      if (!data.running) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // A finished run changes the ledger — refresh it.
        void fetchLedger();
      }
    } catch {
      // transient poll failure — keep the last status
    }
  }, [token, fetchLedger]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void fetchLedger();
      void fetchStatus();
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLedger, fetchStatus]);

  // Keep polling while a run is in flight — including a run started by
  // another browser session (the initial GET may already report running).
  useEffect(() => {
    if (!status?.running) return;
    if (!pollRef.current) {
      pollRef.current = setInterval(() => void fetchStatus(), 5_000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.running, fetchStatus]);

  const handleProbe = useCallback(async () => {
    setStarting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/source-coverage/probe", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: SourceProbeRunStatus;
      };
      if (!res.ok && res.status !== 409) {
        setActionError(body.error ?? `HTTP ${res.status}`);
      } else {
        if (body.status) setStatus(body.status);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => void fetchStatus(), 5_000);
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setStarting(false);
    }
  }, [token, fetchStatus]);

  const nonHealthy = (ledger?.stations ?? []).filter((s) => s.class !== "healthy");

  return (
    <section className="mt-10" data-testid="source-coverage-section">
      <SectionHeading
        icon={<Wifi className="h-4 w-4" />}
        title="Free metadata coverage"
        badge={ledger ? ledger.counts["healthy"] ?? 0 : 0}
        description="Real-roster stations classified by what their public metadata surfaces supply. Only stations with no usable public source are fingerprint candidates."
      />

      {loadError && (
        <div
          className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4"
          role="alert"
          data-testid="sc-error-banner"
        >
          <p className="text-base font-normal text-destructive">
            Could not load source coverage
          </p>
          <p className="mt-1 text-sm text-destructive/80">{loadError}</p>
        </div>
      )}

      {ledger && (
        <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-base sm:grid-cols-5">
            <div>
              <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
                Healthy
              </dt>
              <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
                {ledger.counts["healthy"] ?? 0}
              </dd>
              <dd className="text-sm text-muted-foreground">public metadata flowing</dd>
            </div>
            <div>
              <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
                Recoverable
              </dt>
              <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
                {ledger.counts["recoverable"] ?? 0}
              </dd>
              <dd className="text-sm text-muted-foreground">free fix verified or plausible</dd>
            </div>
            <div>
              <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
                No public source
              </dt>
              <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
                {ledger.counts["no_source"] ?? 0}
              </dd>
              <dd className="text-sm text-muted-foreground">publishes nothing usable</dd>
            </div>
            <div>
              <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
                Off-air
              </dt>
              <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
                {ledger.counts["unavailable"] ?? 0}
              </dd>
              <dd className="text-sm text-muted-foreground">stream did not answer</dd>
            </div>
            <div>
              <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
                Fingerprint candidates
              </dt>
              <dd className="mt-0.5 font-mono text-2xl tabular-nums text-foreground">
                {ledger.fingerprintCandidateCount}
              </dd>
              <dd className="text-sm text-muted-foreground">residual paid-fallback set</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <p className="flex-1 text-sm text-muted-foreground">
              {ledger.rosterSize} real stations tracked · probe run{" "}
              {status?.finishedAt
                ? `finished ${formatTimestamp(status.finishedAt)} — ${status.probed} probed, ${status.usable} usable, ${status.repaired} repaired`
                : "has not run since boot"}
            </p>
            <button
              onClick={() => void handleProbe()}
              disabled={starting || status?.running === true}
              className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              data-testid="sc-run-probe"
            >
              <RefreshCw
                className={`h-3 w-3 ${starting || status?.running ? "animate-spin" : ""}`}
              />
              {status?.running
                ? `Probing ${status.probed}/${status.total}…`
                : "Run free-metadata probe"}
            </button>
          </div>
          {status?.error && (
            <p className="mt-2 text-sm text-destructive">Last run error: {status.error}</p>
          )}
          {actionError && (
            <p className="mt-2 text-sm text-destructive">{actionError}</p>
          )}
        </div>
      )}

      {ledger && nonHealthy.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {nonHealthy.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-card-border bg-card px-5 py-4"
              data-testid={`sc-station-${s.slug}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-normal text-foreground">{s.name}</span>
                <span
                  className={`shrink-0 text-sm font-normal ${COVERAGE_CLASS_STYLE[s.class]}`}
                >
                  {COVERAGE_CLASS_LABEL[s.class]}
                  {s.fingerprintCandidate ? " · fingerprint candidate" : ""}
                  {s.hidden ? " · hidden" : ""}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.guidance}</p>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>Source: {s.source ?? "none"}</span>
                {s.lastUsableAt && (
                  <span>
                    Last usable track: {s.lastArtist} — {s.lastTitle} (
                    {formatTimestamp(s.lastUsableAt)})
                  </span>
                )}
                {s.probe && (
                  <span>
                    Probe {s.probe.kind}: {s.probe.outcome}
                    {s.probe.sampleArtist
                      ? ` — heard “${s.probe.sampleArtist} — ${s.probe.sampleTitle}”`
                      : ""}
                    {` (${formatTimestamp(s.probe.probedAt)})`}
                  </span>
                )}
              </div>
              {s.probe?.detail && (
                <p className="mt-1 text-sm text-muted-foreground/80">{s.probe.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Station history archive recovery ───────────────────────────────────────

const HISTORY_STATUS_LABEL: Record<string, string> = {
  usable: "Usable",
  empty: "No rows",
  unsupported: "Unsupported",
  transient_failure: "Transient failure",
  parser_drift: "Parser drift",
  running: "Recovering",
  complete: "Complete",
  unverified: "Not audited",
};

const HISTORY_STATUS_CLASS: Record<string, string> = {
  usable: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  complete: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  running: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  empty: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  unverified: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  unsupported: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  parser_drift: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  transient_failure: "bg-red-500/15 text-red-700 dark:text-red-400",
};

function historyStatusLabel(status: string | null): string {
  return HISTORY_STATUS_LABEL[status ?? "unverified"] ?? status ?? "Unknown";
}

function historyStatusClass(status: string | null): string {
  return (
    HISTORY_STATUS_CLASS[status ?? "unverified"] ??
    "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
  );
}

function formatRecoveredDepth(oldestPublishedAt: string | null): string {
  if (!oldestPublishedAt) return "Not recovered yet";
  const timestamp = Date.parse(oldestPublishedAt);
  if (Number.isNaN(timestamp)) return "Unknown";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  const depth = days === 0 ? "<1 day" : `${days.toLocaleString()} days`;
  return `${depth} · ${formatTimestamp(oldestPublishedAt)}`;
}

function StationStoreAuditSection({ token }: { token: string }) {
  const [report, setReport] = useState<StoreAuditResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [queued, setQueued] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stations/store-audit", {
        headers: { "x-admin-token": token },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setReport((await response.json()) as StoreAuditResponse);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Network error");
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchReport());
    const timer = setInterval(() => void fetchReport(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchReport]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setQueued(false);
    try {
      const response = await fetch("/api/admin/stations/store-audit/run", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setQueued(true);
      window.setTimeout(() => void fetchReport(), 5_000);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setScanning(false);
    }
  }, [token, fetchReport]);

  const foundStations =
    report?.stations.filter((station) => station.storeStatus === "found") ?? [];
  const reviewStations =
    report?.stations.filter(
      (station) =>
        station.storeStatus === "pending" ||
        station.storeStatus === "unavailable" ||
        station.storeStatus === "blocked",
    ) ?? [];

  return (
    <section className="mt-10" data-testid="station-store-audit-section">
      <SectionHeading
        icon={<ShoppingBag className="h-4 w-4" />}
        title="Station store audit"
        badge={report?.summary.found ?? 0}
        description="Homepage-derived shop, merch, record, and ticket links for operator review. Nothing here is exposed to listeners."
      />

      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {report
              ? `${report.summary.found} found · ${report.summary.notFound} no link · ${report.summary.pending} pending · ${report.summary.unavailable + report.summary.blocked} unavailable`
              : "Loading store evidence…"}
          </div>
          <button
            onClick={() => void handleScan()}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            data-testid="station-store-audit-run"
          >
            <RefreshCw className={`h-3 w-3 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Starting…" : "Scan next 25"}
          </button>
        </div>
        {queued && (
          <p className="mt-2 text-sm text-muted-foreground">
            Batch accepted. The report refreshes automatically as checks finish.
          </p>
        )}
        {loadError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Could not load store audit: {loadError}
          </p>
        )}
      </div>

      {foundStations.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {foundStations.map((station) => (
            <div
              key={station.stationId}
              className="rounded-xl border border-card-border bg-card px-5 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-normal text-foreground">{station.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {station.storeLabel || "Store link"} · {station.storeSignal ?? "unknown"} evidence
                  </p>
                </div>
                {station.storeUrl && (
                  <a
                    href={station.storeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-full truncate text-sm text-primary underline underline-offset-2"
                  >
                    Open detected link
                  </a>
                )}
              </div>
              <p className="mt-2 break-all font-mono text-[12px] text-muted-foreground">
                {station.storeUrl}
              </p>
            </div>
          ))}
        </div>
      )}

      {report && foundStations.length === 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card/60 px-5 py-4 text-sm text-muted-foreground">
          No purchase links have been detected yet.
        </div>
      )}

      {reviewStations.length > 0 && (
        <details className="mt-4 rounded-xl border border-border bg-card/60 px-5 py-4">
          <summary className="cursor-pointer text-sm text-foreground">
            Review {reviewStations.length} unchecked or unavailable station
            {reviewStations.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            {reviewStations.map((station) => (
              <div
                key={station.stationId}
                className="flex items-center justify-between gap-4 border-t border-border/60 pt-2 text-sm"
              >
                <span className="min-w-0 truncate text-foreground">{station.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {station.storeStatus.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function StationHistorySection({ token }: { token: string }) {
  const [ledger, setLedger] = useState<StationHistoryResponse | null>(null);
  const [status, setStatus] = useState<HistoryAuditStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/station-history", {
        headers: { "x-admin-token": token },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const data = (await response.json()) as StationHistoryResponse;
      setLedger(data);
      setStatus((current) => current ?? data.audit);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Network error");
    }
  }, [token]);

  const fetchAuditStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/station-history/audit/status", {
        headers: { "x-admin-token": token },
      });
      if (!response.ok) return;
      const data = (await response.json()) as HistoryAuditStatus;
      setStatus(data);
      if (!data.running) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // An audit writes fresh ledger evidence; show it as soon as it ends.
        void fetchLedger();
      }
    } catch {
      // Keep the last status during a transient polling failure.
    }
  }, [token, fetchLedger]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void fetchLedger();
      void fetchAuditStatus();
    });
    const refreshTimer = setInterval(() => void fetchLedger(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(refreshTimer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLedger, fetchAuditStatus]);

  useEffect(() => {
    if (!status?.running) return;
    if (!pollRef.current) {
      pollRef.current = setInterval(() => void fetchAuditStatus(), 5_000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.running, fetchAuditStatus]);

  const startAuditPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void fetchAuditStatus(), 5_000);
  }, [fetchAuditStatus]);

  const handleStartAudit = useCallback(async () => {
    setStarting(true);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/station-history/audit", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: HistoryAuditStatus;
      };
      if (!response.ok && response.status !== 409) {
        setActionError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      if (body.status) {
        setStatus(body.status);
      } else {
        void fetchAuditStatus();
      }
      startAuditPolling();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setStarting(false);
    }
  }, [token, fetchAuditStatus, startAuditPolling]);

  const audit = status ?? ledger?.audit ?? null;
  const auditResult = audit?.result;

  return (
    <section className="mt-10" data-testid="station-history-section">
      <SectionHeading
        icon={<Archive className="h-4 w-4" />}
        title="Archive recovery"
        badge={ledger?.stations.length ?? 0}
        description="Curated stations with a deterministic history source, recovered depth, and backfill evidence. Audit runs are bounded and import-free."
      />

      {loadError && (
        <div
          className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4"
          role="alert"
          data-testid="station-history-error"
        >
          <p className="text-base font-normal text-destructive">
            Could not load archive recovery
          </p>
          <p className="mt-1 text-sm text-destructive/80">{loadError}</p>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-card-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {audit?.running ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
            ) : auditResult ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-zinc-500" />
            ) : (
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground" data-testid="station-history-audit-status">
              {audit?.running
                ? `Audit running${audit.startedAt ? ` since ${formatTimestamp(audit.startedAt)}` : "…"}`
                : auditResult
                  ? `Last audit: ${auditResult.usable} usable · ${auditResult.unsupported} unsupported · ${auditResult.transientFailures} transient failures`
                  : "No archive audit has run yet."}
            </p>
          </div>
          <button
            onClick={() => void handleStartAudit()}
            disabled={starting || audit?.running === true}
            className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            data-testid="station-history-audit-start"
          >
            <RefreshCw
              className={`h-3 w-3 ${starting || audit?.running ? "animate-spin" : ""}`}
            />
            {audit?.running ? "Auditing…" : "Run archive audit"}
          </button>
        </div>
        {audit?.running && (
          <p className="mt-2 text-sm text-muted-foreground">
            Checking the curated roster one station at a time. This pass records source evidence only; it does not import spins.
          </p>
        )}
        {auditResult && !audit?.running && (
          <p className="mt-2 text-sm text-muted-foreground">
            Audited {auditResult.audited} station{auditResult.audited === 1 ? "" : "s"}
            {audit.finishedAt ? ` · finished ${formatTimestamp(audit.finishedAt)}` : ""}.
          </p>
        )}
        {actionError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}
      </div>

      {ledger && ledger.stations.length === 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card/60 px-5 py-4 text-sm text-muted-foreground">
          No curated flagship stations are configured for archive recovery.
        </div>
      )}

      {ledger && ledger.stations.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {ledger.stations.map((station) => (
            <StationHistoryCard key={station.stationId} station={station} />
          ))}
        </div>
      )}
    </section>
  );
}

function StationHistoryCard({
  station,
}: {
  station: StationHistoryLedgerStation;
}) {
  const source = station.source;
  const sourceStatus = source?.status ?? null;
  const sourceName = station.historySource ?? station.configuredSource;
  const rejected = source?.rejectedCount ?? 0;
  const imported = source?.importedCount ?? 0;

  return (
    <div
      className="rounded-xl border border-card-border bg-card px-5 py-4"
      data-testid={`station-history-row-${station.stationId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-normal text-foreground">
              {station.name}
            </span>
            <span className="font-mono text-sm text-muted-foreground">
              {station.slug}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[13px] font-normal ${historyStatusClass(sourceStatus)}`}
              data-testid={`station-history-status-${station.stationId}`}
            >
              {historyStatusLabel(sourceStatus)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            History source:{" "}
            <span className="font-mono text-foreground">{sourceName ?? "not configured"}</span>
            {source?.family ? ` · ${source.family.replaceAll("_", " ")}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <dt className="text-[13px] uppercase tracking-wide text-muted-foreground">
            Recovered depth
          </dt>
          <dd className="font-mono text-sm text-foreground">
            {formatRecoveredDepth(source?.oldestPublishedAt ?? null)}
          </dd>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-base sm:grid-cols-4">
        <DataRow label="Accepted" value={(source?.acceptedCount ?? 0).toLocaleString()} />
        <DataRow label="Imported" value={imported.toLocaleString()} />
        <DataRow
          label="Rejected"
          value={`${rejected.toLocaleString()} · ${source?.duplicateCount ?? 0} duplicate`}
        />
        <DataRow
          label="Backfill"
          value={
            station.backfillDone
              ? "complete"
              : source?.supportsBackfill
                ? "in progress"
                : "not supported"
          }
        />
      </dl>

      {source?.supportedDepthDays != null && (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          Source advertises up to{" "}
          <span className="font-mono text-foreground">{source.supportedDepthDays} days</span>
          {" "}of history · cursor {source.cursorMode.replaceAll("_", " ")}.
        </p>
      )}

      {sourceStatus === "unsupported" && (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          No deterministic history adapter is configured for this station.
        </p>
      )}
      {sourceStatus === "parser_drift" && (
        <p className="mt-3 flex items-start gap-2 border-t border-amber-500/20 pt-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Parser drift: the source responded, but its rows no longer include usable timestamps or stable identities.
          {source?.lastFailureReason ? ` ${source.lastFailureReason}` : ""}
        </p>
      )}
      {sourceStatus === "transient_failure" && (
        <p className="mt-3 flex items-start gap-2 border-t border-red-500/20 pt-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Transient provider or network failure; the cursor is retained for a later retry.
          {source?.lastFailureReason ? ` ${source.lastFailureReason}` : ""}
        </p>
      )}
      {source?.lastAttemptAt && sourceStatus !== "parser_drift" && sourceStatus !== "transient_failure" && (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          Last checked {formatTimestamp(source.lastAttemptAt)}
        </p>
      )}
    </div>
  );
}
