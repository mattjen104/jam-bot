import { Link, useParams } from "wouter";
import {
  useGetArtist,
  type ArtistTopTrack,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Disc3,
  Music4,
  Play,
  Radio,
} from "lucide-react";
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

function TopTrackCard({ track }: { track: ArtistTopTrack }) {
  return (
    <li>
      <Link
        href={`/song/${track.mbid}`}
        className="group flex items-center gap-4 rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-card/80"
        data-testid="artist-top-track"
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
          {track.artworkUrl ? (
            <img
              src={track.artworkUrl}
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
          <p className="text-xs text-muted-foreground">
            {track.spinCount} spin{track.spinCount === 1 ? "" : "s"}
            {track.lastSpunAt && (
              <span className="ml-2 text-muted-foreground/60">
                · last {timeAgo(track.lastSpunAt)}
              </span>
            )}
          </p>
        </div>
        <Play className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
      </Link>
    </li>
  );
}

function ArtistSkeleton() {
  return (
    <div className="mt-6 animate-pulse space-y-4">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="h-10 w-1/2 rounded bg-muted" />
      <div className="h-4 w-1/3 rounded bg-muted" />
      <div className="mt-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

export default function Artist() {
  const params = useParams();
  const mbid = params.mbid ?? "";

  const { data: artist, isLoading, isError } = useGetArtist(mbid);

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
        <ArtistSkeleton />
      </div>
    );
  }

  if (isError || !artist) {
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
          Couldn't load this artist. Please refresh.
        </div>
      </div>
    );
  }

  const albums = artist.catalogue?.albums ?? [];
  const spotifyTopTracks = artist.catalogue?.topTracks ?? [];

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
          Artist
        </p>
        <h1
          className="font-serif text-4xl font-semibold leading-tight text-foreground sm:text-5xl"
          data-testid="artist-name"
        >
          {artist.name}
        </h1>
        {artist.topTracks.length > 0 && (
          <p className="text-base text-muted-foreground">
            {artist.topTracks.reduce((s: number, t: ArtistTopTrack) => s + t.spinCount, 0)} total spins on Lore
          </p>
        )}
      </header>

      <div className="mt-10 space-y-10">
        {artist.topTracks.length > 0 && (
          <section data-testid="artist-top-tracks">
            <SectionHeading
              icon={<Radio className="h-5 w-5" />}
              title="Heard on Lore"
              hint={`${artist.topTracks.length} track${artist.topTracks.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {artist.topTracks.map((track) => (
                <TopTrackCard key={track.mbid} track={track} />
              ))}
            </ul>
          </section>
        )}

        {albums.length > 0 && (
          <section data-testid="artist-discography">
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title="Discography"
              hint={`${albums.length} release${albums.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {albums.map((album) => (
                <li key={album.id}>
                  <a
                    href={album.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center justify-between rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-primary/30"
                    data-testid="artist-album"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                        {album.name}
                      </p>
                      {album.year != null && (
                        <p className="text-xs text-muted-foreground">{album.year}</p>
                      )}
                    </div>
                    <span className="ml-3 shrink-0 font-mono text-[11px] text-muted-foreground/60">
                      Spotify →
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {spotifyTopTracks.length > 0 && (
          <section data-testid="artist-spotify-tracks">
            <SectionHeading
              icon={<Music4 className="h-5 w-5" />}
              title="Popular on Spotify"
              hint={`${spotifyTopTracks.length} track${spotifyTopTracks.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-1.5">
              {spotifyTopTracks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-muted-foreground"
                >
                  <Music4 className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  <span className="truncate">{t.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {artist.topTracks.length === 0 && albums.length === 0 && (
          <div className="rounded-2xl border border-border bg-card/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No spins or discography found for this artist yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
