import { Link, useParams } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import {
  useGetAlbum,
  type AlbumResult,
} from "@workspace/api-client-react";
import { ArrowLeft, Disc3, Music4, Play, Radio } from "lucide-react";
import { AlbumListProvenance } from "../components/ListProvenance";
import { timeAgo } from "../lib/format";

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
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/70">
        {title}
      </span>
      {hint && (
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
          {hint}
        </span>
      )}
    </div>
  );
}

type AlbumTrackRow = AlbumResult["tracks"][number];

function TrackRow({ track }: { track: AlbumTrackRow }) {
  const spunOnLore = track.spinCount > 0;
  return (
    <li>
      <Link
        href={`/song/${track.mbid}`}
        className="group flex items-center gap-4 rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-card/80"
        data-testid="album-track"
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
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
          <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
            {track.title}
          </p>
          {spunOnLore ? (
            <p className="text-xs text-muted-foreground">
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
            <p className="text-xs text-muted-foreground/50">Not yet heard on Lore</p>
          )}
        </div>
        <Play className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
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
  const releaseGroupMbid = params.releaseGroupMbid ?? "";

  const { data: album, isLoading, isError } = useGetAlbum(releaseGroupMbid);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-24">
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to the dial
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
            href="/"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to the dial
          </Link>
        </div>
        <div className="mt-10 rounded-2xl border border-destructive-border bg-destructive/10 p-6 text-sm text-destructive-foreground">
          Couldn't load this album. Please refresh.
        </div>
      </div>
    );
  }

  const heardTracks = album.tracks.filter((t) => t.spinCount > 0);
  const totalSpins = heardTracks.reduce((s, t) => s + t.spinCount, 0);
  const artistMbid = album.tracks[0]?.artistMbid ?? null;
  const artistName = album.tracks[0]?.artist ?? null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <div className="mt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary"
          data-testid="back-to-dial"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to the dial
        </Link>
      </div>

      <header className="mt-8 space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          {album.primaryType ?? "Album"}
        </p>
        <h1
          className="font-serif text-4xl font-semibold leading-tight text-foreground sm:text-5xl"
          data-testid="album-title"
        >
          {album.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
          {artistMbid ? (
            <Link
              href={`/artist/${artistMbid}`}
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
              {artistName && (
                <span className="text-muted-foreground/40">·</span>
              )}
              <span>{album.releaseYear}</span>
            </>
          )}
        </div>
        {totalSpins > 0 && (
          <p className="pt-1 text-sm text-muted-foreground">
            {totalSpins} spin{totalSpins === 1 ? "" : "s"} from{" "}
            {heardTracks.length} track{heardTracks.length === 1 ? "" : "s"} on
            Lore
          </p>
        )}
      </header>

      <div className="mt-10 space-y-10">
        {heardTracks.length > 0 && (
          <section data-testid="album-heard-tracks">
            <SectionHeading
              icon={<Radio className="h-5 w-5" />}
              title="Heard on Lore"
              hint={`${heardTracks.length} track${heardTracks.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {heardTracks.map((track) => (
                <TrackRow key={track.mbid} track={track} />
              ))}
            </ul>
          </section>
        )}

        {album.tracks.length > 0 && (
          <section data-testid="album-all-tracks">
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title="Full tracklist"
              hint={`${album.tracks.length} track${album.tracks.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {album.tracks.map((track) => (
                <TrackRow key={track.mbid} track={track} />
              ))}
            </ul>
          </section>
        )}

        {album.tracks.length === 0 && (
          <div className="rounded-2xl border border-border bg-card/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No tracks found for this album yet.
            </p>
          </div>
        )}

        <AlbumListProvenance releaseGroupMbid={releaseGroupMbid} />
      </div>
    </div>
  );
}
