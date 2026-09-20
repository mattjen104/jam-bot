import { Link, useParams, useSearch } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import {
  getGetAlbumQueryKey,
  useGetAlbum,
  getGetCollectionQueryKey,
  useGetCollection,
  getGetCollectionJspfQueryKey,
  useGetCollectionJspf,
  getGetCollectionPlayerCapabilityQueryKey,
  useGetCollectionPlayerCapability,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Disc3, Music4, Play, Square, Download, ExternalLink } from "lucide-react";
import { AlbumListProvenance } from "../components/ListProvenance";
import { timeAgo } from "../lib/format";
import { useEffect, useRef } from "react";
import { useAppConfig, useMyLibraryMbids } from "../lib/meHooks";
import { useAlbumCredits } from "../hooks/useAlbumCredits";
import { usePublicCollectionCredits } from "../hooks/usePublicCollectionCredits";
import { KeptCreditSurface, CreditSummary, AlbumCreditsDisclosure } from "../components/CreditDisclosure";
import { isKeptAlbum, normalizeCreditPayload } from "../lib/creditPayload";
import { PublishCollectionButton, collectionSlugSuggestion } from "../components/PublishCollectionButton";
import { usePlayer } from "../player/PlayerProvider";
import {
  buildLibraryEntityUrl,
  buildLibraryReturnHref,
  readLibraryReturnContext,
} from "../lib/libraryFocusedNavigation";
import {
  buildCanonicalAlbumJspf,
  type ProviderAlbumLinks,
} from "../lib/albumJspf";

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
          className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 font-mono text-[11px] font-semibold uppercase tracking-wider text-background transition-colors hover:bg-foreground/90"
          data-testid={`provider-link-${link.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          Listen on {link.label}
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

export function AlbumBackdrop({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div 
        className="absolute -top-[20%] -left-[10%] h-[70vh] w-[120%] opacity-20 blur-[120px] saturate-150 transition-opacity duration-1000 dark:opacity-[0.15]"
        style={{ backgroundImage: `url(${proxyArtUrl(url) ?? url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background via-background/80" />
    </div>
  );
}

export function SectionHeading({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b border-border/40 pb-2">
      <span className="text-primary">{icon}</span>
      <span className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground/70">
        {title}
      </span>
      {hint && (
        <span className="ml-auto font-mono text-[13px] text-muted-foreground/50">
          {hint}
        </span>
      )}
    </div>
  );
}

export type AlbumTrackRow = {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  spinCount?: number;
  lastSpunAt?: string | null;
  unavailableReason?: string;
  spotifyTrackUrl?: string;
};

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/jspf+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TrackRow({
  track,
  index,
  isKept,
  isPlaying,
  isAnchor,
  showPosition = true,
  returnContext,
  demoSurface,
}: {
  track: AlbumTrackRow;
  index: number;
  isKept: boolean;
  isPlaying: boolean;
  isAnchor?: boolean;
  showPosition?: boolean;
  returnContext: string;
  demoSurface: boolean;
}) {
  const spunOnLore = track.spinCount ? track.spinCount > 0 : false;
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (isAnchor && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isAnchor]);

  let statusBadge = null;
  if (isPlaying) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        Previewing
      </span>
    );
  } else if (track.unavailableReason) {
    statusBadge = (
      <span className="inline-flex items-center rounded-full border border-border/50 bg-card/30 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Unavailable
      </span>
    );
  } else if (isKept) {
    statusBadge = (
      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
        Kept
      </span>
    );
  }

  return (
    <li ref={rowRef}>
      <Link
        href={track.mbid ? buildLibraryEntityUrl(
          `/song/${encodeURIComponent(track.mbid)}`,
          returnContext,
          { demoSurface },
        ) : "#"}
        className={`group flex items-center gap-3 rounded-xl border p-2 transition-all duration-200 sm:gap-4 sm:p-2.5 hover:scale-[1.01] hover:shadow-md ${
          isKept
            ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
            : "border-transparent bg-card/40 hover:border-border/60 hover:bg-card/80"
        } ${!spunOnLore && track.spinCount !== undefined ? "opacity-75 hover:opacity-100" : ""}`}
        data-testid="album-track"
        data-track-mbid={track.mbid}
      >
        <div className="flex h-10 w-8 shrink-0 items-center justify-center font-mono text-[13px] text-muted-foreground/40 group-hover:text-primary/70 transition-colors" aria-hidden={!showPosition}>
          {showPosition ? index : null}
        </div>
        <div
          className={`h-11 w-11 shrink-0 overflow-hidden rounded-[5px] bg-muted/50 transition-all duration-300 ${
            isPlaying ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-105 shadow-lg shadow-primary/20" : "group-hover:shadow-md"
          }`}
        >
          {track.artworkUrl ? (
            <img
              src={proxyArtUrl(track.artworkUrl)!}
              alt={track.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music4 className="h-4 w-4 text-muted-foreground/30" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex items-center gap-2.5">
            <p className="truncate text-[15px] font-medium text-foreground/90 transition-colors group-hover:text-foreground">
              {track.title}
            </p>
            {statusBadge}
          </div>
          {track.spinCount !== undefined ? (
            spunOnLore ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground/80">
                <span className="text-primary/80">
                  {track.spinCount} spin{track.spinCount === 1 ? "" : "s"}
                </span>
                {track.lastSpunAt && (
                  <span className="ml-1.5 text-muted-foreground/50">
                    · last {timeAgo(track.lastSpunAt)}
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] text-muted-foreground/40">Not yet heard on Lore</p>
            )
          ) : (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 truncate text-[13px] text-muted-foreground/60">
              {track.artist}
              {track.spotifyTrackUrl && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-secondary/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
                  title="Spotify link is available from the album provider actions"
                >
                  Spotify
                </span>
              )}
            </p>
          )}
        </div>
        <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/40 bg-background/50 opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:bg-primary/10 group-hover:border-primary/30">
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
      </Link>
    </li>
  );
}

export function AlbumSkeleton() {
  return (
    <div className="mt-6 animate-pulse space-y-4">
      <div className="h-3 w-24 rounded bg-muted/50" />
      <div className="h-10 w-1/2 rounded bg-muted/50" />
      <div className="h-4 w-1/3 rounded bg-muted/50" />
      <div className="mt-8 space-y-2">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-[68px] rounded-xl bg-muted/30" />
        ))}
      </div>
    </div>
  );
}

export default function Album() {
  const params = useParams();
  const search = useSearch();
  const releaseGroupMbid = params.releaseGroupMbid ?? "";

  const searchParams = new URLSearchParams(search);
  const requestedTilt = Number(searchParams.get("tilt"));
  const trackAnchor = searchParams.get("track");
  const collectionSlug = searchParams.get("collection") ?? null;
  const { data: appConfig } = useAppConfig();
  const { data: libraryIdentity } = useMyLibraryMbids();
  const demoSurface = appConfig?.demoSurface === true;
  const returnContext = readLibraryReturnContext(search, { demoSurface });
  const returnHref = buildLibraryReturnHref(returnContext);

  const openingTilt =
    Number.isFinite(requestedTilt) && Math.abs(requestedTilt) >= 5 && Math.abs(requestedTilt) <= 12
      ? requestedTilt
      : 0;

  const { data: album, isLoading: isAlbumLoading, isError: isAlbumError } = useGetAlbum(releaseGroupMbid, { 
    query: { enabled: true, queryKey: getGetAlbumQueryKey(releaseGroupMbid) } 
  });
  
  const { data: collection, isLoading: isCollectionLoading, isError: isCollectionError } = useGetCollection(collectionSlug ?? "", { 
    query: { enabled: !!collectionSlug, queryKey: getGetCollectionQueryKey(collectionSlug ?? "") } 
  });
  const { data: collectionJspf } = useGetCollectionJspf(collectionSlug ?? "", { 
    query: { enabled: !!collectionSlug, queryKey: getGetCollectionJspfQueryKey(collectionSlug ?? "") } 
  });
  const { data: collectionPlayerCapability } = useGetCollectionPlayerCapability(collectionSlug ?? "", {
    query: {
      enabled: Boolean(collectionSlug),
      queryKey: getGetCollectionPlayerCapabilityQueryKey(collectionSlug ?? ""),
    },
  });
  const { data: collectionCredits } = usePublicCollectionCredits(collectionSlug ?? "", !!collectionSlug);

  const { data: libraryMbids } = useMyLibraryMbids();
  const isKeptAlbumInLibrary = isKeptAlbum(libraryMbids, releaseGroupMbid);
  const { data: albumCredits } = useAlbumCredits(releaseGroupMbid, !collectionSlug && isKeptAlbumInLibrary);
  
  const albumKnowledge = (album as typeof album & { knowledge?: unknown } | undefined)?.knowledge;
  const knowledgeCredits = albumKnowledge ? normalizeCreditPayload(albumKnowledge) : undefined;
  const credits = collectionSlug ? collectionCredits : (albumCredits ?? knowledgeCredits);
  const { ride } = usePlayer();

  const keptMbids = new Set(libraryIdentity?.mbids ?? []);

  const isLoading = isAlbumLoading || (!!collectionSlug && isCollectionLoading);
  const isError = isAlbumError || (!!collectionSlug && isCollectionError);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-24">
        <div className="mt-6">
          <Link
            href={returnHref}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {returnHref.startsWith("/library") ? "Back to the Library" : "Back to the dial"}
          </Link>
        </div>
        <AlbumSkeleton />
      </div>
    );
  }

  if (isError || !album) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-24">
        <div className="mt-6">
          <Link
            href={returnHref}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {returnHref.startsWith("/library") ? "Back to the Library" : "Back to the dial"}
          </Link>
        </div>
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-destructive-border bg-destructive/5 p-12 text-center">
          <Disc3 className="mb-4 h-8 w-8 text-destructive/40" />
          <p className="text-base text-destructive-foreground">Couldn't load this album.</p>
          <p className="mt-1 text-sm text-destructive-foreground/70">Please refresh and try again.</p>
        </div>
      </div>
    );
  }

  const heardTracks = album.tracks.filter((t) => t.spinCount > 0);
  const totalSpins = heardTracks.reduce((s, t) => s + t.spinCount, 0);
  const artistMbid = album.tracks[0]?.artistMbid ?? null;
  const artistName = album.tracks[0]?.artist ?? null;
  const albumArtworkUrl = album.tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null;
  
  const tracks = collection ? collection.entries.map((entry) => {
    const item = entry as {
      identity?: string;
      mbid?: string;
      title?: string;
      artist?: string;
      spotifyTrackId?: string;
      spotifyTrackUrl?: string;
    };
    return {
    mbid: item.mbid ?? "",
    title: item.title ?? "Unavailable entry",
    artist: item.artist ?? "Unknown artist",
    artworkUrl: albumArtworkUrl,
    unavailableReason: item.identity === "unavailable" ? "Unavailable" : undefined,
    spotifyTrackUrl: item.spotifyTrackUrl ?? (item.spotifyTrackId ? `https://open.spotify.com/track/${item.spotifyTrackId}` : undefined),
    };
  }) : album.tracks;

  const confirmedTracks = tracks.filter((track) => Boolean(track.mbid));

  const isPreviewingAlbum =
    ride.active && ride.listenContext === (collection ? `collection:${collectionSlug}` : `album:${releaseGroupMbid}`);
  const playerCapability = collectionPlayerCapability as {
    available?: boolean;
    reason?: string;
  } | undefined;
  const previewAvailable = collectionSlug
    ? playerCapability?.available === true
    : false;
  const previewUnavailableReason = collectionSlug
    ? playerCapability?.reason
    : "Lore has no verified in-app preview capability for this album.";

  const spotifyAlbumId = collection?.entries
    .map((entry) => (entry as { spotifyAlbumId?: string }).spotifyAlbumId)
    .find(Boolean);
  const collectionProviderAlbumLinks = collection?.entries.reduce<ProviderAlbumLinks>((links, entry) => ({
    ...links,
    ...((entry as { providerAlbumLinks?: ProviderAlbumLinks }).providerAlbumLinks ?? {}),
  }), {});
  const knowledgeProviderAlbumLinks = (albumKnowledge as { providerAlbumLinks?: ProviderAlbumLinks } | undefined)
    ?.providerAlbumLinks;
  const providerAlbumLinks = {
    ...knowledgeProviderAlbumLinks,
    ...collectionProviderAlbumLinks,
  };
  const bandcampUnavailable = collection?.entries.some((entry) =>
    (entry as { providerAvailability?: { bandcamp?: string } }).providerAvailability?.bandcamp === "unavailable",
  );
  
  const albumLinks = [
    { label: "Spotify", url: providerAlbumLinks?.spotify ?? (spotifyAlbumId ? `https://open.spotify.com/album/${spotifyAlbumId}` : undefined) },
    { label: "Apple Music", url: providerAlbumLinks?.appleMusic },
    { label: "Qobuz", url: providerAlbumLinks?.qobuz },
    { label: "Bandcamp", url: providerAlbumLinks?.bandcamp },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url));

  const canonicalJspf = buildCanonicalAlbumJspf({
    releaseGroupMbid,
    title: album.title,
    artist: artistName,
    artworkUrl: albumArtworkUrl,
    tracks: confirmedTracks,
    providerAlbumLinks,
  });

  const downloadJspf = () => {
    downloadJson(collectionJspf ?? canonicalJspf, `${collection?.slug ?? collectionSlug ?? album.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jspf`);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24">
      <AlbumBackdrop url={albumArtworkUrl} />
      
      <div className="mt-6">
        <Link
          href={returnHref}
          className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-primary"
          data-testid="back-to-dial"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {returnHref.startsWith("/library") ? "Back to the Library" : "Back to the dial"}
        </Link>
      </div>

      <header
        className="album-open mt-10 space-y-2"
        style={{ "--album-opening-tilt": `${openingTilt}deg` } as React.CSSProperties}
        data-opening-tilt={openingTilt}
      >
        {albumArtworkUrl && (
          <img
            src={proxyArtUrl(albumArtworkUrl) ?? albumArtworkUrl}
            alt=""
            className="album-open__cover ring-1 ring-border/10"
          />
        )}
        <p className="font-mono text-[12px] font-medium uppercase tracking-[0.25em] text-primary/90">
          {album.primaryType ?? "Album"}
        </p>
        <h1
          className="font-serif text-[2.75rem] font-normal leading-none tracking-tight text-foreground sm:text-[3.5rem]"
          data-testid="album-title"
        >
          {album.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[1.1rem] text-muted-foreground/90">
          {artistMbid ? (
            <Link
              href={buildLibraryEntityUrl(
                `/artist/${encodeURIComponent(artistMbid)}`,
                returnHref,
                { demoSurface },
              )}
              className="font-medium text-foreground transition-colors hover:text-primary hover:underline hover:underline-offset-4"
              data-testid="album-artist-link"
            >
              {artistName}
            </Link>
          ) : (
            artistName && <span className="font-medium text-foreground">{artistName}</span>
          )}
          {album.releaseYear != null && (
            <>
              {artistName && <span className="text-muted-foreground/30">·</span>}
              <span>{album.releaseYear}</span>
            </>
          )}
        </div>
        {totalSpins > 0 && (
          <p className="pt-2 text-[15px] text-muted-foreground/70">
            <strong className="font-medium text-foreground/80">{totalSpins}</strong> spin{totalSpins === 1 ? "" : "s"} from <strong className="font-medium text-foreground/80">{heardTracks.length}</strong> track
            {heardTracks.length === 1 ? "" : "s"} on Lore
          </p>
        )}
        
        {collection && (
          <>
            {collection.description && <p className="mt-3 text-lg text-muted-foreground/90">{collection.description}</p>}
            {collection.curatorNotes && <p className="mt-4 border-l-2 border-primary/40 pl-4 text-base text-muted-foreground italic">{collection.curatorNotes}</p>}
            
            {bandcampUnavailable && (
              <p className="mt-3 text-xs text-muted-foreground/60">No official release of this album is available on Bandcamp.</p>
            )}
          </>
        )}

        {albumLinks.length > 0 && (
          <div className="mt-5" aria-label="Listen to this album">
            <ProviderLinks links={albumLinks} />
          </div>
        )}

        <div className="pt-1">
          <PublishCollectionButton
            kind="album"
            slug={collectionSlugSuggestion(`${album.title}-${artistName ?? ""}`, releaseGroupMbid.slice(0, 8))}
            title={album.title}
            description={artistName ? `${album.title} by ${artistName}` : album.title}
            curatorNotes={null}
            coverArt={albumArtworkUrl}
            entries={confirmedTracks.map((track) => ({
              identity: "mbid",
              title: track.title,
              artist: track.artist,
              mbid: track.mbid,
              album: album.title,
              ...("spinCount" in track && typeof track.spinCount === "number" && track.spinCount > 0
                ? { provenance: { source: "Lore radio discovery", confidence: "confirmed" } }
                : {}),
            }))}
          />
        </div>

        {confirmedTracks.length > 0 && (
          <div className="mt-8 pt-6 flex flex-wrap items-center gap-4 border-t border-border/50">
            <button type="button" onClick={downloadJspf} data-testid="download-jspf" className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 font-mono text-[12px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground">
              <Download className="h-4 w-4" /> Export JSPF
            </button>
            {previewAvailable && <button
              type="button"
              data-testid="preview-album"
              onClick={() => {
                if (isPreviewingAlbum) {
                  ride.stop();
                } else {
                  ride.startReplay(
                    confirmedTracks.map((t) => ({
                      mbid: t.mbid,
                      title: t.title,
                      artist: t.artist,
                      artworkUrl: t.artworkUrl ?? albumArtworkUrl,
                      links: [],
                    })),
                    collection ? collection.title : album.title,
                    { previewOnly: true, context: collection ? `collection:${collectionSlug}` : `album:${releaseGroupMbid}` }
                  );
                }
              }}
              className="inline-flex h-11 items-center justify-center gap-2.5 rounded-full bg-foreground px-7 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-background shadow-sm transition-all hover:bg-foreground/90 hover:scale-[1.02] hover:shadow active:scale-95"
            >
              {isPreviewingAlbum ? (
                <>
                  <Square className="h-4 w-4 fill-current opacity-80" />
                  Stop Preview
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current opacity-80" />
                  Preview {collection ? collection.kind : "Album"}
                </>
              )}
            </button>}
            {!previewAvailable && previewUnavailableReason && (
              <p className="text-[13px] text-muted-foreground/60" data-testid="album-preview-unavailable">
                {previewUnavailableReason}
              </p>
            )}
          </div>
        )}
      </header>

      {credits && (
        <div className="mt-12 rounded-2xl bg-card/30 p-5 ring-1 ring-border/30">
          {collectionSlug ? (
            <section className="album-credits" aria-label="Album credits" data-testid="public-album-credits">
              <CreditSummary payload={credits} returnTo={returnHref} />
              <AlbumCreditsDisclosure payload={credits} returnTo={returnHref} />
            </section>
          ) : isKeptAlbumInLibrary && albumCredits ? (
            <KeptCreditSurface
              kept={isKeptAlbumInLibrary}
              payload={albumCredits}
              returnTo={returnHref}
              label="Album credits"
              testId="album-credits"
              album
            />
          ) : (
            <section className="album-credits" aria-label="Album knowledge" data-testid="public-album-knowledge">
              <CreditSummary payload={credits} returnTo={returnHref} />
              <AlbumCreditsDisclosure payload={credits} returnTo={returnHref} />
            </section>
          )}
        </div>
      )}

      <div className="mt-12 space-y-12">
        {tracks.length > 0 && (
          <section data-testid="album-all-tracks">
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title={collection ? "Tracklist" : "Known tracks"}
              hint={collection
                ? `${tracks.length} track${tracks.length === 1 ? "" : "s"} · curated order`
                : `${tracks.length} track${tracks.length === 1 ? "" : "s"} · release order not yet verified`}
            />
            <ul className="flex flex-col gap-1.5 pt-1">
              {tracks.map((track, i) => {
                const isKept = keptMbids.has(track.mbid);
                const isPlaying = isPreviewingAlbum && ride.current?.mbid === track.mbid;
                return (
                  <TrackRow
                    key={track.mbid}
                    track={track}
                    index={i + 1}
                    isKept={isKept}
                    isPlaying={isPlaying}
                    isAnchor={track.mbid === trackAnchor}
                    showPosition={Boolean(collection)}
                    returnContext={returnHref}
                    demoSurface={demoSurface}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 bg-card/10 p-12 text-center">
            <Disc3 className="mb-4 h-8 w-8 text-muted-foreground/30" />
            <p className="text-[15px] font-medium text-foreground/80">No tracks found</p>
            <p className="mt-1 text-sm text-muted-foreground/60">This album's tracklist hasn't been mapped yet.</p>
          </div>
        )}

        <AlbumListProvenance releaseGroupMbid={releaseGroupMbid} />
      </div>
    </div>
  );
}
