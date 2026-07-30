import { Link } from "wouter";
import { Disc3 } from "lucide-react";
import type { LibraryItem } from "../lib/meHooks";

interface LibraryRowProps {
  item: LibraryItem;
}

/** A single row in the "Kept" section of the Library page. */
export function LibraryRow({ item }: LibraryRowProps) {
  const rec = item.recording;
  const title = rec?.title ?? item.mbid.slice(0, 8);
  const artist = rec?.artist ?? "";
  const artwork = rec?.artworkUrl ?? null;
  const albumTitle = rec?.albumTitle ?? null;

  // "heard on" label — station slug or picker attribution in orange mono
  const heardOn: string | null = (() => {
    if (item.provenance.kind === "keep") {
      if (item.provenance.stationSlug) return item.provenance.stationSlug;
      if (item.provenance.pickerHandle) return item.provenance.pickerHandle;
      return null;
    }
    if (item.provenance.kind === "import" && item.provenance.service) {
      return null; // imported items show no "heard on"
    }
    return null;
  })();

  const isImportedFromSpotify =
    item.provenance.kind === "import" && item.provenance.service === "spotify";

  return (
    <li
      className="group flex items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3 transition-colors hover:bg-card/80"
      data-testid="library-row"
    >
      {/* 40×40 artwork swatch */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
        {artwork ? (
          <img
            src={artwork}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 className="h-4 w-4 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Main text */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {item.mbid ? (
            <Link
              href={`/song/${item.mbid}`}
              className="truncate font-serif text-base font-semibold leading-tight text-foreground hover:text-primary"
            >
              {title}
            </Link>
          ) : (
            <p className="truncate font-serif text-base font-semibold leading-tight text-foreground">
              {title}
            </p>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {artist && (
            <span className="truncate text-sm text-muted-foreground">{artist}</span>
          )}
          {albumTitle && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate text-sm text-muted-foreground/60">{albumTitle}</span>
            </>
          )}
        </div>
        {heardOn && (
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wide text-primary/70">
            heard on {heardOn}
          </p>
        )}
        {isImportedFromSpotify && !heardOn && (
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/50">
            from Spotify
          </p>
        )}
      </div>
    </li>
  );
}
