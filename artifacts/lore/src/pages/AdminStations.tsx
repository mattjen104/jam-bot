import { useState, useEffect, useCallback, useMemo } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
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
  favorite: boolean;
  hidden: boolean;
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
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-primary">
          <KeyRound className="h-3.5 w-3.5" />
          Admin access
        </div>
        <h1 className="mt-3 font-serif text-2xl font-semibold text-foreground">
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
    void loadAllocation();
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
    void load();
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
        };
        setStations((prev) =>
          prev.map((s) =>
            s.id === body.id
              ? { ...s, favorite: body.favorite, hidden: body.hidden }
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
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = stations.filter((s) => !s.hidden);
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.org ?? "").toLowerCase().includes(q),
    );
  }, [stations, search]);
  const hiddenStations = useMemo(
    () => stations.filter((s) => s.hidden),
    [stations],
  );

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-foreground">
              Station curation
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
          Favorites get a persistent connection for instant now-playing; other
          stations poll on an interval. Hidden stations leave the dial and stop
          polling entirely — history is kept, reintroduce any time.
        </p>

        {/* Favorites budget */}
        <div
          data-testid="favorites-count"
          className={`mt-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            favoriteCount > FAVORITE_SOFT_CAP
              ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
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
            className="mt-3 rounded-xl border border-card-border bg-card px-4 py-3 text-sm"
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
              <span className="font-mono text-[11px] uppercase tracking-wide text-primary">
                Socket allocation
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {allocation.pinnedCount} pinned · {allocation.leasedCount}{" "}
                leased · {allocation.freeSlots} free / {allocation.budget}
              </span>
            </button>
            {allocationOpen && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
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
                        <span className="truncate text-xs text-foreground">
                          {l.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
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
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
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
            className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-4 text-sm text-foreground placeholder-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : loadError ? (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
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
                <p className="mt-2 text-sm text-muted-foreground">
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
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                {hiddenOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Hidden stations
                <span className="rounded-full bg-secondary px-1.5 font-mono text-[10px] tabular-nums">
                  {hiddenStations.length}
                </span>
              </button>
              {hiddenOpen && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {hiddenStations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing hidden.
                    </p>
                  ) : (
                    hiddenStations.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card/60 px-4 py-2.5"
                      >
                        <StationIdentity station={s} dimmed />
                        <button
                          type="button"
                          onClick={() => void patchFlags(s.id, { hidden: false })}
                          disabled={busyIds.has(s.id)}
                          data-testid={`reintroduce-${s.slug}`}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 font-mono text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
                        >
                          {busyIds.has(s.id) ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                          Reintroduce
                        </button>
                      </div>
                    ))
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
          className={`truncate text-sm font-medium ${
            dimmed ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {station.name}
          {!station.active && (
            <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground/60">
              inactive
            </span>
          )}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground/70">
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
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors disabled:opacity-40 ${
            station.favorite
              ? "border-[#C6F53F]/40 bg-[#C6F53F]/10 text-[#C6F53F]"
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
