import { useState, useEffect, useCallback, useRef } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AdminNav } from "@/components/AdminNav";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  KeyRound,
  Loader2,
  Radio,
  RefreshCw,
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
  const [spiWeb, setSpiWeb] = useState<SpinitronWebResponse | null>(null);
  const [swError, setSwError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
  const [ryHealth, setRyHealth] = useState<ReleaseYearHealth | null>(null);
  const [ryError, setRyError] = useState<{ message: string; kind: "auth" | "server" } | null>(null);
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

      try {
        const [ffOk, swOk, ryOk] = await Promise.all([ffPromise, swPromise, ryPromise]);
        // Only show the top-level error when every endpoint fails at once.
        // Each section already renders its own per-section banner; the shared
        // top-level banner is a last-resort "nothing works at all" indicator.
        if (!ffOk && !swOk && !ryOk) {
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
  // "All healthy" only when both feed sections loaded without error and report no stale stations.
  const allHealthy =
    !loading && !loadError && !ffError && !swError && !ryError && totalStale === 0;

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

        {/* Radio Browser bulk re-probe + fingerprint scout — admin tools */}
        {!loading && <BulkReprobeSection token={token} />}
        {!loading && <ScoutReportSection token={token} />}

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
  } = health;
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunBatchResult | string | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
