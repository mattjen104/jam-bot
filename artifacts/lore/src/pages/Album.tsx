import { Link, useParams, useSearch } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import {
  useGetAlbum,
  type AlbumResult,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Disc3, Music4, Play, Square, Loader2 } from "lucide-react";
import { AlbumListProvenance } from "../components/ListProvenance";
import { timeAgo } from "../lib/format";
import { useInlinePreview } from "../player/inlinePreview";
import { useEffect, useRef, useState } from "react";
import { useAppConfig, useMyLibraryMbids } from "../lib/meHooks";
import { useAlbumCredits } from "../hooks/useAlbumCredits";
import { KeptCreditSurface } from "../components/CreditDisclosure";
import { isKeptAlbum } from "../lib/creditPayload";
import { PublishCollectionButton, collectionSlugSuggestion } from "../components/PublishCollectionButton";
import {
  buildLibraryEntityUrl,
  buildLibraryReturnHref,
  readLibraryReturnContext,
} from "../lib/libraryFocusedNavigation";

function SectionHeading({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <span className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground/70">
        {title}
      </span>
      {hint && (
        <span className="ml-auto font-mono text-[13px] text-muted-foreground/60">
          {hint}
        </span>
      )}
    </div>
  );
}

type AlbumTrackRow = AlbumResult["tracks"][number];

function TrackRow({
  track,
  index,
  isKept,
  isPlaying,
  isLoading,
  isUnavailable,
  isAnchor,
  returnContext,
  demoSurface,
}: {
  track: AlbumTrackRow;
  index: number;
  isKept: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isUnavailable: boolean;
  isAnchor: boolean;
  returnContext: string;
  demoSurface: boolean;
}) {
  const spunOnLore = track.spinCount > 0;
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (isAnchor && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isAnchor]);

  let statusBadge = null;
  if (isPlaying) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        Previewing
      </span>
    );
  } else if (isLoading) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading
      </span>
    );
  } else if (isUnavailable) {
    statusBadge = (
      <span className="inline-flex items-center rounded-full border border-border bg-card/50 px-2 py-0.5 text-xs font-medium text-muted-foreground/60">
        Unavailable
      </span>
    );
  } else if (isKept) {
    statusBadge = (
      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        Kept
      </span>
    );
  }

  return (
    <li ref={rowRef}>
      <Link
        href={buildLibraryEntityUrl(
          `/song/${encodeURIComponent(track.mbid)}`,
          returnContext,
          { demoSurface },
        )}
        className={`group flex items-center gap-3 rounded-xl border p-2.5 transition-colors sm:gap-4 sm:p-3 hover:bg-card/80 ${
          isKept
            ? "border-primary/50 bg-primary/5"
            : "border-card-border bg-card hover:border-primary/30"
        } ${!spunOnLore ? "opacity-75 hover:opacity-100" : ""}`}
        data-testid="album-track"
        data-track-mbid={track.mbid}
      >
        <div className="flex h-12 w-8 shrink-0 items-center justify-center font-mono text-sm text-muted-foreground/50">
          {index}
        </div>
        <div
          className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted transition-opacity ${
            isPlaying ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
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
              <Music4 className="h-5 w-5 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-normal text-foreground group-hover:text-primary">
              {track.title}
            </p>
            {statusBadge}
          </div>
          {spunOnLore ? (
            <p className="text-sm text-muted-foreground">
              <span className="text-primary">
                {track.spinCount} spin{track.spinCount === 1 ? "" : "s"} on Lore
              </span>
              {track.lastSpunAt && (
                <span className="ml-2 text-muted-foreground/60">
                  · last {timeAgo(track.lastSpunAt)}
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/50">Not yet heard on Lore</p>
          )}
        </div>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/50 opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowRight className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
      </Link>
    </li>
  );
}

function AlbumSkeleton() {
  return (
    <div className="mt-6 animate-pulse space-y-4">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="h-10 w-1/2 rounded bg-muted" />
      <div className="h-4 w-1/3 rounded bg-muted" />
      <div className="mt-6 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-muted" />
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
  const { data: appConfig } = useAppConfig();
  const { data: libraryIdentity } = useMyLibraryMbids();
  const demoSurface = appConfig?.demoSurface === true;
  const returnContext = readLibraryReturnContext(search, { demoSurface });
  const returnHref = buildLibraryReturnHref(returnContext);

  const openingTilt =
    Number.isFinite(requestedTilt) && Math.abs(requestedTilt) >= 5 && Math.abs(requestedTilt) <= 12
      ? requestedTilt
      : 0;

  const { data: album, isLoading, isError } = useGetAlbum(releaseGroupMbid);
  const { data: libraryMbids } = useMyLibraryMbids();
  const isKeptAlbumInLibrary = isKeptAlbum(libraryMbids, releaseGroupMbid);
  const { data: credits } = useAlbumCredits(releaseGroupMbid, isKeptAlbumInLibrary);
  const { playingMbid, loadingMbid, toggle, stop } = useInlinePreview();

  const [sequenceIndex, setSequenceIndex] = useState<number | null>(null);
  const [unavailableMbids, setUnavailableMbids] = useState<Set<string>>(new Set());
  const lastPlayedMbidRef = useRef<string | null>(null);
  const sequenceRunRef = useRef(0);
  const sequenceRequestRef = useRef<string | null>(null);
  const keptMbids = new Set(libraryIdentity?.mbids ?? []);

  useEffect(() => () => {
    sequenceRunRef.current += 1;
    stop();
  }, [stop]);

  useEffect(() => {
    if (!album) return undefined;
    if (sequenceIndex === null) {
      lastPlayedMbidRef.current = null;
      return undefined;
    }

    const currentTrack = album.tracks[sequenceIndex];
    if (!currentTrack) return undefined;

    if (playingMbid === currentTrack.mbid) {
      lastPlayedMbidRef.current = currentTrack.mbid;
      return undefined;
    } else if (!playingMbid && !loadingMbid) {
      if (lastPlayedMbidRef.current === currentTrack.mbid) {
        lastPlayedMbidRef.current = null;
        setSequenceIndex(sequenceIndex + 1 < album.tracks.length ? sequenceIndex + 1 : null);
        return undefined;
      } else {
        const run = sequenceRunRef.current;
        const requestKey = `${run}:${sequenceIndex}`;
        if (sequenceRequestRef.current === requestKey) return undefined;
        sequenceRequestRef.current = requestKey;
        toggle(currentTrack.mbid).then((status) => {
          if (run !== sequenceRunRef.current) return;
          if (sequenceRequestRef.current === requestKey) {
            sequenceRequestRef.current = null;
          }
          if (status === "unavailable") {
            setUnavailableMbids((prev) => {
              const next = new Set(prev);
              next.add(currentTrack.mbid);
              return next;
            });
            setSequenceIndex(sequenceIndex + 1 < album.tracks.length ? sequenceIndex + 1 : null);
          } else if (status === "stopped") {
            setSequenceIndex(null);
          }
        });
        return undefined;
      }
    } else if (playingMbid && playingMbid !== currentTrack.mbid) {
      sequenceRunRef.current += 1;
      sequenceRequestRef.current = null;
      lastPlayedMbidRef.current = null;
      queueMicrotask(() => setSequenceIndex(null));
      return undefined;
    }
    return undefined;
  }, [sequenceIndex, playingMbid, loadingMbid, album, toggle]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-24">
        <div className="mt-6">
          <Link
            href={returnHref}
            className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            {returnHref.startsWith("/library") ? "Back to the Library" : "Back to the dial"}
          </Link>
        </div>
        <AlbumSkeleton />
      </div>
    );
  }

  if (isError || !album) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-24">
        <div className="mt-6">
          <Link
            href={returnHref}
            className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            {returnHref.startsWith("/library") ? "Back to the Library" : "Back to the dial"}
          </Link>
        </div>
        <div className="mt-10 rounded-2xl border border-destructive-border bg-destructive/10 p-6 text-base text-destructive-foreground">
          Couldn't load this album. Please refresh.
        </div>
      </div>
    );
  }

  const heardTracks = album.tracks.filter((t) => t.spinCount > 0);
  const totalSpins = heardTracks.reduce((s, t) => s + t.spinCount, 0);
  const artistMbid = album.tracks[0]?.artistMbid ?? null;
  const artistName = album.tracks[0]?.artist ?? null;
  const albumArtworkUrl = album.tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null;
  const confirmedTracks = album.tracks.filter((track) => Boolean(track.mbid));

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <div className="mt-6">
        <Link
          href={returnHref}
          className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary"
          data-testid="back-to-dial"
        >
          <ArrowLeft className="h-3 w-3" />
          {returnHref.startsWith("/library") ? "Back to the Library" : "Back to the dial"}
        </Link>
      </div>

      <header
        className="album-open mt-8 space-y-1"
        style={{ "--album-opening-tilt": `${openingTilt}deg` } as React.CSSProperties}
        data-opening-tilt={openingTilt}
      >
        {albumArtworkUrl && (
          <img
            src={proxyArtUrl(albumArtworkUrl) ?? albumArtworkUrl}
            alt=""
            className="album-open__cover"
          />
        )}
        <p className="font-mono text-[13px] uppercase tracking-[0.2em] text-primary">
          {album.primaryType ?? "Album"}
        </p>
        <h1
          className="font-serif text-4xl font-normal leading-tight text-foreground sm:text-5xl"
          data-testid="album-title"
        >
          {album.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg text-muted-foreground">
          {artistMbid ? (
            <Link
              href={buildLibraryEntityUrl(
                `/artist/${encodeURIComponent(artistMbid)}`,
                returnHref,
                { demoSurface },
              )}
              className="hover:text-primary hover:underline"
              data-testid="album-artist-link"
            >
              {artistName}
            </Link>
          ) : (
            artistName && <span>{artistName}</span>
          )}
          {album.releaseYear != null && (
            <>
              {artistName && <span className="text-muted-foreground/40">·</span>}
              <span>{album.releaseYear}</span>
            </>
          )}
        </div>
        {totalSpins > 0 && (
          <p className="pt-1 text-base text-muted-foreground">
            {totalSpins} spin{totalSpins === 1 ? "" : "s"} from {heardTracks.length} track
            {heardTracks.length === 1 ? "" : "s"} on Lore
          </p>
        )}
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
            ...(track.spinCount > 0
              ? { provenance: { source: "Lore radio discovery", confidence: "confirmed" } }
              : {}),
          }))}
        />

        {album.tracks.length > 0 && (
          <div className="mt-6 pt-4 flex flex-wrap items-center gap-4 border-t border-border/50">
            <button
              type="button"
              onClick={() => {
                if (sequenceIndex !== null) {
                  sequenceRunRef.current += 1;
                  sequenceRequestRef.current = null;
                  setSequenceIndex(null);
                  stop();
                } else {
                  sequenceRunRef.current += 1;
                  sequenceRequestRef.current = null;
                  setSequenceIndex(0);
                  setUnavailableMbids(new Set());
                }
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-6 font-mono text-[13px] uppercase tracking-[0.1em] text-background transition-transform active:scale-95"
            >
              {sequenceIndex !== null ? (
                <>
                  <Square className="h-4 w-4 fill-current" />
                  Stop Preview
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  Preview Album
                </>
              )}
            </button>
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
              30-second clips
            </p>
          </div>
        )}
      </header>

      {credits && (
        <KeptCreditSurface
          kept={isKeptAlbumInLibrary}
          payload={credits}
          returnTo={returnHref}
          label="Album credits"
          testId="album-credits"
          album
        />
      )}

      <div className="mt-10 space-y-10">
        {album.tracks.length > 0 && (
          <section data-testid="album-all-tracks">
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title="Tracklist"
              hint={`${album.tracks.length} track${album.tracks.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {album.tracks.map((track, i) => {
                const isKept = keptMbids.has(track.mbid);
                const isPlaying = playingMbid === track.mbid;
                const isLoading = loadingMbid === track.mbid && sequenceIndex === i;
                const isUnavailable = unavailableMbids.has(track.mbid);
                return (
                  <TrackRow
                    key={track.mbid}
                    track={track}
                    index={i + 1}
                    isKept={isKept}
                    isPlaying={isPlaying}
                    isLoading={isLoading}
                    isUnavailable={isUnavailable}
                    isAnchor={track.mbid === trackAnchor}
                    returnContext={returnHref}
                    demoSurface={demoSurface}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {album.tracks.length === 0 && (
          <div className="rounded-2xl border border-border bg-card/50 p-8 text-center">
            <p className="text-base text-muted-foreground">No tracks found for this album yet.</p>
          </div>
        )}

        <AlbumListProvenance releaseGroupMbid={releaseGroupMbid} />
      </div>
    </div>
  );
}
