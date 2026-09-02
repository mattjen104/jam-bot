import { useState, useEffect, useCallback, useMemo } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AdminNav } from "@/components/AdminNav";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Search,
  Star,
  Zap,
} from "lucide-react";

/**
 * Curator-level station manager: favorites (persistent instant connections,
 * soft budget of 40) and soft-hide (leaves the dial, polling stops, history
 * kept, one-click reintroduce). Uses the plain-fetch admin flags endpoints.
 */

const FAVORITE_SOFT_CAP = 40;

interface LeaseInfo {
  stationId: number;
  slug: string;
  name: string;
  score: number;
  crossings: number;
  leasedAt: string;
  expiresAt: string;
  /** DJ name of the airing show when the score was evaluated, if any. */
  activeDj?: string;
  /** True when the crossing score was narrowed to the active show's window. */
  scopedToShow?: boolean;
}

interface Allocation {
  budget: number;
  pinnedCount: number;
  leasedCount: number;
  freeSlots: number;
  pinned: { id: number; slug: string; name: string }[];
  leases: LeaseInfo[];
  nextEvaluationAt: string | null;
}

interface FlagStation {
  id: number;
  slug: string;
  name: string;
  org: string | null;
  country: string | null;
  active: boolean;
  source: string | null;
  nowPlayingSource: string | null;
  logoUrl: string | null;
  streamUrl: string | null;
  favorite: boolean;
  hidden: boolean;
  automaticCullReason: string | null;
  automaticCullCanonicalStationId: number | null;
  automaticCullCanonicalStationSlug: string | null;
  automaticCullCanonicalStationName: string | null;
}

type StreamFilter = "all" | "playable" | "missing";

const AUTOMATIC_CULL_LABELS: Record<string, string> = {
  duplicate_stream: "Duplicate stream",
  off_mission_name: "Off-mission station name",
  missing_now_playing_source: "Missing now-playing source",
};

function automaticCullLabel(reason: string | null): string {
  return reason
    ? (AUTOMATIC_CULL_LABELS[reason] ?? reason.replaceAll("_", " "))
    : "Hidden by operator";
}

export default function AdminStations() {
  const { token, saveToken, clearToken } = useAdminToken();
  if (!token) return <TokenGate onSave={saveToken} />;
  return <StationsPanel token={token} onClearToken={clearToken} />;
}

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

function StationsPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [stations, setStations] = useState<FlagStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("all");
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [allocationOpen, setAllocationOpen] = useState(false);

  const loadAllocation = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stations/allocation", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) return;
      setAllocation((await res.json()) as Allocation);
    } catch {
      // best-effort panel; flags list is the primary surface
    }
  }, [token]);

  useEffect(() => {
    // Defer into a microtask callback so state updates happen asynchronously
    // (from the fetch result) rather than synchronously in the effect body.
    void Promise.resolve().then(() => loadAllocation());
  }, [loadAllocation]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stations/flags", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { stations: FlagStation[] };
      setStations(body.stations);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load stations");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // Defer into a microtask callback so state updates happen asynchronously
    // (from the fetch result) rather than synchronously in the effect body.
    void Promise.resolve().then(() => load());
  }, [load]);

  const patchFlags = useCallback(
    async (id: number, patch: { favorite?: boolean; hidden?: boolean }) => {
      setBusyIds((prev) => new Set(prev).add(id));
      setActionError(null);
      try {
        const res = await fetch(`/api/admin/stations/${id}/flags`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setActionError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as {
          id: number;
          favorite: boolean;
          hidden: boolean;
          automaticCullReason: string | null;
          automaticCullCanonicalStationId: number | null;
        };
        setStations((prev) =>
          prev.map((s) =>
            s.id === body.id
              ? {
                  ...s,
                  favorite: body.favorite,
                  hidden: body.hidden,
                  automaticCullReason: body.automaticCullReason,
                  automaticCullCanonicalStationId:
                    body.automaticCullCanonicalStationId,
                  ...(body.automaticCullCanonicalStationId === null
                    ? {
                        automaticCullCanonicalStationSlug: null,
                        automaticCullCanonicalStationName: null,
                      }
                    : {}),
                }
              : s,
          ),
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [token],
  );

  const favoriteCount = useMemo(
    () => stations.filter((s) => s.favorite && !s.hidden).length,
    [stations],
  );
  const matchesFilters = useCallback((station: FlagStation) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      station.name.toLowerCase().includes(q) ||
      station.slug.toLowerCase().includes(q) ||
      (station.org ?? "").toLowerCase().includes(q);
    const hasStream = Boolean(station.streamUrl?.trim());
    const matchesStream =
      streamFilter === "all" ||
      (streamFilter === "playable" && hasStream) ||
      (streamFilter === "missing" && !hasStream);
    return matchesSearch && matchesStream;
  }, [search, streamFilter]);
  const visible = useMemo(
    () => stations.filter((s) => !s.hidden && matchesFilters(s)),
    [stations, matchesFilters],
  );
  const hiddenStations = useMemo(
    () => stations.filter((s) => s.hidden && matchesFilters(s)),
    [stations, matchesFilters],
  );
  const automaticCulls = useMemo(
    () => hiddenStations.filter((s) => s.automaticCullReason),
    [hiddenStations],
  );
  const manuallyHiddenStations = useMemo(
    () => hiddenStations.filter((s) => !s.automaticCullReason),
    [hiddenStations],
  );

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[13px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-4xl font-normal text-foreground">
              Station curation
            </h1>
          </div>
          <button
            type="button"
            onClick={onClearToken}
            className="font-mono text-[13px] text-muted-foreground/70 hover:text-primary"
          >
            Clear token
          </button>
        </div>

        <AdminNav token={token} />

        <p className="mt-2 text-base text-muted-foreground">
          Favorites get a persistent connection for instant now-playing; other
          stations poll on an interval. Hidden stations leave the dial and stop
          polling entirely — history is kept, reintroduce any time.
        </p>

        {/* Favorites budget */}
        <div
          data-testid="favorites-count"
          className={`mt-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-base ${
            favoriteCount > FAVORITE_SOFT_CAP
              ? "border-zinc-400/40 bg-zinc-400/10 text-zinc-700 dark:text-zinc-300"
              : "border-card-border bg-card text-foreground"
          }`}
        >
          <Zap className="h-4 w-4 text-primary" />
          <span className="font-mono tabular-nums">{favoriteCount}</span>
          <span className="text-muted-foreground">
            / {FAVORITE_SOFT_CAP} favorites (instant connections)
          </span>
          {favoriteCount > FAVORITE_SOFT_CAP && (
            <span className="ml-auto inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Over the connection budget — each favorite holds a stream open.
            </span>
          )}
        </div>

        {/* Socket allocation (pinned + leased) */}
        {allocation && (
          <div
            data-testid="socket-allocation"
            className="mt-3 rounded-xl border border-card-border bg-card px-4 py-3 text-base"
          >
            <button
              type="button"
              onClick={() => setAllocationOpen((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
            >
              {allocationOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="font-mono text-[13px] uppercase tracking-wide text-primary">
                Socket allocation
              </span>
              <span className="ml-auto font-mono text-[13px] tabular-nums text-muted-foreground">
                {allocation.pinnedCount} pinned · {allocation.leasedCount}{" "}
                leased · {allocation.freeSlots} free / {allocation.budget}
              </span>
            </button>
            {allocationOpen && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Spare slots are leased to the non-favorite stations most
                  likely to play music from the library (recent library
                  crossings, recency-decayed). Leases rotate every ~20 minutes.
                  {allocation.nextEvaluationAt && (
                    <>
                      {" "}
                      Next re-evaluation:{" "}
                      <span className="font-mono">
                        {new Date(
                          allocation.nextEvaluationAt,
                        ).toLocaleTimeString()}
                      </span>
                      .
                    </>
                  )}
                </p>
                {allocation.leases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active leases — either no spare slots or no station has
                    crossed the library recently.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {allocation.leases.map((l) => (
                      <div
                        key={l.stationId}
                        className="flex items-center justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-1.5"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm text-foreground">
                            {l.name}
                          </span>
                          {l.scopedToShow && (
                            <span
                              className="shrink-0 rounded bg-primary/15 px-1 py-0.5 font-mono text-[10px] text-primary"
                              title={
                                l.activeDj
                                  ? `Score narrowed to ${l.activeDj}'s show window`
                                  : "Score narrowed to active show window"
                              }
                            >
                              {l.activeDj ? l.activeDj : "show"}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                          score {l.score.toFixed(2)} · {l.crossings} crossings
                          · until{" "}
                          {new Date(l.expiresAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {actionError && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-base text-destructive-foreground">
            {actionError}
          </p>
        )}

        {/* Search */}
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stations…"
            data-testid="station-search"
            className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-4 text-base text-foreground placeholder-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          aria-label="Filter by stream status"
        >
          <span className="mr-1 font-mono text-[12px] uppercase tracking-wide text-muted-foreground">
            Stream
          </span>
          {([
            ["all", "All"],
            ["playable", "Playable"],
            ["missing", "⚠ Missing"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStreamFilter(value)}
              aria-pressed={streamFilter === value}
              data-testid={`stream-filter-${value}`}
              className={`rounded-full border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                streamFilter === value
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-base text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : loadError ? (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-base text-destructive-foreground">
            {loadError}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-1.5">
              {visible.map((s) => (
                <StationRow
                  key={s.id}
                  station={s}
                  busy={busyIds.has(s.id)}
                  onToggleFavorite={() =>
                    void patchFlags(s.id, { favorite: !s.favorite })
                  }
                  onHide={() => void patchFlags(s.id, { hidden: true })}
                />
              ))}
              {visible.length === 0 && (
                <p className="mt-2 text-base text-muted-foreground">
                  No stations match.
                </p>
              )}
            </div>

            {/* Hidden stations */}
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setHiddenOpen((v) => !v)}
                data-testid="hidden-section-toggle"
                className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                {hiddenOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Hidden stations
                <span className="rounded-full bg-secondary px-1.5 font-mono text-[12px] tabular-nums">
                  {hiddenStations.length}
                </span>
              </button>
              {hiddenOpen && (
                <div className="mt-3 space-y-5">
                  <div>
                    <p className="font-mono text-[12px] uppercase tracking-wide text-primary">
                      Automatic culls
                      <span className="ml-2 rounded-full bg-primary/10 px-1.5 text-primary">
                        {automaticCulls.length}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      These rows were hidden by catalogue cleanup. Their
                      station and spin history is still intact.
                    </p>
                  </div>
                  {automaticCulls.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {automaticCulls.map((s) => (
                        <HiddenStationRow
                          key={s.id}
                          station={s}
                          busy={busyIds.has(s.id)}
                          onReintroduce={() =>
                            void patchFlags(s.id, { hidden: false })
                          }
                        />
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-[12px] uppercase tracking-wide text-muted-foreground">
                      Other hidden stations
                      <span className="ml-2 rounded-full bg-secondary px-1.5">
                        {manuallyHiddenStations.length}
                      </span>
                    </p>
                  </div>
                  {manuallyHiddenStations.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {manuallyHiddenStations.map((s) => (
                        <HiddenStationRow
                          key={s.id}
                          station={s}
                          busy={busyIds.has(s.id)}
                          onReintroduce={() =>
                            void patchFlags(s.id, { hidden: false })
                          }
                        />
                      ))}
                    </div>
                  )}
                  {hiddenStations.length === 0 && (
                    <p className="text-base text-muted-foreground">
                      Nothing hidden.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HiddenStationRow({
  station,
  busy,
  onReintroduce,
}: {
  station: FlagStation;
  busy: boolean;
  onReintroduce: () => void;
}) {
  return (
    <div
      data-testid={
        station.automaticCullReason
          ? `automatic-cull-${station.slug}`
          : `hidden-station-${station.slug}`
      }
      className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card/60 px-4 py-2.5"
    >
      <div className="min-w-0">
        <StationIdentity station={station} dimmed />
        <p className="mt-1 font-mono text-[12px] uppercase tracking-wide text-muted-foreground">
          {automaticCullLabel(station.automaticCullReason)}
        </p>
        {station.automaticCullReason === "duplicate_stream" &&
          station.automaticCullCanonicalStationName && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Canonical station kept:{" "}
              <span className="text-foreground">
                {station.automaticCullCanonicalStationName}
              </span>
              {station.automaticCullCanonicalStationSlug && (
                <span className="font-mono text-[12px]">
                  {" "}
                  ({station.automaticCullCanonicalStationSlug})
                </span>
              )}
            </p>
          )}
      </div>
      <button
        type="button"
        onClick={onReintroduce}
        disabled={busy}
        data-testid={`reintroduce-${station.slug}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 font-mono text-[13px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Eye className="h-3 w-3" />
        )}
        Reintroduce
      </button>
    </div>
  );
}

function StationIdentity({
  station,
  dimmed,
}: {
  station: FlagStation;
  dimmed?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {station.logoUrl && (
        <img
          src={station.logoUrl}
          alt=""
          className="h-6 w-6 shrink-0 rounded-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="min-w-0">
        <p
          className={`flex min-w-0 items-center gap-2 text-base font-normal ${
            dimmed ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          <span className="min-w-0 truncate">{station.name}</span>
          {!station.active && (
            <span className="shrink-0 font-mono text-[12px] uppercase text-muted-foreground/60">
              inactive
            </span>
          )}
          {station.streamUrl?.trim() ? (
            <span
              className="shrink-0 font-mono text-[12px] uppercase text-emerald-700 dark:text-emerald-400"
              title="A playable stream URL is configured"
              data-testid={`playable-stream-${station.slug}`}
            >
              Stream ready
            </span>
          ) : (
            <span
              className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] uppercase text-amber-600 dark:text-amber-400"
              title="No playable stream URL is configured"
              data-testid={`missing-stream-${station.slug}`}
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              No stream
            </span>
          )}
        </p>
        <p className="truncate font-mono text-[13px] text-muted-foreground/70">
          {[station.org, station.country, station.nowPlayingSource]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function StationRow({
  station,
  busy,
  onToggleFavorite,
  onHide,
}: {
  station: FlagStation;
  busy: boolean;
  onToggleFavorite: () => void;
  onHide: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-2.5">
      <StationIdentity station={station} />
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleFavorite}
          disabled={busy}
          data-testid={`favorite-${station.slug}`}
          aria-pressed={station.favorite}
          title={
            station.favorite
              ? "Unfavorite — drops the persistent connection"
              : "Favorite — holds a persistent connection for instant now-playing"
          }
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[13px] transition-colors disabled:opacity-40 ${
            station.favorite
              ? "border-[#dedede]/40 bg-[#dedede]/10 text-[#dedede]"
              : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
          }`}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Star
              className={`h-3 w-3 ${station.favorite ? "fill-current" : ""}`}
            />
          )}
          {station.favorite ? "Favorite" : "Favorite?"}
        </button>
        <button
          type="button"
          onClick={onHide}
          disabled={busy}
          data-testid={`hide-${station.slug}`}
          title="Hide — leaves the dial, polling stops; history kept"
          className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-40"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
