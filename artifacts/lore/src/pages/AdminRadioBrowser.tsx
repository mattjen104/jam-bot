import { useState, useEffect, useCallback } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AlertTriangle, KeyRound, Loader2, Plus, Radio, RefreshCw, Trash2, Wifi, WifiOff, AlertCircle } from "lucide-react";

export default function AdminRadioBrowser() {
  const { token, saveToken, clearToken } = useAdminToken();

  if (!token) {
    return <TokenGate onSave={saveToken} />;
  }

  return <RadioBrowserPanel token={token} onClearToken={clearToken} />;
}

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

interface RbStation {
  id: number;
  radioBrowserUuid: string;
  name: string;
  streamUrl: string;
  faviconUrl: string | null;
  icyStatus: string;
  lastStreamTitle: string | null;
  lastSuccessAt: string | null;
  consecutiveErrors: number;
  enrolledAt: string;
}

function icyStatusIcon(status: string) {
  if (status === "active") return <Wifi className="h-3.5 w-3.5 text-green-500" />;
  if (status === "icy_unsupported") return <WifiOff className="h-3.5 w-3.5 text-amber-500" />;
  return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
}

function icyStatusLabel(status: string): string {
  if (status === "active") return "active";
  if (status === "icy_unsupported") return "no ICY";
  return "error";
}

function RadioBrowserPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [stations, setStations] = useState<RbStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const patchStation = useCallback(
    (id: number, patch: Pick<RbStation, "icyStatus" | "consecutiveErrors">) => {
      setStations((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const loadStations = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/radio-browser/stations", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setLoadError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { stations: RbStation[] };
      setStations(body.stations);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load stations");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadStations(); }, [loadStations]);

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-foreground">
              Radio Browser Stations
            </h1>
          </div>
          <button
            type="button"
            onClick={onClearToken}
            className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
          >
            Clear token
          </button>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Enrol internet radio stations from{" "}
          <a
            href="https://www.radio-browser.info"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            radio-browser.info
          </a>{" "}
          by UUID. The poller connects to the stream, reads ICY metadata, and ingests
          now-playing track data every 30 seconds.
        </p>

        <div className="mt-8 flex flex-col gap-6">
          <CoverageSection token={token} />
          <EnrollForm token={token} onEnrolled={() => void loadStations()} />

          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Enrolled stations
            </h2>
            {loading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : loadError ? (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {loadError}
              </div>
            ) : stations.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No stations enrolled yet.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {/* Warning list for unsupported / erroring stations */}
                {stations.some((s) => s.icyStatus !== "active") && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Some stations are not delivering ICY metadata — check their status
                      below.
                    </span>
                  </div>
                )}
                {stations.map((s) => (
                  <StationRow
                    key={s.id}
                    station={s}
                    token={token}
                    onRemoved={() => void loadStations()}
                    onReenrolled={(patch) => patchStation(s.id, patch)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CoverageStation {
  id: number;
  slug: string;
  name: string;
  source: string | null;
  favorite: boolean;
  coverage: "instant" | "multiplexed" | "complete-history" | "blind-spot";
}

const COVERAGE_LABELS: Record<CoverageStation["coverage"], string> = {
  instant: "Instant",
  multiplexed: "Multiplexed",
  "complete-history": "Complete history",
  "blind-spot": "Blind spot",
};

function CoverageSection({ token }: { token: string }) {
  const [data, setData] = useState<{
    stations: CoverageStation[];
    counts: Record<string, number>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/stations/coverage", {
          headers: { "x-admin-token": token },
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          if (!cancelled) setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as {
          stations: CoverageStation[];
          counts: Record<string, number>;
        };
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load coverage");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
        Coverage: {error}
      </div>
    );
  }
  if (!data) return null;

  const blindSpots = data.stations.filter((s) => s.coverage === "blind-spot");

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Wifi className="h-4 w-4 text-primary" />
        <h2 className="font-serif text-lg font-semibold text-foreground">
          Coverage
        </h2>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(COVERAGE_LABELS) as CoverageStation["coverage"][]).map(
          (k) => (
            <span
              key={k}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                k === "blind-spot"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-secondary/40 text-muted-foreground"
              }`}
            >
              {COVERAGE_LABELS[k]}: {data.counts[k] ?? 0}
            </span>
          ),
        )}
      </div>
      {blindSpots.length > 0 && (
        <div className="mt-4">
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {blindSpots.length} station{blindSpots.length !== 1 ? "s" : ""}{" "}
              have no history endpoint and no persistent connection — anything
              played between polls is lost. Pin them as favorites to give them
              an instant watcher.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 font-mono text-[11px] text-primary hover:underline"
          >
            {expanded ? "Hide blind spots" : "Show blind spots"}
          </button>
          {expanded && (
            <div className="mt-2 flex flex-col gap-1">
              {blindSpots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-card-border bg-secondary/20 px-3 py-1.5"
                >
                  <span className="truncate text-sm text-foreground">
                    {s.name}
                  </span>
                  <span className="ml-3 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {s.source ?? "?"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnrollForm({
  token,
  onEnrolled,
}: {
  token: string;
  onEnrolled: () => void;
}) {
  const [uuid, setUuid] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = uuid.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/radio-browser/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ uuid: trimmed }),
      });
      const body = (await res.json()) as { name?: string; error?: string };
      if (!res.ok) {
        setStatus({ ok: false, message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({
        ok: true,
        message: `"${body.name ?? trimmed}" enrolled — polling starts immediately.`,
      });
      setUuid("");
      onEnrolled();
    } catch (err) {
      setStatus({
        ok: false,
        message: err instanceof Error ? err.message : "Request failed — try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h2 className="font-serif text-lg font-semibold text-foreground">
          Add Radio Browser station
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste the station UUID from{" "}
        <a
          href="https://www.radio-browser.info"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          radio-browser.info
        </a>
        . Find it in the station's URL (the long UUID string) or via the API. The
        station must support ICY metadata — stations that don't are marked{" "}
        <span className="font-mono text-xs">no ICY</span> and paused.
      </p>
      <form
        className="mt-5 flex flex-col gap-3"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Station UUID{" "}
            <span className="text-destructive-foreground">*</span>
          </label>
          <input
            type="text"
            value={uuid}
            onChange={(e) => setUuid(e.target.value)}
            placeholder="e.g. 960a8447-6600-11e8-ae2d-52543be04c81"
            disabled={busy}
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
        {status && (
          status.ok ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
              {status.message}
            </div>
          ) : (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
              {status.message}
            </p>
          )
        )}
        <button
          type="submit"
          disabled={busy || !uuid.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {busy ? "Enrolling…" : "Enrol station"}
        </button>
      </form>
    </div>
  );
}

function StationRow({
  station,
  token,
  onRemoved,
  onReenrolled,
}: {
  station: RbStation;
  token: string;
  onRemoved: () => void;
  onReenrolled: (patch: Pick<RbStation, "icyStatus" | "consecutiveErrors">) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [reenrolling, setReenrolling] = useState(false);
  const [reenrollError, setReenrollError] = useState<string | null>(null);

  const needsReenroll =
    station.icyStatus === "error" || station.icyStatus === "icy_unsupported";

  async function handleRemove() {
    if (!confirm(`Remove "${station.name}" from ICY polling?`)) return;
    setRemoving(true);
    try {
      await fetch(`/api/admin/radio-browser/stations/${station.id}`, {
        method: "DELETE",
        headers: { "x-admin-token": token },
      });
      onRemoved();
    } catch {
      setRemoving(false);
    }
  }

  async function handleReenroll() {
    setReenrolling(true);
    setReenrollError(null);
    try {
      const res = await fetch(
        `/api/admin/radio-browser/stations/${station.id}/reenroll`,
        { method: "POST", headers: { "x-admin-token": token } },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setReenrollError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        icyStatus: string;
        consecutiveErrors: number;
      };
      onReenrolled({
        icyStatus: body.icyStatus,
        consecutiveErrors: body.consecutiveErrors,
      });
    } catch (err) {
      setReenrollError(
        err instanceof Error ? err.message : "Re-enroll failed — try again.",
      );
    } finally {
      setReenrolling(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {station.faviconUrl && (
            <img
              src={station.faviconUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {station.name}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {station.radioBrowserUuid}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1">
            {icyStatusIcon(station.icyStatus)}
            <span className="font-mono text-[11px] text-muted-foreground">
              {icyStatusLabel(station.icyStatus)}
            </span>
            {station.consecutiveErrors > 0 && station.icyStatus !== "active" && (
              <span className="font-mono text-[11px] text-muted-foreground/60">
                ({station.consecutiveErrors})
              </span>
            )}
          </div>
          {needsReenroll && (
            <button
              type="button"
              onClick={() => void handleReenroll()}
              disabled={reenrolling || removing}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 font-mono text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
              title="Reset status and resume polling"
            >
              {reenrolling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {reenrolling ? "Retrying…" : "Re-enroll"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={removing || reenrolling}
            className="rounded-lg p-1 text-muted-foreground/60 transition-colors hover:text-destructive disabled:opacity-40"
            title="Remove station"
          >
            {removing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
      {station.lastStreamTitle && (
        <p className="mt-2 truncate text-sm text-muted-foreground">
          <span className="font-mono text-[11px] text-muted-foreground/60">
            now:{" "}
          </span>
          {station.lastStreamTitle}
        </p>
      )}
      {station.icyStatus === "icy_unsupported" && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          This stream does not advertise ICY metadata. Polling is paused — try
          re-enrolling first, or remove and re-add with a different stream URL.
        </p>
      )}
      {station.icyStatus === "error" && (
        <p className="mt-2 text-xs text-destructive-foreground">
          {station.consecutiveErrors > 0
            ? `${station.consecutiveErrors} consecutive error${station.consecutiveErrors !== 1 ? "s" : ""} — `
            : ""}
          Polling suspended. Click Re-enroll to reset and resume immediately.
        </p>
      )}
      {station.consecutiveErrors > 0 && station.icyStatus === "active" && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {station.consecutiveErrors} consecutive error
          {station.consecutiveErrors !== 1 ? "s" : ""} — will be suspended after 3.
        </p>
      )}
      {reenrollError && (
        <p className="mt-2 text-xs text-destructive-foreground">
          Re-enroll failed: {reenrollError}
        </p>
      )}
    </div>
  );
}
