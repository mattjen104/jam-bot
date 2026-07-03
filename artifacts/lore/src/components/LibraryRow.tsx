import { Link } from "wouter";
import { Disc3, CheckCircle2 } from "lucide-react";
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

  const provSource =
    item.provenance.kind === "keep"
      ? item.provenance.pickerHandle
        ? `via ${item.provenance.pickerHandle}`
        : item.provenance.stationSlug
          ? `via ${item.provenance.stationSlug}`
          : "kept from radio"
      : item.provenance.kind === "import" && item.provenance.service
        ? `imported from ${item.provenance.service}`
        : item.provenance.kind ?? "library";

  const mirrorBadge = item.provenance.kind === "import" && item.provenance.service === "spotify";

  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3"
      data-testid="library-row"
    >
      {/* 42×42 artwork swatch */}
      <div className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-[#C6F53F]/20 via-muted to-[#a78bfa]/20">
        {artwork ? (
          <img
            src={artwork}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 className="h-5 w-5 text-muted-foreground/40" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {item.mbid ? (
          <Link
            href={`/song/${item.mbid}`}
            className="truncate font-serif text-base font-semibold text-foreground hover:text-primary"
          >
            {title}
          </Link>
        ) : (
          <p className="truncate font-serif text-base font-semibold text-foreground">{title}</p>
        )}
        {artist && (
          <p className="truncate text-sm text-muted-foreground">{artist}</p>
        )}
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wide text-[#a78bfa]">
          {provSource}
        </p>
      </div>

      {mirrorBadge && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#1DB954]/30 bg-[#1DB954]/10 px-2 py-0.5 font-mono text-[10px] text-[#1DB954]">
          <CheckCircle2 className="h-3 w-3" />
          Spotify ✓
        </span>
      )}
    </li>
  );
}
