import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListPickers,
  useGetPickersDial,
  getPickerRun,
} from "@workspace/api-client-react";
import type { PickerDialItem } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { FollowButton } from "../components/FollowButton";
import { ArrowLeft, Loader2, Music2, Play, Users, Zap } from "lucide-react";

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

/** Full card for a selector that has a documented run (with artwork mosaic). */
function SelectorDialCard({ item }: { item: PickerDialItem }) {
  const { ride } = usePlayer();
  const [loading, setLoading] = useState(false);
  const recent = isRecentlyActive(item.run.pickedAt);

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const data = await getPickerRun(item.run.runId);
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
          `${item.picker.name}${item.run.title ? ` — ${item.run.title}` : ""}`,
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
          <div className="mt-auto flex items-center gap-2 pt-2 font-mono text-[10px] text-muted-foreground">
            <Music2 className="h-3 w-3 text-primary/60" />
            <span>{item.run.trackCount} pick{item.run.trackCount === 1 ? "" : "s"}</span>
            {item.run.resolvedCount > 0 && item.run.resolvedCount < item.run.trackCount && (
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
}: {
  picker: {
    handle: string;
    name: string;
    pickerType: string;
    description?: string | null;
  };
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
          <p className="mt-auto pt-2 font-mono text-[10px] text-muted-foreground">
            No runs documented yet
          </p>
        </div>
      </Link>
      <div className="mt-2 flex justify-end px-1">
        <FollowButton kind="picker" id={picker.handle} name={picker.name} />
      </div>
    </li>
  );
}

export default function Selectors() {
  const { ride, radio } = usePlayer();
  const { data: listData, isLoading: listLoading, isError: listError } = useListPickers();
  const { data: dialData } = useGetPickersDial();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  // Build a lookup map of dial items by picker handle for O(1) merge.
  const dialByHandle = useMemo((): Map<string, PickerDialItem> => {
    const m = new Map<string, PickerDialItem>();
    for (const item of dialData?.items ?? []) {
      m.set(item.picker.handle, item);
    }
    return m;
  }, [dialData]);

  // Full selector list: all active pickers, sorted by most recently active first
  // (using dial pickedAt for those that have runs), then alphabetically.
  const { recent, others } = useMemo(() => {
    const all = (listData?.pickers ?? []).filter((p) => p.active);
    const toMs = (handle: string) => {
      const dialItem = dialByHandle.get(handle);
      if (!dialItem?.run.pickedAt) return 0;
      return new Date(dialItem.run.pickedAt).getTime();
    };
    const sorted = [...all].sort((a, b) => {
      const aRecent = isRecentlyActive(dialByHandle.get(a.handle)?.run.pickedAt) ? 1 : 0;
      const bRecent = isRecentlyActive(dialByHandle.get(b.handle)?.run.pickedAt) ? 1 : 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      const timeDiff = toMs(b.handle) - toMs(a.handle);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });
    const recentItems = sorted.filter((p) =>
      isRecentlyActive(dialByHandle.get(p.handle)?.run.pickedAt),
    );
    const otherItems = sorted.filter(
      (p) => !isRecentlyActive(dialByHandle.get(p.handle)?.run.pickedAt),
    );
    return { recent: recentItems, others: otherItems };
  }, [listData, dialByHandle]);

  const isLoading = listLoading;
  const isError = listError;

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-5xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-10 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <Users className="h-4 w-4" />
            Selectors
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground">
            Borrow real humans' taste.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            DJs, blogs, labels, and curators whose picks are documented here.
            Every list is ordered, attributed, and rideable — never an
            algorithm.
          </p>
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

        {!isLoading && !isError && recent.length === 0 && others.length === 0 && (
          <p className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
            No selectors enrolled yet.
          </p>
        )}

        {recent.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
              <Zap className="h-3.5 w-3.5" />
              Recently active
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {recent.map((p) => {
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

        {others.length > 0 && (
          <section>
            {recent.length > 0 && (
              <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                All selectors
              </h2>
            )}
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {others.map((p) => {
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
      </div>
    </div>
  );
}
