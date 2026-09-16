import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import {
  getRecordingAlbumTracks,
  getArtistMetadata,
  useGetArtist,
  useSearchArtistStations,
  getSearchArtistStationsQueryKey,
  type ArtistStationSearchStationsItem,
  type ArtistAlbumSummary,
  type ArtistTopTrack,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Disc3,
  Music4,
  Play,
  Radio,
  ShoppingBag,
} from "lucide-react";
import { timeAgo } from "../lib/format";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import {
  buildLibraryEntityUrl,
  buildLibraryReturnHref,
  readLibraryReturnContext,
} from "../lib/libraryFocusedNavigation";
import { useAppConfig, useMyLibraryInfinite, type LibraryItem } from "../lib/meHooks";
import { useArtistMerch } from "../lib/merch";
import { MerchCollection } from "../components/MerchCollection";

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

function TopTrackCard({ track, returnContext, demoSurface }: {
  track: ArtistTopTrack;
  returnContext: string;
  demoSurface: boolean;
}) {
  return (
    <li>
      <Link
        href={buildLibraryEntityUrl(`/song/${encodeURIComponent(track.mbid)}`, returnContext, { demoSurface })}
        className="group flex items-center gap-4 rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-card/80"
        data-testid="artist-top-track"
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
          <p className="truncate text-base font-normal text-foreground group-hover:text-primary">
            {track.title}
          </p>
          <p className="text-sm text-muted-foreground">
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

function ArtistAlbumCard({ album, returnContext, demoSurface }: {
  album: ArtistAlbumSummary;
  returnContext: string;
  demoSurface: boolean;
}) {
  const { ride } = usePlayer();
  const [state, setState] = useState<"idle" | "loading" | "unavailable">("idle");

  const playAlbum = async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      const data = await getRecordingAlbumTracks(album.firstRecordingMbid, {
        canonicalOrder: true,
      });
      const seeds: RideSeed[] = data.tracks
        .filter((track) => Boolean(track.mbid && track.title && track.artist))
        .map((track) => ({
          mbid: track.mbid,
          title: track.title,
          artist: track.artist,
          artworkUrl: album.artworkUrl,
          links: [],
        }));
      if (seeds.length === 0) {
        setState("unavailable");
        return;
      }
      ride.startReplay(seeds, data.rgTitle ?? album.title, {
        timeOrientation: "curated",
        context: "library",
      });
      setState("idle");
    } catch {
      setState("unavailable");
    }
  };

  const unavailable = state === "unavailable";
  return (
    <li className="overflow-hidden rounded-2xl border border-card-border bg-card" data-testid="artist-album">
      <Link href={buildLibraryEntityUrl(`/album/${encodeURIComponent(album.releaseGroupMbid)}`, returnContext, { demoSurface })} className="block bg-muted">
        {album.artworkUrl ? (
          <div className="relative flex aspect-square w-full items-center justify-center">
            <Disc3 className="h-12 w-12 text-muted-foreground/30" aria-hidden="true" />
            <img
              src={proxyArtUrl(album.artworkUrl) ?? album.artworkUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => event.currentTarget.remove()}
            />
          </div>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center">
            <Disc3 className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
      </Link>
      <div className="p-4">
        <Link
          href={buildLibraryEntityUrl(`/album/${encodeURIComponent(album.releaseGroupMbid)}`, returnContext, { demoSurface })}
          className="block truncate font-serif text-xl text-foreground hover:text-primary"
        >
          {album.title}
        </Link>
        <p className="mt-1 font-mono text-[12px] text-muted-foreground">
          {[album.releaseYear, `${album.trackCount} track${album.trackCount === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <button
          type="button"
          onClick={() => void playAlbum()}
          disabled={state !== "idle"}
          aria-label={unavailable ? `${album.title} is unavailable to play` : `Play ${album.title}`}
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary/40 px-3 font-mono text-[12px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground"
          data-testid="artist-album-play"
        >
          <Play className="h-4 w-4" />
          {state === "loading" ? "Loading…" : unavailable ? "Unavailable" : "Play album"}
        </button>
        {unavailable ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            No playable tracks are available for this album yet.
          </p>
        ) : null}
      </div>
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

function KeptArtistSection({
  items,
  returnContext,
  demoSurface,
}: {
  items: LibraryItem[];
  returnContext: string;
  demoSurface: boolean;
}) {
  const albums = useMemo(() => {
    const seen = new Set<string>();
    return items.flatMap((item) => {
      const rec = item.recording;
      if (!rec?.albumTitle) return [];
      const key = rec.releaseGroupMbid ?? `${rec.albumTitle}\x1f${rec.artist}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, title: rec.albumTitle, releaseGroupMbid: rec.releaseGroupMbid ?? null, artworkUrl: rec.artworkUrl }];
    });
  }, [items]);
  if (items.length === 0 && albums.length === 0) return null;
  return (
    <section data-testid="artist-kept-library">
      <SectionHeading icon={<Music4 className="h-5 w-5" />} title="In your Library" />
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.slice(0, 20).map((item) => {
            const rec = item.recording;
            if (!item.mbid || !rec) return null;
            return (
              <li key={item.mbid}>
                <Link
                  href={buildLibraryEntityUrl(`/song/${encodeURIComponent(item.mbid)}`, returnContext, { demoSurface })}
                  className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3 hover:border-primary/30"
                >
                  <Music4 className="h-4 w-4 shrink-0 text-primary/70" />
                  <span className="min-w-0 flex-1 truncate text-base text-foreground">{rec.title}</span>
                  <span className="truncate font-mono text-[12px] text-muted-foreground">{rec.albumTitle ?? "Library"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {albums.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {albums.map((album) => album.releaseGroupMbid ? (
            <Link
              key={album.key}
              href={buildLibraryEntityUrl(`/album/${encodeURIComponent(album.releaseGroupMbid)}`, returnContext, { demoSurface })}
              className="rounded-full border border-card-border bg-card px-3 py-1.5 text-sm text-foreground hover:border-primary/30"
            >
              {album.title}
            </Link>
          ) : (
            <span key={album.key} className="rounded-full border border-card-border bg-card px-3 py-1.5 text-sm text-muted-foreground">
              {album.title}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MatchingStations({
  stations,
  artistName,
  artistMbid,
}: {
  stations: ArtistStationSearchStationsItem[];
  artistName: string;
  artistMbid: string;
}) {
  if (stations.length === 0) return null;
  return (
    <section data-testid="artist-matching-stations">
      <SectionHeading icon={<Radio className="h-5 w-5" />} title="Matching stations" hint={`${stations.length} station${stations.length === 1 ? "" : "s"}`} />
      <ul className="flex flex-col gap-2">
        {stations.map((station) => (
          <li key={station.slug}>
            <Link
              href={`/library?stationCrossings=${encodeURIComponent(station.slug)}&focus=${encodeURIComponent(artistName)}&focusId=${encodeURIComponent(artistMbid)}`}
              className="flex items-center justify-between rounded-xl border border-card-border bg-card p-3 hover:border-primary/30"
            >
              <span className="truncate text-base text-foreground">{station.name}</span>
              <span className="ml-3 shrink-0 font-mono text-[12px] text-muted-foreground">
                {station.playCount} match{station.playCount === 1 ? "" : "es"} · Stations →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Artist() {
  const params = useParams();
  const mbid = params.mbid ?? "";
  const search = useSearch();
  const { data: appConfig } = useAppConfig();
  const demoSurface = appConfig?.demoSurface === true;
  const returnContext = readLibraryReturnContext(search, { demoSurface });
  const returnHref = buildLibraryReturnHref(returnContext);

  const { data: artist, isLoading, isError } = useGetArtist(mbid);
  const [artistMetadata, setArtistMetadata] = useState<Awaited<ReturnType<typeof getArtistMetadata>> | null>(null);
  useEffect(() => {
    let active = true;
    if (!mbid) return () => { active = false; };
    void getArtistMetadata(mbid)
      .then((metadata) => {
        if (active) setArtistMetadata(metadata);
      })
      .catch(() => {
        // Metadata is an optional, independently failing section.
      });
    return () => { active = false; };
  }, [mbid]);
  const {
    data: libraryData,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useMyLibraryInfinite({ q: artist?.name ?? "" }, 100);
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  const artistStationQuery = useSearchArtistStations(
    { q: artist?.name ?? "" },
    {
      query: {
        queryKey: getSearchArtistStationsQueryKey({ q: artist?.name ?? "" }),
        enabled: Boolean(artist?.name),
        staleTime: 5 * 60_000,
        retry: 1,
      },
    },
  );
  // Merch is scoped by the canonical MusicBrainz artist identity. Do not
  // broaden this to a display-name match: artist names are ambiguous.
  const artistMerchQuery = useArtistMerch(artist?.mbid);
  const artistMerch = useMemo(
    () => artistMerchQuery.data?.items.filter((item) => item.artistMbid === mbid) ?? [],
    [artistMerchQuery.data, mbid],
  );
  const keptItems = useMemo(() => {
    if (!artist) return [];
    const name = artist.name.trim().toLocaleLowerCase();
    return libraryData?.pages.flatMap((page) => page.items).filter((item) => {
      const rec = item.recording;
      return rec != null && (
        rec.artistMbid === mbid
        || rec.artist.trim().toLocaleLowerCase() === name
      );
    }) ?? [];
  }, [artist, libraryData, mbid]);

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
        <ArtistSkeleton />
      </div>
    );
  }

  if (isError || !artist) {
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
          Couldn't load this artist. Please refresh.
        </div>
      </div>
    );
  }

  const albums = artist.albums;
  const spotifyAlbums = artist.catalogue?.albums ?? [];
  const spotifyTopTracks = artist.catalogue?.topTracks ?? [];

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

      <header className="mt-8 space-y-1">
        <p className="font-mono text-[13px] uppercase tracking-[0.2em] text-primary">
          Artist
        </p>
        <h1
          className="font-serif text-4xl font-normal leading-tight text-foreground sm:text-5xl"
          data-testid="artist-name"
        >
          {artist.name}
        </h1>
        {artist.topTracks.length > 0 && (
          <p className="text-lg text-muted-foreground">
            {artist.topTracks.reduce((s: number, t: ArtistTopTrack) => s + t.spinCount, 0)} total spins on Lore
          </p>
        )}
      </header>

      <div className="mt-10 space-y-10">
        {artistMetadata?.mbid === mbid && artistMetadata.status === "success" && artistMetadata.metadata ? (
          <section data-testid="artist-about">
            <SectionHeading icon={<Music4 className="h-5 w-5" />} title="About this artist" />
            <div className="rounded-2xl border border-card-border bg-card p-4 text-sm text-muted-foreground">
              {artistMetadata.metadata.aliases.length > 0 ? (
                <p>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-foreground/60">Also known as </span>
                  {artistMetadata.metadata.aliases.slice(0, 8).join(", ")}
                </p>
              ) : null}
              {artistMetadata.metadata.inceptionDate ? (
                <p className="mt-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-foreground/60">Formed </span>
                  {artistMetadata.metadata.inceptionDate}
                  {artistMetadata.metadata.formationPlace ? (
                    <> · <a className="text-primary hover:underline" href={artistMetadata.metadata.formationPlace.url} target="_blank" rel="noreferrer">{artistMetadata.metadata.formationPlace.label ?? artistMetadata.metadata.formationPlace.qid}</a></>
                  ) : null}
                </p>
              ) : null}
              {artistMetadata.metadata.officialWebsite ? (
                <p className="mt-2">
                  <a className="text-primary hover:underline" href={artistMetadata.metadata.officialWebsite} target="_blank" rel="noreferrer">
                    Official website →
                  </a>
                </p>
              ) : null}
              {artistMetadata.metadata.recordLabels.length > 0 ? (
                <p className="mt-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-foreground/60">Labels </span>
                  {artistMetadata.metadata.recordLabels.map((label, index) => (
                    <span key={label.qid}>
                      {index > 0 ? ", " : ""}
                       <a className="text-primary hover:underline" href={label.url} target="_blank" rel="noreferrer">{label.label ?? label.qid}</a>
                    </span>
                  ))}
                </p>
              ) : null}
              {artistMetadata.metadata.groups.length > 0 ? (
                <p className="mt-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-foreground/60">Groups </span>
                  {artistMetadata.metadata.groups.map((group, index) => (
                    <span key={group.qid}>
                      {index > 0 ? ", " : ""}
                       <a className="text-primary hover:underline" href={group.url} target="_blank" rel="noreferrer">{group.label ?? group.qid}</a>
                    </span>
                  ))}
                </p>
              ) : null}
              {artistMetadata.metadata.members.length > 0 ? (
                <p className="mt-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-foreground/60">Members </span>
                  {artistMetadata.metadata.members.map((member, index) => (
                    <span key={member.qid}>
                      {index > 0 ? ", " : ""}
                       <a className="text-primary hover:underline" href={member.url} target="_blank" rel="noreferrer">{member.label ?? member.qid}</a>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
        <KeptArtistSection
          items={keptItems}
          returnContext={returnHref}
          demoSurface={demoSurface}
        />
        {albums.length > 0 && (
          <section data-testid="artist-discography">
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title="Albums"
              hint={`${albums.length} release${albums.length === 1 ? "" : "s"}`}
            />
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {albums.map((album) => (
                <ArtistAlbumCard key={album.releaseGroupMbid} album={album} returnContext={returnHref} demoSurface={demoSurface} />
              ))}
            </ul>
          </section>
        )}

        <section data-testid="artist-merch">
          <SectionHeading
            icon={<ShoppingBag className="h-5 w-5" />}
            title="Support this artist"
            hint={artistMerchQuery.data ? `${artistMerch.length} item${artistMerch.length === 1 ? "" : "s"}` : undefined}
          />
          <MerchCollection
            items={artistMerch}
            isLoading={artistMerchQuery.isLoading}
            isError={artistMerchQuery.isError}
            emptyMessage={`No verified merch found for ${artist.name}.`}
          />
        </section>

        <MatchingStations
          stations={artistStationQuery.data?.stations ?? []}
          artistName={artist.name}
          artistMbid={mbid}
        />

        {artist.topTracks.length > 0 && (
          <section data-testid="artist-top-tracks">
            <SectionHeading
              icon={<Radio className="h-5 w-5" />}
              title="Heard on Lore"
              hint={`${artist.topTracks.length} track${artist.topTracks.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {artist.topTracks.map((track) => (
                <TopTrackCard key={track.mbid} track={track} returnContext={returnHref} demoSurface={demoSurface} />
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
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-base text-muted-foreground"
                >
                  <Music4 className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  <span className="truncate">{t.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {spotifyAlbums.length > 0 && albums.length === 0 && (
          <section data-testid="artist-spotify-albums">
            <SectionHeading
              icon={<Disc3 className="h-5 w-5" />}
              title="Albums on Spotify"
              hint={`${spotifyAlbums.length} release${spotifyAlbums.length === 1 ? "" : "s"}`}
            />
            <ul className="flex flex-col gap-2">
              {spotifyAlbums.map((album) => (
                <li key={album.id}>
                  <a
                    href={album.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl border border-card-border bg-card p-3 text-foreground hover:border-primary/30"
                  >
                    <span className="truncate">{album.name}</span>
                    <span className="ml-3 shrink-0 font-mono text-[12px] text-muted-foreground">Spotify →</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {artist.topTracks.length === 0 && albums.length === 0 && (
          <div className="rounded-2xl border border-border bg-card/50 p-8 text-center">
            <p className="text-base text-muted-foreground">
              No spins or discography found for this artist yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
