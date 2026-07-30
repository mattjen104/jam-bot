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
import { Loader2, Play, Users } from "lucide-react";

const ON_AIR_MS = 2 * 60 * 60 * 1000; // 2 hours = "live now"
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

/** Derive 1–2 character initials from a name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
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
// Initials avatar
// ---------------------------------------------------------------------------

function InitialsAvatar({ name, size = "lg" }: { name: string; size?: "sm" | "lg" }) {
  const letters = initials(name);
  const sz = size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs";
  return (
    <div
      className={`${sz} shrink-0 rounded-full border-2 border-picker bg-picker/10 flex items-center justify-center font-serif font-semibold text-picker`}
    >
      {letters}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curated selector card (new design)
// ---------------------------------------------------------------------------

function CuratedSelectorCard({
  item,
  picker,
  overlapPct,
}: {
  item?: PickerDialItem;
  picker: { handle: string; name: string; pickerType: string; description?: string | null };
  overlapPct?: number | null;
}) {
  const { ride } = usePlayer();
  const [loading, setLoading] = useState(false);

  const run = item?.run;

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!run) return;
    setLoading(true);
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
        ride.startReplay(
          seeds,
          `${picker.name}${run.title ? ` — ${run.title}` : ""}`,
          { timeOrientation: "curated" },
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // Derive preview artists from previewTracks (use up to 3 unique artists)
  const previewArtists = useMemo(() => {
    if (!item?.previewTracks) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of item.previewTracks) {
      const a = (t as { artist?: string }).artist;
      if (a && !seen.has(a)) {
        seen.add(a);
        out.push(a);
        if (out.length >= 3) break;
      }
    }
    return out;
  }, [item]);

  const hasOverlap = overlapPct != null && overlapPct > 0;
  const recentlyActive = run ? isRecentlyActive(run.pickedAt) : false;

  return (
    <li>
      <Link
        href={`/archive/selectors/${picker.handle}`}
        className="hover-elevate group flex flex-col gap-0 overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow"
      >
        {/* Top bar: avatar + name + badge + overlap % */}
        <div className="flex items-start gap-4 p-5 pb-4">
          <InitialsAvatar name={picker.name} />

          <div className="min-w-0 flex-1">
            {/* Selector badge */}
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-picker">
                ◆ Selector
              </span>
              {recentlyActive && (
                <span className="inline-flex items-center gap-1 rounded-full border border-picker/40 bg-picker/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-picker">
                  Recent
                </span>
              )}
            </div>
            <h3 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">
              {picker.name}
            </h3>
            {picker.description && (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {picker.description}
              </p>
            )}
          </div>

          {/* Overlap % — large Fraunces numeral */}
          {overlapPct != null && (
            <div className="shrink-0 text-right">
              <p
                className={`font-serif text-3xl font-semibold leading-none tabular-nums ${
                  hasOverlap ? "text-primary" : "text-muted-foreground/40"
                }`}
              >
                {overlapPct}
              </p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                % match
              </p>
            </div>
          )}
        </div>

        {/* Bottom row: set count + artists + play button */}
        <div className="flex items-center gap-3 border-t border-card-border px-5 py-3">
          <div className="min-w-0 flex-1">
            {run ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {run.trackCount} tracks
                </span>
                {run.pickedAt && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {timeAgoShort(run.pickedAt)}
                  </span>
                )}
                {previewArtists.length > 0 && (
                  <span className="truncate font-mono text-[10px] text-primary/70">
                    {previewArtists.join(", ")}
                  </span>
                )}
              </div>
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground">No runs yet</span>
            )}
          </div>

          <div
            className="flex items-center gap-2"
            onClick={(e) => e.preventDefault()}
          >
            <FollowButton kind="picker" id={picker.handle} name={picker.name} />
            {run && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); void handlePlay(e); }}
                disabled={loading}
                aria-label={`Play ${run.title ?? picker.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary opacity-0 transition-opacity group-hover:opacity-100 active:scale-95 disabled:opacity-30"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="ml-px h-3.5 w-3.5 fill-current" />
                )}
              </button>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// KEXP radio selector card (new design)
// ---------------------------------------------------------------------------

function RadioSelectorCard({ selector }: { selector: SelectorSummary }) {
  const onAir =
    selector.lastPlayedAt != null &&
    Date.now() - new Date(selector.lastPlayedAt).getTime() < ON_AIR_MS;

  return (
    <li>
      <Link
        href={`/archive/selectors/${selector.handle}`}
        className="hover-elevate flex items-center gap-4 rounded-2xl border border-card-border bg-card p-4 transition-shadow"
      >
        <InitialsAvatar name={selector.name} size="sm" />

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-picker">
              ◆ Selector
            </span>
            {onAir && (
              <span className="inline-flex items-center gap-1 rounded-full border border-live/50 bg-live/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-live">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
                Live
              </span>
            )}
          </div>
          <p className="truncate font-serif text-base font-semibold text-foreground">
            {selector.name}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {selector.recentSpinCount > 0
              ? `${selector.recentSpinCount} spin${selector.recentSpinCount === 1 ? "" : "s"} this month`
              : "No recent spins"}
            {selector.lastPlayedAt && ` · ${timeAgoShort(selector.lastPlayedAt)}`}
          </p>
        </div>

        <FollowButton
          kind="selector"
          id={selector.handle}
          name={selector.name}
        />
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Hero stat block
// ---------------------------------------------------------------------------

function HeroStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
    </div>
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

  // Hero stats
  const kexpSelectors = kexpData?.selectors ?? [];
  const liveCount = kexpSelectors.filter(
    (s: SelectorSummary) =>
      s.lastPlayedAt != null &&
      Date.now() - new Date(s.lastPlayedAt).getTime() < ON_AIR_MS,
  ).length;
  const totalSelectorCount = sortedPickers.length + kexpSelectors.length;

  const isLoading = listLoading;
  const isError = listError;

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-5xl px-4 pt-8 sm:px-6 ${dockPadding}`}>

        {/* ── Hero ─────────────────────────────────────────────── */}
        <header className="mb-10">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-picker">
            <Users className="h-4 w-4" />
            Selectors
          </div>
          <h1 className="mt-3 max-w-[22ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground">
            Borrow real humans' taste.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            DJs, blogs, labels, and curators whose picks are documented here.
            Every list is ordered, attributed, and rideable — never an algorithm.
          </p>

          {/* Stats row */}
          <div className="mt-8 flex flex-wrap gap-8">
            {!listLoading && totalSelectorCount > 0 && (
              <HeroStat value={totalSelectorCount} label="Selectors" />
            )}
            {overlap && overlap.totalCrossings > 0 && (
              <HeroStat value={overlap.totalCrossings} label="Crossings with your library" />
            )}
            {liveCount > 0 && (
              <div className="flex flex-col">
                <span className="flex items-center gap-2 font-serif text-3xl font-semibold tabular-nums text-live">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-live" />
                  {liveCount}
                </span>
                <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Live right now
                </span>
              </div>
            )}
          </div>

          {overlap && (
            <p className="mt-4 font-mono text-[11px] text-muted-foreground">
              Sorted by match against your {overlap.totalMbids}-track library.
            </p>
          )}
        </header>

        {/* ── Loading / error states ────────────────────────────── */}
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-2xl border border-card-border bg-card"
              />
            ))}
          </div>
        )}

        {isError && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-foreground">
            Couldn't load selectors. Please refresh.
          </p>
        )}

        {!isLoading && !isError && sortedPickers.length === 0 && kexpSelectors.length === 0 && (
          <p className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
            No selectors enrolled yet.
          </p>
        )}

        {/* ── Curated selector cards ────────────────────────────── */}
        {!isLoading && !isError && sortedPickers.length > 0 && (
          <section className="mb-12">
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sortedPickers.map((p) => {
                const dialItem = dialByHandle.get(p.handle);
                const overlapPct = overlap ? (overlap.overlapByHandle.get(p.handle) ?? 0) : null;
                return (
                  <CuratedSelectorCard
                    key={p.handle}
                    item={dialItem}
                    picker={p}
                    overlapPct={overlapPct}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {/* ── Radio selectors ───────────────────────────────────── */}
        {(kexpLoading || kexpSelectors.length > 0) && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                Radio selectors
              </h2>
            </div>
            <p className="mb-6 max-w-[52ch] text-sm text-muted-foreground">
              DJs whose every spin is attributed and browsable by show.
            </p>
            {kexpLoading ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-2xl border border-card-border bg-card"
                  />
                ))}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {kexpSelectors.map((s: SelectorSummary) => (
                  <RadioSelectorCard key={s.handle} selector={s} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
