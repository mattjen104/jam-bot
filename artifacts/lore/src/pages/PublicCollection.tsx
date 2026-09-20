import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { Download } from "lucide-react";
import {
  ApiError,
  useGetCollection,
  useGetCollectionJspf,
  useGetCollectionPlayerCapability,
} from "@workspace/api-client-react";
import { AlbumCreditsDisclosure, CreditSummary } from "../components/CreditDisclosure";
import { usePublicCollectionCredits } from "../hooks/usePublicCollectionCredits";

function PlayerAdapter({ slug }: { slug: string }) {
  const { data, isError } = useGetCollectionPlayerCapability(slug);
  if (isError || !data) return <p className="text-sm text-muted-foreground">Playback isn't available in this browser; use the links below.</p>;
  const capability = data as { available?: boolean; reason?: string };
  return <p className="text-sm text-muted-foreground">{capability.reason ?? "A compatible player is not available yet."}</p>;
}

export default function PublicCollection() {
  const { slug = "" } = useParams();
  const { data, isLoading, isError, error } = useGetCollection(slug);
  const jspf = useGetCollectionJspf(slug);
  const credits = usePublicCollectionCredits(slug, data?.kind === "album");
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
  if (isLoading) return <div className="mx-auto max-w-2xl px-4 py-10 text-muted-foreground">Loading collection…</div>;
  if (isError || !data) {
    const withdrawn = error instanceof ApiError && error.status === 410;
    return <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">← Lore</Link>
      <h1 className="mt-8 font-serif text-4xl text-foreground">{withdrawn ? "Collection withdrawn" : "Collection not found"}</h1>
      <p className="mt-3 text-muted-foreground">{withdrawn ? "The curator withdrew this collection. This link is being kept so it cannot be reassigned." : "This collection could not be found."}</p>
    </main>;
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
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${data.slug}.jspf`; a.click(); URL.revokeObjectURL(url);
  };
  return <main className="mx-auto max-w-2xl px-4 py-8 pb-24">
    <Link href="/" className="font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-primary">← Lore</Link>
    <header className="mt-8">
      {data.coverArt ? <img src={data.coverArt} alt="" className="mb-5 aspect-square w-48 rounded-xl object-cover" /> : <div className="mb-5 flex h-32 w-32 items-center justify-center rounded-xl bg-muted font-mono text-xs text-muted-foreground">No cover</div>}
      <p className="font-mono text-xs uppercase tracking-[.2em] text-primary">{data.kind}</p>
      <h1 className="mt-2 font-serif text-4xl text-foreground">{data.title}</h1>
      {data.description && <p className="mt-3 text-muted-foreground">{data.description}</p>}
      {data.curatorNotes && <p className="mt-3 border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">{data.curatorNotes}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={download} disabled={!jspf.data} className="inline-flex items-center gap-2 rounded-full border border-card-border px-3 py-2 font-mono text-xs uppercase disabled:opacity-40"><Download className="h-3 w-3" /> JSPF</button>
        {albumLinks.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-card-border px-3 py-2 font-mono text-xs uppercase text-primary"
          >
            {link.label}
          </a>
        ))}
      </div>
      {bandcampUnavailable && (
        <p className="mt-2 text-xs text-muted-foreground">No official Fleetwood Mac release of this album is available on Bandcamp.</p>
      )}
    </header>
    <section className="mt-8"><PlayerAdapter slug={slug} />
      <ol className="mt-4 space-y-2">{data.entries.map((entry, index: number) => {
        const e = entry as { identity?: string; title?: string; artist?: string; mbid?: string; spotifyTrackUrl?: string; spotifyTrackId?: string; unavailableReason?: string; provenance?: { source?: string } };
        const spotify = e.spotifyTrackUrl ?? (e.spotifyTrackId ? `https://open.spotify.com/track/${e.spotifyTrackId}` : undefined);
        return <li key={`${index}-${e.mbid ?? e.title ?? "gap"}`} className="rounded-xl border border-card-border bg-card p-3"><div className="flex gap-3"><span className="w-6 font-mono text-xs text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{e.title ?? "Unavailable entry"}</span><span className="block truncate text-xs text-muted-foreground">{e.artist ?? e.unavailableReason ?? "Unknown artist"}</span>{e.provenance?.source && <span className="mt-1 block text-xs text-muted-foreground">Found through {e.provenance.source}</span>}</span>{e.identity === "unavailable" ? <span className="text-xs text-muted-foreground">Unavailable</span> : spotify ? <a className="text-xs text-primary underline" href={spotify} target="_blank" rel="noreferrer">Open in Spotify</a> : <span className="text-xs text-muted-foreground">No Spotify link</span>}</div></li>;
      })}</ol>
    </section>
    {data.kind === "album" && (
      <section className="album-credits mt-8" aria-label="Album credits" data-testid="public-album-credits">
        {credits.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading verified credits…</p>
        ) : credits.data ? (
          <>
            <CreditSummary payload={credits.data} returnTo={`/collection/${slug}`} />
            <AlbumCreditsDisclosure payload={credits.data} returnTo={`/collection/${slug}`} />
          </>
        ) : null}
      </section>
    )}
    <p className="mt-6 text-xs text-muted-foreground">Provenance: public Lore collection · ordered as curated.</p>
  </main>;
}