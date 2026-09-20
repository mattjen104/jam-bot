import { useEffect } from "react";
import { Link, useParams, useSearch, Redirect } from "wouter";
import { Download, Play, Square, Disc3, ExternalLink } from "lucide-react";
import {
  ApiError,
  useGetCollection,
  useGetCollectionJspf,
  useGetCollectionPlayerCapability,
} from "@workspace/api-client-react";
import { AlbumCreditsDisclosure, CreditSummary } from "../components/CreditDisclosure";
import { usePublicCollectionCredits } from "../hooks/usePublicCollectionCredits";
import { usePlayer } from "../player/PlayerProvider";
import { SectionHeading, TrackRow, AlbumSkeleton, AlbumBackdrop } from "./Album";
import { useMyLibraryMbids } from "../lib/meHooks";
import { proxyArtUrl } from "../lib/proxyArt";

function PlayerAdapter({
  data,
  isError,
}: {
  data: unknown;
  isError: boolean;
}) {
  if (isError || !data) return null;
  const capability = data as { available?: boolean; reason?: string };
  if (capability.available) return null;
  return <p className="mt-3 text-[13px] text-muted-foreground/60">{capability.reason ?? "A compatible player is not available yet."}</p>;
}

export function ProviderLinks({ links }: { links: Array<{ label: string; url: string }> }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          data-testid={`provider-link-${link.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {link.label}
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

export default function PublicCollection() {
  const { slug = "" } = useParams();
  const search = useSearch();
  const { data, isLoading, isError, error } = useGetCollection(slug);
  const jspf = useGetCollectionJspf(slug);
  const playerCapabilityQuery = useGetCollectionPlayerCapability(slug);
  const credits = usePublicCollectionCredits(slug, data?.kind === "album");
  const { ride } = usePlayer();
  const { data: libraryIdentity } = useMyLibraryMbids();
  
  const keptMbids = new Set(libraryIdentity?.mbids ?? []);
  
  useEffect(() => {
    if (!data) return;
    const title = `${data.title} · Lore`;
    document.title = title;
    const description = data.description ?? `A public ${data.kind} collection on Lore.`;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement("meta"); meta.name = "description"; document.head.appendChild(meta); }
    meta.content = description;
    for (const [property, content] of [["og:title", title], ["og:description", description], ["og:type", "website"]] as const) {
      let tag = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
      if (!tag) { tag = document.createElement("meta"); tag.setAttribute("property", property); document.head.appendChild(tag); }
      tag.content = content;
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="font-mono text-[13px] uppercase tracking-wider text-muted-foreground hover:text-primary">← Lore</Link>
        <AlbumSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    const withdrawn = error instanceof ApiError && error.status === 410;
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 pb-24">
        <Link href="/" className="font-mono text-[13px] uppercase tracking-wider text-muted-foreground hover:text-primary">← Lore</Link>
        <h1 className="mt-8 font-serif text-4xl text-foreground">{withdrawn ? "Collection withdrawn" : "Collection not found"}</h1>
        <p className="mt-3 text-muted-foreground">{withdrawn ? "The curator withdrew this collection. This link is being kept so it cannot be reassigned." : "This collection could not be found."}</p>
      </main>
    );
  }

  if (data && (data as any).canonicalAlbumHref) {
    const searchParams = new URLSearchParams(search);
    searchParams.set("collection", slug);
    return <Redirect to={`${(data as any).canonicalAlbumHref}?${searchParams.toString()}`} />;
  }

  const spotifyAlbumId = data.entries
    .map((entry) => (entry as { spotifyAlbumId?: string }).spotifyAlbumId)
    .find(Boolean);
  const providerAlbumLinks = data.entries
    .map((entry) => (entry as {
      providerAlbumLinks?: Partial<Record<"spotify" | "appleMusic" | "qobuz" | "bandcamp", string>>;
    }).providerAlbumLinks)
    .find(Boolean);
  const bandcampUnavailable = data.entries.some((entry) =>
    (entry as { providerAvailability?: { bandcamp?: string } }).providerAvailability?.bandcamp === "unavailable",
  );
  
  const albumLinks = [
    { label: "Spotify", url: providerAlbumLinks?.spotify ?? (spotifyAlbumId ? `https://open.spotify.com/album/${spotifyAlbumId}` : undefined) },
    { label: "Apple Music", url: providerAlbumLinks?.appleMusic },
    { label: "Qobuz", url: providerAlbumLinks?.qobuz },
    { label: "Bandcamp", url: providerAlbumLinks?.bandcamp },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url));

  const download = () => {
    if (!jspf.data) return;
    const blob = new Blob([JSON.stringify(jspf.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); 
    const a = document.createElement("a");
    a.href = url; a.download = `${data.slug}.jspf`; a.click(); URL.revokeObjectURL(url);
  };

  const isPreviewing = ride.active && ride.listenContext === `collection:${slug}`;
  const playCandidates = data.entries.filter(e => (e as any).mbid);
  const playerCapability = playerCapabilityQuery.data as {
    available?: boolean;
    reason?: string;
  } | undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24">
      <AlbumBackdrop url={data.coverArt} />
      <Link href="/" className="font-mono text-[13px] uppercase tracking-wider text-muted-foreground hover:text-primary">← Lore</Link>
      
      <header className="album-open mt-10 space-y-2">
        {data.coverArt && (
          <img 
            src={proxyArtUrl(data.coverArt) ?? data.coverArt} 
            alt="" 
            className="album-open__cover ring-1 ring-border/10" 
          />
        )}
        <p className="font-mono text-[12px] font-medium uppercase tracking-[0.25em] text-primary/90">{data.kind}</p>
        <h1 className="font-serif text-[2.75rem] font-normal leading-none tracking-tight text-foreground sm:text-[3.5rem]">{data.title}</h1>
        
        {data.description && <p className="mt-3 text-lg text-muted-foreground/90">{data.description}</p>}
        {data.curatorNotes && <p className="mt-4 border-l-2 border-primary/40 pl-4 text-base text-muted-foreground italic">{data.curatorNotes}</p>}
        
        <ProviderLinks links={albumLinks} />
        <PlayerAdapter data={playerCapabilityQuery.data} isError={playerCapabilityQuery.isError} />
        
        {bandcampUnavailable && (
          <p className="mt-3 text-xs text-muted-foreground/60">No official release of this album is available on Bandcamp.</p>
        )}

        <div className="mt-8 pt-6 flex flex-wrap items-center gap-4 border-t border-border/50">
          <button type="button" onClick={download} disabled={!jspf.data} data-testid="download-jspf" className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 font-mono text-[12px] font-semibold uppercase tracking-wider text-muted-foreground disabled:opacity-40 hover:bg-muted hover:text-foreground">
            <Download className="h-4 w-4" /> JSPF
          </button>
          
          {playerCapability?.available === true && playCandidates.length > 0 && (
            <button
              type="button"
              data-testid="preview-album"
              onClick={() => {
                if (isPreviewing) {
                  ride.stop();
                } else {
                  ride.startReplay(
                    playCandidates.map((t: any) => ({
                      mbid: t.mbid,
                      title: t.title || "Unknown Track",
                      artist: t.artist || "Unknown Artist",
                      artworkUrl: data.coverArt ?? null,
                      links: [],
                    })),
                    data.title,
                    { previewOnly: true, context: `collection:${slug}` }
                  );
                }
              }}
              className="inline-flex h-11 items-center justify-center gap-2.5 rounded-full bg-foreground px-7 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-background shadow-sm transition-all hover:bg-foreground/90 hover:scale-[1.02] hover:shadow active:scale-95"
            >
              {isPreviewing ? (
                <>
                  <Square className="h-4 w-4 fill-current opacity-80" /> Stop Preview
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current opacity-80" /> Preview {data.kind}
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {data.kind === "album" && credits.data && (
        <div className="mt-12 rounded-2xl bg-card/30 p-5 ring-1 ring-border/30" aria-label="Album credits" data-testid="public-album-credits">
          <CreditSummary payload={credits.data} returnTo={`/collection/${slug}`} />
          <AlbumCreditsDisclosure payload={credits.data} returnTo={`/collection/${slug}`} />
        </div>
      )}

      {data.kind === "album" && credits.isLoading && (
        <section className="album-credits mt-12" aria-label="Album credits" data-testid="public-album-credits">
          <p className="text-[13px] text-muted-foreground/60" role="status">Loading verified credits…</p>
        </section>
      )}

      <section className="mt-12 space-y-12" data-testid="collection-entries">
        {data.entries.length > 0 && (
          <div>
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title="Tracklist"
              hint={`${data.entries.length} track${data.entries.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {data.entries.map((entry, index: number) => {
                const e = entry as any;
                const mbid = e.mbid;
                const isKept = mbid ? keptMbids.has(mbid) : false;
                const isPlaying = isPreviewing && ride.current?.mbid === mbid;
                const spotifyUrl = e.spotifyTrackUrl ?? (e.spotifyTrackId ? `https://open.spotify.com/track/${e.spotifyTrackId}` : undefined);
                
                return (
                  <TrackRow
                    key={`${index}-${mbid ?? e.title ?? "gap"}`}
                    track={{
                      mbid: mbid,
                      title: e.title ?? "Unavailable entry",
                      artist: e.artist ?? "Unknown artist",
                      artworkUrl: data.coverArt ?? null,
                      unavailableReason: e.identity === "unavailable" ? "Unavailable" : undefined,
                      spotifyTrackUrl: spotifyUrl,
                    }}
                    index={index + 1}
                    isKept={isKept}
                    isPlaying={isPlaying}
                    returnContext={`/collection/${slug}`}
                    demoSurface={false}
                  />
                );
              })}
            </ul>
          </div>
        )}
        {data.entries.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 bg-card/10 p-12 text-center">
            <Disc3 className="mb-4 h-8 w-8 text-muted-foreground/30" />
            <p className="text-[15px] font-medium text-foreground/80">No tracks found</p>
            <p className="mt-1 text-sm text-muted-foreground/60">This collection has no entries.</p>
          </div>
        )}
      </section>

      <p className="mt-10 pt-6 border-t border-border/50 text-[11px] uppercase tracking-wider text-muted-foreground/40">
        Provenance: public Lore collection · ordered as curated.
      </p>
    </main>
  );
}