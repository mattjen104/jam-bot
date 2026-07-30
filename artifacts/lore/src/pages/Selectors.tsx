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
// Library overlap
// ---------------------------------------------------------------------------
function useLibraryOverlap(): {
  overlapByHandle: Map<string, number>;
  totalMbids: number;
  totalCrossings: number;
} | null {
  const { data: libraryData } = useMyLibrary(undefined, 60);

  const libraryMbids = useMemo(() => {
    return (libraryData?.items ?? [])
      .map((item) => item.mbid)
      .filter((mbid): mbid is string => mbid != null && mbid.length > 0);
  }, [libraryData]);

  const batch1 = useMemo(() => libraryMbids.slice(0, 30), [libraryMbids]);
  const batch2 = useMemo(() => libraryMbids.slice(30, 60), [libraryMbids]);

  const mbids1Str = batch1.join(",") || "_";
  const { data: hits1 } = useLookupPickedMbids(
    { mbids: mbids1Str },
    {
      query: {
        queryKey: getLookupPickedMbidsQueryKey({ mbids: mbids1Str }),
        enabled: batch1.length > 0,
        staleTime: 5 * 60 * 1000,
      },
    },
  );
  const mbids2Str = batch2.join(",") || "_";
  const { data: hits2 } = useLookupPickedMbids(
    { mbids: mbids2Str },
    {
      query: {
        queryKey: getLookupPickedMbidsQueryKey({ mbids: mbids2Str }),
        enabled: batch2.length > 0,
        staleTime: 5 * 60 * 1000,
      },
    },
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
    const totalCrossings = allHits.length;
    return { overlapByHandle, totalMbids: total, totalCrossings };
  }, [libraryMbids, hits1, hits2]);
}

// ---------------------------------------------------------------------------
// Section header — matches dial-tier-hd
// ---------------------------------------------------------------------------
function TierHd({ label, live }: { label: string; live?: boolean }) {
  return (
    <div className="dial-tier-hd">
      <span className={`dial-tier-hd__label${live ? " dial-tier-hd__label--live" : ""}`}>
        {live && "● "}{label}
      </span>
      <div className="dial-tier-hd__rule" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat selector row
// ---------------------------------------------------------------------------
interface SelectorRowProps {
  handle: string;
  name: string;
  followKind: "picker" | "selector";
  kindLabel: string;
  meta?: string;
  artists?: string;
  overlapPct?: number | null;
  onPlay?: (e: React.MouseEvent) => void;
  playLoading?: boolean;
  isLive?: boolean;
  isRecent?: boolean;
}

function SelectorRow({
  handle,
  name,
  followKind,
  kindLabel,
  meta,
  artists,
  overlapPct,
  onPlay,
  playLoading,
  isLive,
  isRecent,
}: SelectorRowProps) {
  const follows = useFollows();
  const following = isFollowed(follows, followKind, handle);

  return (
    <Link
      href={`/archive/selectors/${handle}`}
      className={`sel-row${isRecent ? " sel-row--warm" : ""}`}
    >
      <span className={`sel-row__pip${isLive ? " sel-row__pip--live" : ""}`}>
        {isLive ? "●" : "◆"}
      </span>
      <div className="sel-row__body">
        <div className={`sel-row__kind${isLive ? " sel-row__kind--live" : ""}`}>
          {kindLabel}{isLive ? " · Live" : ""}
        </div>
        <div className="sel-row__name">{name}</div>
        {meta && <div className="sel-row__meta">{meta}</div>}
        {artists && <div className="sel-row__artists">{artists}</div>}
      </div>
      <div
        className="sel-row__right"
        onClick={(e) => e.preventDefault()}
      >
        {overlapPct != null && (
          <div className="sel-row__match">
            <span className={`sel-row__match-num${!overlapPct ? " sel-row__match-num--zero" : ""}`}>
              {overlapPct}
            </span>
            <span className="sel-row__match-lbl">% match</span>
          </div>
        )}
        <button
          type="button"
          className={`sel-row__follow${following ? " sel-row__follow--on" : ""}`}
          onClick={(e) => { e.stopPropagation(); toggleFollow(followKind, handle, name); }}
          data-testid={`follow-${followKind}-${handle}`}
        >
          {following ? "✓ Following" : "+ Follow"}
        </button>
        {onPlay && (
          <button
            type="button"
            className="sel-row__play"
            onClick={(e) => { e.stopPropagation(); onPlay(e); }}
            disabled={playLoading}
            aria-label={`Play ${name}`}
          >
            {playLoading ? "…" : "▶"}
          </button>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Curated selector row (with data fetch for play)
// ---------------------------------------------------------------------------
function CuratedSelRow({
  picker,
  item,
  overlapPct,
}: {
  picker: { handle: string; name: string; pickerType: string; description?: string | null };
  item?: PickerDialItem;
  overlapPct?: number | null;
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
        ride.startReplay(seeds, `${picker.name}${run.title ? ` — ${run.title}` : ""}`, { timeOrientation: "curated" });
      }
    } finally {
      setPlayLoading(false);
    }
  };

  const recentlyActive = run ? isRecentlyActive(run.pickedAt) : false;

  const metaParts: string[] = [];
  if (run) {
    if (run.trackCount) metaParts.push(`${run.trackCount} tracks`);
    if (run.pickedAt) metaParts.push(timeAgoShort(run.pickedAt));
    if (run.title) metaParts.push(run.title);
  }

  return (
    <SelectorRow
      handle={picker.handle}
      name={picker.name}
      followKind="picker"
      kindLabel="Selector"
      meta={metaParts.join(" · ") || undefined}
      artists={previewArtists.length > 0 ? previewArtists.join(", ") : undefined}
      overlapPct={overlapPct}
      onPlay={run ? handlePlay : undefined}
      playLoading={playLoading}
      isRecent={recentlyActive}
    />
  );
}

// ---------------------------------------------------------------------------
// Radio DJ row
// ---------------------------------------------------------------------------
function RadioDjRow({ selector }: { selector: SelectorSummary }) {
  const onAir =
    selector.lastPlayedAt != null &&
    Date.now() - new Date(selector.lastPlayedAt).getTime() < ON_AIR_MS;

  const metaParts: string[] = [];
  if (selector.recentSpinCount > 0) {
    metaParts.push(`${selector.recentSpinCount} spin${selector.recentSpinCount === 1 ? "" : "s"} this month`);
  }
  if (selector.lastPlayedAt) metaParts.push(timeAgoShort(selector.lastPlayedAt));

  return (
    <SelectorRow
      handle={selector.handle}
      name={selector.name}
      followKind="selector"
      kindLabel="Radio DJ"
      meta={metaParts.join(" · ") || "No recent spins"}
      isLive={onAir}
      isRecent={onAir}
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Selectors() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { radio } = usePlayer();
  const { data: listData, isLoading: listLoading, isError: listError } = useListPickers();
  const { data: dialData } = useGetPickersDial();
  const { data: kexpData, isLoading: kexpLoading } = useListSelectors();
  const overlap = useLibraryOverlap();

  const dialByHandle = useMemo((): Map<string, PickerDialItem> => {
    const m = new Map<string, PickerDialItem>();
    for (const item of dialData?.items ?? []) m.set(item.picker.handle, item);
    return m;
  }, [dialData]);

  const sortedPickers = useMemo(() => {
    const all = (listData?.pickers ?? []).filter((p) => p.active && p.pickerType !== "dj");

    if (overlap) {
      return [...all].sort((a, b) => {
        const aOverlap = overlap.overlapByHandle.get(a.handle) ?? 0;
        const bOverlap = overlap.overlapByHandle.get(b.handle) ?? 0;
        if (bOverlap !== aOverlap) return bOverlap - aOverlap;
        const aRecent = isRecentlyActive(dialByHandle.get(a.handle)?.run?.pickedAt) ? 1 : 0;
        const bRecent = isRecentlyActive(dialByHandle.get(b.handle)?.run?.pickedAt) ? 1 : 0;
        if (aRecent !== bRecent) return bRecent - aRecent;
        return a.name.localeCompare(b.name);
      });
    }

    const toMs = (handle: string) => {
      const dialItem = dialByHandle.get(handle);
      if (!dialItem?.run?.pickedAt) return 0;
      return new Date(dialItem.run.pickedAt).getTime();
    };
    return [...all].sort((a, b) => {
      const aRecent = isRecentlyActive(dialByHandle.get(a.handle)?.run?.pickedAt) ? 1 : 0;
      const bRecent = isRecentlyActive(dialByHandle.get(b.handle)?.run?.pickedAt) ? 1 : 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      const timeDiff = toMs(b.handle) - toMs(a.handle);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });
  }, [listData, dialByHandle, overlap]);

  const kexpSelectors = kexpData?.selectors ?? [];
  const liveCount = kexpSelectors.filter(
    (s: SelectorSummary) =>
      s.lastPlayedAt != null &&
      Date.now() - new Date(s.lastPlayedAt).getTime() < ON_AIR_MS,
  ).length;
  const totalSelectorCount = sortedPickers.length + kexpSelectors.length;
  const isLoading = listLoading;

  // suppress unused warning — radio is referenced to match AppLayout usage
  void radio;

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
        {totalSelectorCount > 0 && (
          <span className="dial-topbar__sort-chip">
            ◆ {totalSelectorCount}
            {liveCount > 0 && ` · ${liveCount} live`}
          </span>
        )}
        {overlap && (
          <span className="dial-topbar__sort-chip" style={{ marginLeft: 2 }}>
            match sorted
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

      {/* Body */}
      <div className="dial-body">
        {/* Loading skeletons */}
        {isLoading && (
          <div style={{ padding: "16px 15px", display: "flex", flexDirection: "column", gap: 1 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  height: 62,
                  background: "hsl(var(--secondary))",
                  borderBottom: "1px solid hsl(var(--border) / 0.4)",
                  opacity: 0.5 + i * 0.05,
                  animation: "lore-eq 1.8s ease-in-out infinite",
                  animationDelay: `${i * 0.12}s`,
                }}
              />
            ))}
          </div>
        )}

        {listError && !isLoading && (
          <div className="dial-loading">
            Couldn't load selectors — please refresh.
          </div>
        )}

        {!isLoading && !listError && totalSelectorCount === 0 && (
          <div className="dial-loading">No selectors enrolled yet.</div>
        )}

        {/* Curated selectors */}
        {!isLoading && !listError && sortedPickers.length > 0 && (
          <>
            <TierHd label="Curators" />
            {sortedPickers.map((p) => {
              const dialItem = dialByHandle.get(p.handle);
              const overlapPct = overlap ? (overlap.overlapByHandle.get(p.handle) ?? 0) : null;
              return (
                <CuratedSelRow
                  key={p.handle}
                  picker={p}
                  item={dialItem}
                  overlapPct={overlapPct}
                />
              );
            })}
          </>
        )}

        {/* Radio DJs */}
        {(kexpLoading || kexpSelectors.length > 0) && (
          <>
            <TierHd label="Radio DJs" live={liveCount > 0} />
            {kexpLoading ? (
              <div className="dial-loading">Loading…</div>
            ) : (
              kexpSelectors.map((s: SelectorSummary) => (
                <RadioDjRow key={s.handle} selector={s} />
              ))
            )}
          </>
        )}

        <div style={{ height: 80 }} />
      </div>
    </div>
  );
}
