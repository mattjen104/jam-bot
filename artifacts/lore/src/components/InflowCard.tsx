import { Link } from "wouter";
import { KeepButton } from "./KeepButton";
import type { LibraryItem } from "../lib/meHooks";
import { RUMOURS, onArtError } from "../lib/rumours";

interface InflowCardProps {
  item: LibraryItem;
  pickerName?: string;
  pickerHandle?: string;
}

/**
 * A horizontal-scroll card showing a track from a followed picker that hasn't
 * been kept yet. Fable palette: panel background, violet picker attribution,
 * Fraunces title, dim artist.
 */
export function InflowCard({ item, pickerName, pickerHandle }: InflowCardProps) {
  const rec = item.recording;
  const title = rec?.title ?? (item.mbid ? item.mbid.slice(0, 8) : "Unknown track");
  const artist = rec?.artist ?? "";
  const artwork = rec?.artworkUrl ?? null;
  const attribution = pickerName ?? item.provenance.pickerHandle ?? item.provenance.stationSlug ?? "";
  const attributionHref = pickerHandle
    ? `/archive/selectors/${pickerHandle}`
    : item.provenance.stationSlug
      ? `/archive/stations/${item.provenance.stationSlug}`
      : null;

  return (
    <div
      className="flex w-52 shrink-0 flex-col gap-3 rounded-2xl border border-card-border bg-card p-4 shadow"
      data-testid="inflow-card"
    >
      <div className="h-28 w-full overflow-hidden rounded-lg bg-muted">
        <img
          src={artwork ?? RUMOURS}
          alt={`${title} — ${artist}`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={onArtError}
        />
      </div>

      <div className="min-w-0">
        {item.mbid ? (
          <Link
            href={`/song/${item.mbid}`}
            className="block truncate font-serif text-sm font-semibold leading-tight text-foreground hover:text-primary"
          >
            {title}
          </Link>
        ) : (
          <p className="truncate font-serif text-sm font-semibold leading-tight text-foreground">
            {title}
          </p>
        )}
        {artist && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{artist}</p>
        )}
        {attribution && (
          <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-wide text-[#a78bfa]">
            {attributionHref ? (
              <Link href={attributionHref} className="hover:text-primary">
                via {attribution}
              </Link>
            ) : (
              `via ${attribution}`
            )}
          </p>
        )}
      </div>

      <KeepButton
        mbid={item.mbid}
        provenance={item.provenance}
        compact
      />
    </div>
  );
}
