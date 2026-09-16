import { useState } from "react";
import { ExternalLink, ShoppingBag } from "lucide-react";
import { proxyArtUrl } from "../lib/proxyArt";

export type MerchProduct = {
  title: string;
  artist: string;
  artistMbid?: string | null;
  imageUrl?: string | null;
  destinationUrl: string;
  source: string;
  provider?: string | null;
  kind: string;
};

type MerchCollectionProps = {
  items: readonly MerchProduct[];
  isLoading?: boolean;
  isError?: boolean;
  emptyMessage?: string;
};

/**
 * The shared merch presentation for the Library and artist pages.
 *
 * Artwork is intentionally optional. A verified purchase destination is still
 * useful when a store did not publish product art, so failed images become a
 * small, explicit NO ART tile rather than removing the product.
 */
export function MerchCollection({
  items,
  isLoading = false,
  isError = false,
  emptyMessage = "No verified merch found in your library or seeds.",
}: MerchCollectionProps) {
  if (isError) {
    return (
      <div className="rounded-xl border border-destructive-border bg-destructive/10 p-6 text-center" role="alert" data-testid="merch-error">
        <p className="font-mono text-[13px] text-destructive">Couldn't load merch right now.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-card-border bg-card/50 p-6 text-center" aria-busy="true" data-testid="merch-loading">
        <p className="font-mono text-[13px] text-muted-foreground">Loading merch…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card/50 p-6 text-center" data-testid="merch-empty">
        <p className="font-mono text-[13px] text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3" data-testid="merch-collection">
      {items.map((item, index) => (
        <MerchCard key={`${item.destinationUrl}-${index}`} item={item} />
      ))}
    </div>
  );
}

function MerchCard({ item }: { item: MerchProduct }) {
  const [artFailed, setArtFailed] = useState(false);
  const hasArt = Boolean(item.imageUrl) && !artFailed;

  return (
    <a
      href={item.destinationUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 flex-col gap-2 text-foreground"
      data-testid="merch-card"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg border border-card-border bg-muted">
        {hasArt ? (
          <img
            src={proxyArtUrl(item.imageUrl) ?? undefined}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={() => setArtFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/60" data-testid="merch-no-art">
            <ShoppingBag className="h-6 w-6" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]">NO ART</span>
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5 text-foreground backdrop-blur-sm">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Open purchase link</span>
        </span>
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm leading-tight text-foreground group-hover:text-primary">{item.title}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{item.artist}</p>
        <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted-foreground/70">
          <span className="truncate">{item.source}</span>
          {item.provider ? <span className="truncate normal-case tracking-normal">via {item.provider}</span> : null}
        </p>
      </div>
    </a>
  );
}