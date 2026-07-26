import { useState, useEffect, useCallback, useRef } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  KeyRound,
  Loader2,
  Radio,
  RefreshCw,
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
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-primary">
          <KeyRound className="h-3.5 w-3.5" />
          Admin access
        </div>
        <h1 className="mt-3 font-serif text-2xl font-semibold text-foreground">
          Enter admin token
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
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
  const [spiWeb, setSpiWeb] = useState<SpinitronWebResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true);
      setLoadError(null);
      try {
        const headers = { "x-admin-token": token };
        const [ffRes, swRes] = await Promise.all([
          fetch("/api/admin/feed-freshness-health", { headers }),
          fetch("/api/admin/spinitron-web-health", { headers }),
        ]);

        if (!ffRes.ok || !swRes.ok) {
          const badRes = !ffRes.ok ? ffRes : swRes;
          const body = (await badRes.json().catch(() => ({}))) as { error?: string };
          setLoadError(body.error ?? `HTTP ${badRes.status}`);
          return;
        }

        const [ff, sw] = await Promise.all([
          ffRes.json() as Promise<FeedFreshnessResponse>,
          swRes.json() as Promise<SpinitronWebResponse>,
        ]);

        setFeedFreshness(ff);
        setSpiWeb(sw);
        setLastRefreshed(new Date());
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load health data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void fetchAll();
    timerRef.current = setInterval(() => void fetchAll({ silent: true }), REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll]);

  const totalStale = (feedFreshness?.staleCount ?? 0) + (spiWeb?.staleCount ?? 0);
  const allHealthy = !loading && !loadError && totalStale === 0;

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-primary">
              <Radio className="h-3.5 w-3.5" />
              Admin · Feed health
            </div>
            <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground">
              Station feed health
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Alerts when a feed goes silent. Refreshes every 30 seconds.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
            <button
              onClick={() => void fetchAll()}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {lastRefreshed && (
              <span className="text-[11px] text-muted-foreground">
                Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={onClearToken}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Monitoring-since banner */}
        {!loading && !loadError && feedFreshness && (
          <MonitoringBanner monitoringSince={feedFreshness.monitoringSince} />
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {!loading && loadError && (
          <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            <span className="font-medium">Error loading health data:</span> {loadError}
          </div>
        )}

        {/* All healthy */}
        {allHealthy && (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-base font-medium text-foreground">All feeds healthy</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              No silent stations detected. BBC and SomaFM feeds are receiving spins on schedule.
            </p>
          </div>
        )}

        {/* Feed freshness section */}
        {!loading && !loadError && feedFreshness && feedFreshness.staleCount > 0 && (
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

        {/* Spinitron web section */}
        {!loading && !loadError && spiWeb && spiWeb.staleCount > 0 && (
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

        {/* Healthy sub-sections when one is OK but not both */}
        {!loading && !loadError && totalStale > 0 && (
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
  const uptimeMs = Date.now() - since.getTime();
  const isNew = uptimeMs < SETTLED_THRESHOLD_MS;

  return (
    <div
      className={`mt-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        isNew
          ? "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300"
          : "border-border bg-card/60 text-muted-foreground"
      }`}
    >
      <Info className={`mt-0.5 h-4 w-4 shrink-0 ${isNew ? "text-blue-500" : "text-muted-foreground"}`} />
      <div>
        <span className="font-medium text-foreground">
          Monitoring since {since.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="ml-1">({formatDuration(uptimeMs)} ago)</span>
        {isNew && (
          <p className="mt-0.5 text-xs">
            Health state resets on every server restart — data may not yet reflect pre-restart
            conditions. Results will stabilise after feeds have had time to report.
          </p>
        )}
        {!isNew && (
          <span className="ml-1 text-xs">· Health state resets on server restart.</span>
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
        <span className="text-amber-500">{icon}</span>
        <h2 className="font-semibold text-foreground">{title}</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          {badge}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function HealthyRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
      <div>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="ml-2 text-sm text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

function FeedFreshnessCard({ station }: { station: FeedFreshnessStation }) {
  const silentFor = formatDuration(station.staleSinceMs);
  const threshold = formatDuration(station.thresholdMs);
  const pollInterval = formatDuration(station.pollIntervalMs);

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <span className="font-mono text-sm font-semibold text-foreground">
              {station.slug}
            </span>
            <span className="ml-2 rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {station.source}
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          silent {silentFor}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
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
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="font-mono text-sm font-semibold text-foreground">
            {station.slug}
          </span>
          <span className="rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            spinitron_web
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          failing {silentFor}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
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
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}
