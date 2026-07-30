import { useMemo, useState } from "react";
import { Link } from "wouter";
import { SearchOverlay } from "../components/SearchOverlay";
import {
  useListPickers,
  useGetPickersDial,
  useListSelectors,
  getPickerRun,
  useLookupPickedMbids,
  getLookupPickedMbidsQueryKey,
} from "@workspace/api-client-react";
import type { PickerDialItem, SelectorSummary } from "@workspace/api-client-react";
import { useMyLibrary } from "../lib/meHooks";
import { usePlayer } from "../player/PlayerProvider";
import { useFollows, isFollowed, toggleFollow } from "../lib/local";
import { Search } from "lucide-react";

const ON_AIR_MS = 2 * 60 * 60 * 1000;
const RECENTLY_ACTIVE_MS = 14 * 24 * 60 * 60 * 1000;

function isRecentlyActive(pickedAt: string | null | undefined): boolean {
  if (!pickedAt) return false;
  return Date.now() - new Date(pickedAt).getTime() < RECENTLY_ACTIVE_MS;
}

function timeAgoShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 13) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ---------------------------------------------------------------------------
// Library overlap (used for sorting)
// ---------------------------------------------------------------------------
function useLibraryOverlap(): {
  overlapByHandle: Map<string, number>;
  totalMbids: number;
  totalCrossings: number;
} | null {
  const { data: libraryData } = useMyLibrary(undefined, 60);

  const libraryMbids = useMemo(
    () =>
      (libraryData?.items ?? [])
        .map((item) => item.mbid)
        .filter((mbid): mbid is string => mbid != null && mbid.length > 0),
    [libraryData],
  );

  const batch1 = useMemo(() => libraryMbids.slice(0, 30), [libraryMbids]);
  const batch2 = useMemo(() => libraryMbids.slice(30, 60), [libraryMbids]);
  const mbids1Str = batch1.join(",") || "_";
  const mbids2Str = batch2.join(",") || "_";

  const { data: hits1 } = useLookupPickedMbids(
    { mbids: mbids1Str },
    { query: { queryKey: getLookupPickedMbidsQueryKey({ mbids: mbids1Str }), enabled: batch1.length > 0, staleTime: 5 * 60 * 1000 } },
  );
  const { data: hits2 } = useLookupPickedMbids(
    { mbids: mbids2Str },
    { query: { queryKey: getLookupPickedMbidsQueryKey({ mbids: mbids2Str }), enabled: batch2.length > 0, staleTime: 5 * 60 * 1000 } },
  );

  return useMemo(() => {
    if (libraryMbids.length === 0) return null;
    const allHits = [...(hits1?.items ?? []), ...(hits2?.items ?? [])];
    const countByHandle = new Map<string, number>();
    for (const hit of allHits) {
      const h = hit.picker.handle;
      countByHandle.set(h, (countByHandle.get(h) ?? 0) + 1);
    }
    const total = libraryMbids.length;
    const overlapByHandle = new Map<string, number>();
    for (const [handle, count] of countByHandle) {
      overlapByHandle.set(handle, Math.round((count / total) * 1000) / 10);
    }
    return { overlapByHandle, totalMbids: total, totalCrossings: allHits.length };
  }, [libraryMbids, hits1, hits2]);
}

// ---------------------------------------------------------------------------
// Unified selector shape (covers curated pickers + KEXP radio DJs)
// ---------------------------------------------------------------------------
interface UnifiedSelector {
  handle: string;
  name: string;
  kind: "curated" | "dj";
  /** Station display name */
  station?: string | null;
  stationSlug?: string | null;
  /** Show / programme name */
  showName?: string | null;
  showId?: string | null;
  setCount: number;
  spinCount: number;
  lastActiveAt?: string | null;
  overlapPct: number;
  isLive: boolean;
}

// ---------------------------------------------------------------------------
// Selector card
// ---------------------------------------------------------------------------
function SelectorCard({
  sel,
  onPlay,
  playLoading,
}: {
  sel: UnifiedSelector;
  onPlay?: (e: React.MouseEvent) => void;
  playLoading?: boolean;
}) {
  const follows = useFollows();
  const followKind = sel.kind === "dj" ? "selector" : "picker";
  const following = isFollowed(follows, followKind, sel.handle);

  const cardClass = [
    "sel-card",
    sel.overlapPct >= 20 ? "sel-card--warm" : "",
    sel.isLive ? "sel-card--live" : "",
    sel.overlapPct === 0 ? "sel-card--cold" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const metaParts: string[] = [];
  if (sel.setCount) metaParts.push(`${sel.setCount} sets`);
  if (sel.spinCount) metaParts.push(`${sel.spinCount.toLocaleString()} spins`);
  if (sel.lastActiveAt) metaParts.push(`last ${timeAgoShort(sel.lastActiveAt)}`);

  return (
    <Link href={`/archive/selectors/${sel.handle}`} className={cardClass} data-testid="selector-card">
      <div className="sel-card__body">
        <div className="sel-card__nm">{sel.name}</div>

        {/* Show + station context */}
        {(sel.showName || sel.station) && (
          <div className="sel-card__ctx">
            {sel.showName && sel.showId ? (
              <a href={`/archive/shows/${sel.showId}`} onClick={(e) => e.stopPropagation()}>
                {sel.showName}
              </a>
            ) : sel.showName ? (
              <span>{sel.showName}</span>
            ) : null}
            {sel.showName && sel.station ? " on " : null}
            {sel.station && sel.stationSlug ? (
              <b>
                <a href={`/archive/stations/${sel.stationSlug}`} onClick={(e) => e.stopPropagation()}>
                  {sel.station}
                </a>
              </b>
            ) : sel.station ? (
              <b>{sel.station}</b>
            ) : null}
          </div>
        )}

        {metaParts.length > 0 && (
          <div className="sel-card__meta">{metaParts.join(" · ")}</div>
        )}
      </div>

      {/* Right rail */}
      <div className="sel-card__rail" onClick={(e) => e.preventDefault()}>
        {sel.isLive && (
          sel.stationSlug ? (
            <a
              href={`/archive/stations/${sel.stationSlug}`}
              className="sel-card__onair"
              onClick={(e) => e.stopPropagation()}
            >
              ● On air
            </a>
          ) : (
            <span className="sel-card__onair">● On air</span>
          )
        )}

        {/* Overlap % */}
        <div className="sel-card__ov">
          <span className={`sel-card__ov-num${sel.overlapPct === 0 ? " sel-card__ov-num--zero" : ""}`}>
            {sel.overlapPct}%
          </span>
          <span className="sel-card__ov-lbl">{sel.overlapPct ? "yours" : "no overlap"}</span>
        </div>

        {/* Play button (curated selectors with a run) */}
        {onPlay && (
          <button
            type="button"
            style={{
              width: 26,
              height: 26,
              border: "1px solid hsl(var(--border))",
              borderRadius: 3,
              background: "none",
              color: "hsl(var(--muted-foreground))",
              fontSize: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onClick={(e) => { e.stopPropagation(); onPlay(e); }}
            disabled={playLoading}
            aria-label={`Play ${sel.name}`}
          >
            {playLoading ? "…" : "▶"}
          </button>
        )}

        {/* Follow */}
        <button
          type="button"
          className={`sel-card__follow${following ? " sel-card__follow--on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleFollow(followKind, sel.handle, sel.name);
          }}
          data-testid={`follow-${followKind}-${sel.handle}`}
        >
          {following ? "✓" : "+"}
        </button>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Curated selector wrapper (adds play-run data)
// ---------------------------------------------------------------------------
function CuratedSelCard({
  picker,
  item,
  overlapPct,
}: {
  picker: { handle: string; name: string; pickerType: string; description?: string | null };
  item?: PickerDialItem;
  overlapPct: number;
}) {
  const { ride } = usePlayer();
  const [playLoading, setPlayLoading] = useState(false);
  const run = item?.run;

  const previewArtists = useMemo(() => {
    if (!item?.previewTracks) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of item.previewTracks) {
      const a = (t as { artist?: string }).artist;
      if (a && !seen.has(a)) { seen.add(a); out.push(a); if (out.length >= 4) break; }
    }
    return out;
  }, [item]);
  void previewArtists;

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!run) return;
    setPlayLoading(true);
    try {
      const data = await getPickerRun(run.runId);
      const seeds = data.tracks
        .filter((t) => t.recording != null)
        .map((t) => ({
          mbid: t.recording!.mbid,
          title: t.recording!.title,
          artist: t.recording!.artist,
          artworkUrl: t.recording!.artworkUrl ?? null,
          links: t.recording!.links ?? [],
        }));
      if (seeds.length > 0) {
        ride.startReplay(seeds, `${picker.name}${run.title ? ` — ${run.title}` : ""}`, {
          timeOrientation: "curated",
        });
      }
    } finally { setPlayLoading(false); }
  };

  const sel: UnifiedSelector = {
    handle: picker.handle,
    name: picker.name,
    kind: "curated",
    setCount: 0,
    spinCount: 0,
    lastActiveAt: run?.pickedAt,
    overlapPct,
    isLive: false,
  };

  return (
    <SelectorCard
      sel={sel}
      onPlay={run ? handlePlay : undefined}
      playLoading={playLoading}
    />
  );
}

// ---------------------------------------------------------------------------
// Radio DJ card
// ---------------------------------------------------------------------------
function RadioDjCard({
  selector,
  overlapPct,
}: {
  selector: SelectorSummary;
  overlapPct: number;
}) {
  const isLive =
    selector.lastPlayedAt != null &&
    Date.now() - new Date(selector.lastPlayedAt).getTime() < ON_AIR_MS;

  // SelectorSummary currently has: id, name, handle, homeUrl, recentSpinCount, lastPlayedAt
  // station/show fields are added in Phase 3 (selector endpoint generalization)
  const sel: UnifiedSelector = {
    handle: selector.handle,
    name: selector.name,
    kind: "dj",
    station: null,
    stationSlug: null,
    showName: null,
    setCount: 0,
    spinCount: selector.recentSpinCount ?? 0,
    lastActiveAt: selector.lastPlayedAt,
    overlapPct,
    isLive,
  };

  return <SelectorCard sel={sel} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Selectors() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [stationFilter, setStationFilter] = useState<string>("all");
  const { radio } = usePlayer();
  const { data: listData, isLoading: listLoading, isError: listError } = useListPickers();
  const { data: dialData } = useGetPickersDial();
  const { data: kexpData, isLoading: kexpLoading } = useListSelectors();
  const overlap = useLibraryOverlap();
  void radio;

  const dialByHandle = useMemo((): Map<string, PickerDialItem> => {
    const m = new Map<string, PickerDialItem>();
    for (const item of dialData?.items ?? []) m.set(item.picker.handle, item);
    return m;
  }, [dialData]);

  // Curated pickers (sorted by overlap)
  const sortedPickers = useMemo(() => {
    const all = (listData?.pickers ?? []).filter((p) => p.active && p.pickerType !== "dj");
    return [...all].sort((a, b) => {
      const aOv = overlap?.overlapByHandle.get(a.handle) ?? 0;
      const bOv = overlap?.overlapByHandle.get(b.handle) ?? 0;
      if (bOv !== aOv) return bOv - aOv;
      const aRecent = isRecentlyActive(dialByHandle.get(a.handle)?.run?.pickedAt) ? 1 : 0;
      const bRecent = isRecentlyActive(dialByHandle.get(b.handle)?.run?.pickedAt) ? 1 : 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      return a.name.localeCompare(b.name);
    });
  }, [listData, dialByHandle, overlap]);

  const kexpSelectors = kexpData?.selectors ?? [];

  // Station filter options — empty until Phase 3 adds station fields to SelectorSummary
  const stations: Array<{ name: string; slug: string }> = [];

  // Filtered + sorted list
  const filteredKexp = useMemo(() => {
    // stationFilter is always "all" until station info is available in SelectorSummary
    return kexpSelectors;
  }, [kexpSelectors, stationFilter]);

  const sortedKexp = useMemo(() => {
    return [...filteredKexp].sort((a: SelectorSummary, b: SelectorSummary) => {
      const aOv = overlap?.overlapByHandle.get(a.handle) ?? 0;
      const bOv = overlap?.overlapByHandle.get(b.handle) ?? 0;
      if (bOv !== aOv) return bOv - aOv;
      const aLive = a.lastPlayedAt != null && Date.now() - new Date(a.lastPlayedAt).getTime() < ON_AIR_MS ? 1 : 0;
      const bLive = b.lastPlayedAt != null && Date.now() - new Date(b.lastPlayedAt).getTime() < ON_AIR_MS ? 1 : 0;
      return bLive - aLive;
    });
  }, [filteredKexp, overlap]);

  // Hero stats
  const liveCount =
    kexpSelectors.filter(
      (s: SelectorSummary) =>
        s.lastPlayedAt != null &&
        Date.now() - new Date(s.lastPlayedAt).getTime() < ON_AIR_MS,
    ).length;

  const follows = useFollows();
  const followedCount = useMemo(() => {
    let n = 0;
    for (const p of sortedPickers) if (isFollowed(follows, "picker", p.handle)) n++;
    for (const s of kexpSelectors) if (isFollowed(follows, "selector", s.handle)) n++;
    return n;
  }, [follows, sortedPickers, kexpSelectors]);

  const overlapCount = useMemo(() => {
    let n = 0;
    for (const p of sortedPickers) if ((overlap?.overlapByHandle.get(p.handle) ?? 0) > 0) n++;
    for (const s of kexpSelectors) if ((overlap?.overlapByHandle.get(s.handle) ?? 0) > 0) n++;
    return n;
  }, [overlap, sortedPickers, kexpSelectors]);

  const totalCount = sortedPickers.length + (stationFilter === "all" ? kexpSelectors.length : sortedKexp.length);
  const isLoading = listLoading || kexpLoading;

  return (
    <div className="dial-root">
      {searchOpen && (
        <SearchOverlay
          dialStations={[]}
          onClose={() => setSearchOpen(false)}
          onStationDrill={() => setSearchOpen(false)}
          onShowDrill={() => setSearchOpen(false)}
        />
      )}

      {/* Topbar */}
      <div className="dial-topbar">
        <span className="dial-topbar__wordmark">Lore</span>
        <span className="dial-topbar__title dial-topbar__title--active">Selectors</span>
        {totalCount > 0 && (
          <span className="dial-topbar__sort-chip">
            ◆ {totalCount}
            {liveCount > 0 && ` · ${liveCount} live`}
          </span>
        )}
        <button
          type="button"
          className="dial-topbar__search"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
        >
          <Search size={14} />
        </button>
      </div>

      <div className="dial-body">
        {/* ── Hero ── */}
        <div className="sel-hero">
          <div className="sel-hero__kicker">◆ Your selectors</div>
          <div className="sel-hero__headline">
            <b>{overlapCount > 0 ? `${overlapCount} people` : "People"}</b>
            {" "}have played your records
          </div>
          <div className="sel-hero__stats">
            {liveCount > 0 && (
              <span className="sel-hero__stat sel-hero__stat--cool">
                <b>{liveCount}</b> on air
              </span>
            )}
            {followedCount > 0 && (
              <span className="sel-hero__stat sel-hero__stat--warm">
                <b>{followedCount}</b> followed
              </span>
            )}
            {stations.length > 0 && (
              <span className="sel-hero__stat">
                <b>{stations.length}</b> station{stations.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {/* ── Station filter chips ── */}
        {stations.length > 0 && (
          <div className="sel-filters">
            <button
              type="button"
              className={`sel-fchip${stationFilter === "all" ? " sel-fchip--on" : ""}`}
              onClick={() => setStationFilter("all")}
            >
              All stations
              <span className="sel-fchip__ct">
                {sortedPickers.length + kexpSelectors.length}
              </span>
            </button>
            {stations.map((st) => {
              // stationSlug not yet in SelectorSummary; count is placeholder until Phase 3
              const count = kexpSelectors.length;
              return (
                <button
                  key={st.slug}
                  type="button"
                  className={`sel-fchip${stationFilter === st.slug ? " sel-fchip--on" : ""}`}
                  onClick={() => setStationFilter(st.slug)}
                >
                  {st.name}
                  <span className="sel-fchip__ct">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Loading / error states ── */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  height: 74,
                  borderBottom: "1px solid hsl(var(--border) / 0.4)",
                  background: "hsl(var(--secondary))",
                  opacity: 0.5 + i * 0.05,
                  animation: "lore-eq 1.8s ease-in-out infinite",
                  animationDelay: `${i * 0.12}s`,
                }}
              />
            ))}
          </div>
        )}

        {listError && !isLoading && (
          <div className="dial-loading">Couldn't load selectors — please refresh.</div>
        )}

        {!isLoading && !listError && totalCount === 0 && (
          <div className="dial-loading">No selectors enrolled yet.</div>
        )}

        {/* ── Unified list header ── */}
        {!isLoading && !listError && totalCount > 0 && (
          <div className="dial-tier-hd">
            <span className="dial-tier-hd__label">
              Ranked by overlap
              <span style={{ fontFamily: "var(--app-font-mono)", fontWeight: 400 }}> · {totalCount}</span>
            </span>
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                color: "hsl(var(--faint))",
                margin: "0 8px",
                whiteSpace: "nowrap",
              }}
            >
              station is a filter, not a section
            </span>
            <div className="dial-tier-hd__rule" />
          </div>
        )}

        {/* ── Curated selectors (shown when filter is "all") ── */}
        {!isLoading && stationFilter === "all" && sortedPickers.map((p) => (
          <CuratedSelCard
            key={p.handle}
            picker={p}
            item={dialByHandle.get(p.handle)}
            overlapPct={overlap?.overlapByHandle.get(p.handle) ?? 0}
          />
        ))}

        {/* ── Radio DJs ── */}
        {!isLoading && sortedKexp.map((s: SelectorSummary) => (
          <RadioDjCard
            key={s.handle}
            selector={s}
            overlapPct={overlap?.overlapByHandle.get(s.handle) ?? 0}
          />
        ))}

        {/* Footer note */}
        {!isLoading && totalCount > 0 && (
          <div
            style={{
              padding: "14px 15px",
              fontFamily: "var(--app-font-reading)",
              fontStyle: "italic",
              fontSize: 12.5,
              color: "hsl(var(--faint))",
              lineHeight: 1.6,
            }}
          >
            <b style={{ fontStyle: "normal", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>
              One list, one ranking.
            </b>{" "}
            Zero-overlap selectors rank last but stay visible — an honest nothing beats a hidden nothing.
          </div>
        )}

        <div style={{ height: 80 }} />
      </div>
    </div>
  );
}
