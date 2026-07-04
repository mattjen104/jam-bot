import { useState } from "react";
import { Link } from "wouter";
import { Loader2, Music2, Play } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import { FollowButton } from "./FollowButton";
import { getPickerRun } from "@workspace/api-client-react";
import type { PickerDialItem } from "@workspace/api-client-react";

/**
 * 2×2 mosaic of album artwork from the first 4 tracks of a curated list.
 * Cells with no artwork show a muted placeholder.
 */
function ArtworkMosaic({
  tracks,
}: {
  tracks: { artworkUrl: string | null }[];
}) {
  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 overflow-hidden">
      {[0, 1, 2, 3].map((i) => {
        const art = tracks[i]?.artworkUrl ?? null;
        return (
          <div key={i} className="overflow-hidden bg-muted">
            {art && (
              <img
                src={art}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One curated-list card — same visual language as a station card.
 * The 2×2 artwork mosaic doubles as the play button.
 */
function PickerCard({ item }: { item: PickerDialItem }) {
  const { ride } = usePlayer();
  const [loading, setLoading] = useState(false);

  const handlePlay = async (e: React.MouseEvent) => {
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

  const monthYear = item.run.pickedAt
    ? new Date(item.run.pickedAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : null;

  const subtitle = item.run.title ? item.picker.name : item.picker.description;

  return (
    <li>
      <div className="hover-elevate group flex items-center gap-4 rounded-xl border border-card-border bg-card p-3 pr-4 transition-colors">
        {/* Mosaic / play button */}
        <button
          type="button"
          onClick={handlePlay}
          disabled={loading}
          aria-label={`Play ${item.run.title ?? item.picker.name}`}
          className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          <ArtworkMosaic tracks={item.previewTracks} />
          <span className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/45" />
          <span className="relative text-white drop-shadow">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            )}
          </span>
        </button>

        {/* Text column */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <h3 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">
            {item.run.title ?? item.picker.name}
          </h3>
          {subtitle && (
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {subtitle}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Music2 className="h-3 w-3 text-primary/70" />
            <span>
              {item.run.resolvedCount} playable
              {item.run.trackCount > item.run.resolvedCount
                ? ` of ${item.run.trackCount}`
                : ""}
            </span>
            {monthYear && <span>· {monthYear}</span>}
          </p>
        </div>

        {/* Right rail: follow picker + archive link */}
        <div
          className="flex shrink-0 flex-col items-end gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <FollowButton kind="picker" id={item.picker.handle} name={item.picker.name} />
          <Link
            href={`/archive/pickers/${item.picker.handle}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-primary"
          >
            Archive →
          </Link>
        </div>
      </div>
    </li>
  );
}

/**
 * The curated-lists section of the dial: a heading and one card per picker.
 * Renders nothing when the list is empty (e.g. on initial load).
 */
export function PickerDial({ items }: { items: PickerDialItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        Curated Lists
      </h2>
      <ul className="flex flex-col gap-2" data-testid="picker-dial">
        {items.map((item) => (
          <PickerCard key={item.picker.handle} item={item} />
        ))}
      </ul>
    </section>
  );
}
