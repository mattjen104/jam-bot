import { useMemo, useState } from "react";
import { Link } from "wouter";
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
import { FollowButton } from "../components/FollowButton";
import { Loader2, Music2, Play, Radio, Users, Zap } from "lucide-react";

const RECENTLY_ACTIVE_MS = 14 * 24 * 60 * 60 * 1000;
const ON_AIR_MS = 2 * 60 * 60 * 1000; // 2 hours = "live now"

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

/**
 * Computes per-picker overlap percentage against the user's saved library.
 * Fetches up to 60 library recordings and batch-queries the picks index.
 * Returns null when the user has no library items (unauthenticated or empty).
 */
function useLibraryOverlap(): {
  overlapByHandle: Map<string, number>;
  totalMbids: number;
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
      // Round to one decimal place
      overlapByHandle.set(handle, Math.round((count / total) * 1000) / 10);
    }
    return { overlapByHandle, totalMbids: total };
  }, [libraryMbids, hits1, hits2]);
}

// ---------------------------------------------------------------------------
// Artwork mosaic
// ---------------------------------------------------------------------------

/**
 * 2×2 artwork mosaic from the first 4 tracks of a curated list.
 */
function ArtworkMosaic({ tracks }: { tracks: { artworkUrl: string | null }[] }) {
  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden">
      {[0, 1, 2, 3].map((i) => {
        const art = tracks[i]?.artworkUrl ?? null;
        return (
          <div key={i} className="overflow-hidden bg-muted">
            {art && <img src={art} alt="" className="h-full w-full object-cover" />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curated selector cards
// ---------------------------------------------------------------------------

/** Full card for a selector that has a documented run (with artwork mosaic). */
function SelectorDialCard({
  item,
  overlapPct,
}: {
  item: PickerDialItem;
  overlapPct?: number | null;
}) {
  const { ride } = usePlayer();
  const [loading, setLoading] = useState(false);

  if (!item.run) return null;

  const recent = isRecentlyActive(item.run.pickedAt);

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const data = await getPickerRun(item.run!.runId);
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
        ride.startReplay(
          seeds,
          `${item.picker.name}${item.run!.title ? ` — ${item.run!.title}` : ""}`,
          { timeOrientation: "curated" },
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="flex flex-col">
      <Link
        href={`/archive/selectors/${item.picker.handle}`}
        className="hover-elevate group flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card"
      >
        {/* Artwork mosaic */}
        <div className="relative h-32 w-full shrink-0 overflow-hidden bg-muted">
          <ArtworkMosaic tracks={item.previewTracks} />
          {recent && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary backdrop-blur-sm">
              <Zap className="h-2.5 w-2.5" />
              Active
            </span>
          )}
          <button
            type="button"
            onClick={handlePlay}
            disabled={loading}
            aria-label={`Play ${item.run.title ?? item.picker.name}`}
            className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 active:scale-95 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            )}
          </button>
        </div>

        {/* Text */}
        <div className="flex flex-1 flex-col gap-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-serif text-base font-semibold leading-snug text-foreground">
              {item.picker.name}
            </h3>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              {item.picker.pickerType}
            </span>
          </div>
          {item.picker.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {item.picker.description}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 font-mono text-[10px] text-muted-foreground">
            <Music2 className="h-3 w-3 text-primary/60" />
            <span>
              {item.run.trackCount} pick{item.run.trackCount === 1 ? "" : "s"}
            </span>
            {item.run.resolvedCount > 0 &&
              item.run.resolvedCount < item.run.trackCount && (
                <>
                  <span>·</span>
                  <span className="text-primary">{item.run.resolvedCount} playable</span>
                </>
              )}
            {item.run.pickedAt && (
              <>
                <span>·</span>
                <span>{timeAgoShort(item.run.pickedAt)}</span>
              </>
            )}
            {overlapPct != null && (
              <>
                <span>·</span>
                <span
                  className={overlapPct > 0 ? "font-semibold text-primary" : ""}
                >
                  {overlapPct > 0 ? `${overlapPct}% match` : "0% match"}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="mt-2 flex justify-end px-1">
        <FollowButton kind="picker" id={item.picker.handle} name={item.picker.name} />
      </div>
    </li>
  );
}

/** Simpler card for a selector that has no documented runs yet. */
function SelectorSimpleCard({
  picker,
  overlapPct,
}: {
  picker: {
    handle: string;
    name: string;
    pickerType: string;
    description?: string | null;
  };
  overlapPct?: number | null;
}) {
  return (
    <li className="flex flex-col">
      <Link
        href={`/archive/selectors/${picker.handle}`}
        className="hover-elevate flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card"
      >
        <div className="flex h-32 w-full items-center justify-center bg-muted/40">
          <Users className="h-10 w-10 text-muted-foreground/20" />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-serif text-base font-semibold leading-snug text-foreground">
              {picker.name}
            </h3>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              {picker.pickerType}
            </span>
          </div>
          {picker.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {picker.description}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 font-mono text-[10px] text-muted-foreground">
            <span>No runs documented yet</span>
            {overlapPct != null && (
              <>
                <span>·</span>
                <span className={overlapPct > 0 ? "font-semibold text-primary" : ""}>
                  {overlapPct > 0 ? `${overlapPct}% match` : "0% match"}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="mt-2 flex justify-end px-1">
        <FollowButton kind="picker" id={picker.handle} name={picker.name} />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// KEXP radio selector card
// ---------------------------------------------------------------------------

/** Card for a KEXP radio selector (spin-based, no curated artwork mosaic). */
function KexpSelectorCard({ selector }: { selector: SelectorSummary }) {
  const onAir =
    selector.lastPlayedAt != null &&
    Date.now() - new Date(selector.lastPlayedAt).getTime() < ON_AIR_MS;
  const recentlyActive =
    !onAir &&
    selector.lastPlayedAt != null &&
    Date.now() - new Date(selector.lastPlayedAt).getTime() < 30 * 24 * 60 * 60 * 1000;

  return (
    <li className="flex flex-col">
      <Link
        href={`/archive/selectors/${selector.handle}`}
        className="hover-elevate flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card"
      >
        <div className="flex h-20 w-full items-center justify-center gap-3 bg-muted/40 px-4">
          <Radio className="h-6 w-6 shrink-0 text-primary/40" />
          <span className="truncate font-serif text-lg font-semibold text-foreground">
            {selector.name}
          </span>
          {onAir && (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Live now
            </span>
          )}
          {recentlyActive && (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">
              <Zap className="h-2.5 w-2.5" />
              Active
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              Selector
            </span>
          </div>
          <div className="mt-auto flex items-center gap-2 pt-2 font-mono text-[10px] text-muted-foreground">
            <Music2 className="h-3 w-3 text-primary/60" />
            {selector.recentSpinCount > 0 ? (
              <span>
                {selector.recentSpinCount} spin{selector.recentSpinCount === 1 ? "" : "s"} this
                month
              </span>
            ) : (
              <span>No recent spins</span>
            )}
            {selector.lastPlayedAt && (
              <>
                <span>·</span>
                <span>{timeAgoShort(selector.lastPlayedAt)}</span>
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="mt-2 flex justify-end px-1">
        <FollowButton kind="selector" id={selector.handle} name={selector.name} />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Selectors() {
  const { ride, radio } = usePlayer();
  const { data: listData, isLoading: listLoading, isError: listError } = useListPickers();
  const { data: dialData } = useGetPickersDial();
  const { data: kexpData, isLoading: kexpLoading } = useListSelectors();
  const overlap = useLibraryOverlap();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  // Build a lookup map of dial items by picker handle for O(1) merge.
  const dialByHandle = useMemo((): Map<string, PickerDialItem> => {
    const m = new Map<string, PickerDialItem>();
    for (const item of dialData?.items ?? []) {
      m.set(item.picker.handle, item);
    }
    return m;
  }, [dialData]);

  // All active non-DJ pickers, sorted by overlap % when library is available,
  // otherwise by most recently active first then alphabetically.
  const sortedPickers = useMemo(() => {
    const all = (listData?.pickers ?? []).filter((p) => p.active && p.pickerType !== "dj");

    if (overlap) {
      return [...all].sort((a, b) => {
        const aOverlap = overlap.overlapByHandle.get(a.handle) ?? 0;
        const bOverlap = overlap.overlapByHandle.get(b.handle) ?? 0;
        if (bOverlap !== aOverlap) return bOverlap - aOverlap;
        // Secondary: recently active first
        const aRecent = isRecentlyActive(dialByHandle.get(a.handle)?.run?.pickedAt) ? 1 : 0;
        const bRecent = isRecentlyActive(dialByHandle.get(b.handle)?.run?.pickedAt) ? 1 : 0;
        if (aRecent !== bRecent) return bRecent - aRecent;
        return a.name.localeCompare(b.name);
      });
    }

    // Fallback sort: recently active first, then alphabetically
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

  // When no overlap data, split into recent / others for section headings.
  const recentPickers = useMemo(
    () =>
      overlap
        ? []
        : sortedPickers.filter((p) =>
            isRecentlyActive(dialByHandle.get(p.handle)?.run?.pickedAt),
          ),
    [sortedPickers, dialByHandle, overlap],
  );
  const otherPickers = useMemo(
    () =>
      overlap
        ? sortedPickers
        : sortedPickers.filter(
            (p) => !isRecentlyActive(dialByHandle.get(p.handle)?.run?.pickedAt),
          ),
    [sortedPickers, dialByHandle, overlap],
  );

  const isLoading = listLoading;
  const isError = listError;

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-5xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <header className="mb-10">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <Users className="h-4 w-4" />
            Selectors
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground">
            Borrow real humans' taste.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            DJs, blogs, labels, and curators whose picks are documented here.
            Every list is ordered, attributed, and rideable — never an algorithm.
          </p>
          {overlap && (
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">
              Sorted by match against your {overlap.totalMbids}-track library.
            </p>
          )}
        </header>

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-2xl border border-card-border bg-card"
              />
            ))}
          </div>
        )}

        {isError && (
          <p className="rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
            Couldn't load selectors. Please refresh.
          </p>
        )}

        {!isLoading && !isError && sortedPickers.length === 0 && recentPickers.length === 0 && (
          <p className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
            No selectors enrolled yet.
          </p>
        )}

        {/* When overlap data is available: single sorted list */}
        {overlap && sortedPickers.length > 0 && (
          <section className="mb-10">
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sortedPickers.map((p) => {
                const dialItem = dialByHandle.get(p.handle);
                const overlapPct = overlap.overlapByHandle.get(p.handle) ?? 0;
                return dialItem ? (
                  <SelectorDialCard key={p.handle} item={dialItem} overlapPct={overlapPct} />
                ) : (
                  <SelectorSimpleCard key={p.handle} picker={p} overlapPct={overlapPct} />
                );
              })}
            </ul>
          </section>
        )}

        {/* When no overlap data: split into recently active / all selectors */}
        {!overlap && recentPickers.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
              <Zap className="h-3.5 w-3.5" />
              Recently active
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {recentPickers.map((p) => {
                const dialItem = dialByHandle.get(p.handle);
                return dialItem ? (
                  <SelectorDialCard key={p.handle} item={dialItem} />
                ) : (
                  <SelectorSimpleCard key={p.handle} picker={p} />
                );
              })}
            </ul>
          </section>
        )}

        {!overlap && otherPickers.length > 0 && (
          <section>
            {recentPickers.length > 0 && (
              <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                All selectors
              </h2>
            )}
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {otherPickers.map((p) => {
                const dialItem = dialByHandle.get(p.handle);
                return dialItem ? (
                  <SelectorDialCard key={p.handle} item={dialItem} />
                ) : (
                  <SelectorSimpleCard key={p.handle} picker={p} />
                );
              })}
            </ul>
          </section>
        )}

        {/* KEXP radio selectors — spin-backed DJ pickers */}
        {(kexpLoading || (kexpData?.selectors ?? []).length > 0) && (
          <section className="mt-12">
            <div className="mb-4 flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-primary" />
              <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
                Radio selectors
              </h2>
            </div>
            <p className="mb-6 max-w-[52ch] text-sm text-muted-foreground">
              KEXP DJs whose every spin is attributed and browsable by show.
            </p>
            {kexpLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-40 animate-pulse rounded-2xl border border-card-border bg-card"
                  />
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(kexpData?.selectors ?? []).map((s: SelectorSummary) => (
                  <KexpSelectorCard key={s.handle} selector={s} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
