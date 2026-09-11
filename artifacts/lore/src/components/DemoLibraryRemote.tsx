import { useMemo, useState } from "react";
import type { LibraryItem } from "../lib/meHooks";
import type { DialStation } from "../hooks/useDialData";
import {
  buildDemoRadioSections,
  type DemoStationSort,
} from "../lib/demoRadioOrdering";
import { StationMark } from "./StationMark";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { usePlayer } from "../player/PlayerProvider";
import { proxyArtUrl } from "../lib/proxyArt";
import { useInlinePreview } from "../player/inlinePreview";
import { toast } from "../hooks/use-toast";
import { compareLibrarySongs, type LibrarySongSort } from "../lib/librarySongOrdering";

export type DemoSongSort = "added" | "artist" | "album" | "title" | "count" | "genre" | "era";

function stationTrack(station: DialStation) {
  return station.liveTrack
    ?? station.shows.find((show) => show.state === "live")?.currentTrack
    ?? null;
}

function StationRemoteTile({ station }: { station: DialStation }) {
  const { radio } = usePlayer();
  const playable = resolvePlaybackSource(station.station) !== null;
  const selected = radio.station?.slug === station.station.slug;
  const track = stationTrack(station);
  const nowPlaying = track?.artist?.trim()
    ? `Playing ${track.artist}`
    : "Not broadcasting track details";
  const label = `${station.station.name}. ${nowPlaying}`;

  return (
    <button
      type="button"
      className={`demo-library-remote__tile demo-library-remote__station${selected ? " is-selected" : ""}`}
      aria-label={`Tune in to ${label}`}
      aria-pressed={selected}
      title={label}
      disabled={!playable}
      onPointerDown={() => radio.warmup(station.station)}
      onPointerUp={radio.releaseWarmup}
      onPointerCancel={radio.cancelWarmup}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") radio.cancelWarmup();
      }}
      onClick={() => {
        if (playable) void radio.toggle(station.station);
      }}
      data-testid="demo-station-remote-tile"
    >
      <StationMark
        name={station.station.name}
        logoUrl={station.station.logoUrl}
        variant="cube"
        className="demo-library-remote__station-mark"
      />
    </button>
  );
}

function SongRemoteTile({ item }: { item: LibraryItem }) {
  const { playingMbid, loadingMbid, toggle } = useInlinePreview();
  const [artFailed, setArtFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const recording = item.recording;
  const title = recording?.title?.trim() || "Unresolved recording";
  const artist = recording?.artist?.trim() || "Unknown artist";
  const album = recording?.albumTitle?.trim() || "Release unknown";
  const artwork = recording?.artworkUrl
    ?? (recording?.releaseGroupMbid
      ? `https://coverartarchive.org/release-group/${recording.releaseGroupMbid}/front-1200`
      : null);
  const proxiedArtwork = proxyArtUrl(artwork) ?? artwork;
  const playable = Boolean(item.mbid && recording);
  const playing = item.mbid != null && playingMbid === item.mbid;
  const loading = item.mbid != null && loadingMbid === item.mbid;
  const description = `${title} — ${artist} · ${album}`;

  return (
    <button
      type="button"
      className={`demo-library-remote__tile demo-library-remote__song${playing ? " is-selected" : ""}${loading ? " is-loading" : ""}${unavailable ? " is-unavailable" : ""}`}
      aria-label={
        unavailable
          ? `Preview unavailable for ${title} by ${artist}`
          : playing
          ? `Stop preview of ${title} by ${artist}`
          : loading
            ? `Loading preview of ${title} by ${artist}`
            : `Preview ${title} by ${artist}`
      }
      aria-pressed={playing}
      title={unavailable ? `${description} · Preview unavailable` : description}
      disabled={!playable || unavailable}
      onClick={() => {
        if (!item.mbid) return;
        setUnavailable(false);
        void toggle(item.mbid).then((result) => {
          if (result === "unavailable") {
            setUnavailable(true);
            toast({ title: `Preview unavailable: ${title}` });
          }
        });
      }}
      data-testid="demo-song-remote-tile"
    >
      {proxiedArtwork && !artFailed ? (
        <img
          src={proxiedArtwork}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setArtFailed(true)}
        />
      ) : (
        <span className="demo-library-remote__fallback" aria-hidden="true">
          <strong>{title}</strong>
          <span>{artist}</span>
        </span>
      )}
      {loading ? <span className="demo-library-remote__status" aria-hidden="true">…</span> : null}
      {playing ? <span className="demo-library-remote__status" aria-hidden="true">■</span> : null}
    </button>
  );
}

function orderSongs(items: readonly LibraryItem[], sort: DemoSongSort): LibraryItem[] {
  const artistCounts = new Map<string, number>();
  if (sort === "count") {
    for (const item of items) {
      const artist = item.recording?.artist ?? "";
      artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }
  }
  if (sort === "genre" || sort === "era" || sort === "artist" || sort === "title" || sort === "added") {
    return [...items].sort((a, b) => compareLibrarySongs(a, b, sort as LibrarySongSort));
  }
  return [...items].sort((a, b) => {
    const aRecording = a.recording;
    const bRecording = b.recording;
    if (sort === "count") {
      const countDifference = sort === "count"
        ? (artistCounts.get(bRecording?.artist ?? "") ?? 0)
          - (artistCounts.get(aRecording?.artist ?? "") ?? 0)
        : 0;
      return countDifference
        || (aRecording?.artist ?? "").localeCompare(bRecording?.artist ?? "")
        || (aRecording?.title ?? "").localeCompare(bRecording?.title ?? "");
    }
    if (sort === "album") {
      return (aRecording?.albumTitle ?? "").localeCompare(bRecording?.albumTitle ?? "")
        || (aRecording?.artist ?? "").localeCompare(bRecording?.artist ?? "")
        || (aRecording?.title ?? "").localeCompare(bRecording?.title ?? "");
    }
    if (sort === "title") {
      return (aRecording?.title ?? "").localeCompare(bRecording?.title ?? "")
        || (aRecording?.artist ?? "").localeCompare(bRecording?.artist ?? "");
    }
    return Date.parse(b.addedAt) - Date.parse(a.addedAt)
      || (a.mbid ?? a.spotifyId ?? "").localeCompare(b.mbid ?? b.spotifyId ?? "");
  });
}

export function DemoStationRemote({
  stations,
  hasData,
  focusedArtist,
  sort,
}: {
  stations: DialStation[];
  hasData: boolean;
  focusedArtist: string | null;
  sort: DemoStationSort;
}) {
  const orderedStations = useMemo(
    () => buildDemoRadioSections({
      stations,
      hasData,
      focusedArtist,
      sort,
    }).orderedStations,
    [focusedArtist, hasData, sort, stations],
  );

  return (
    <section className="demo-library-remote" aria-label="Station remote">
      {orderedStations.length > 0 ? (
        <div className="demo-library-remote__grid">
          {orderedStations.map((station) => (
            <StationRemoteTile key={station.station.slug} station={station} />
          ))}
        </div>
      ) : (
        <p className="demo-library-remote__empty">No stations in this view.</p>
      )}
    </section>
  );
}

export function DemoSongRemote({
  items,
  sort,
}: {
  items: LibraryItem[];
  sort: DemoSongSort;
}) {
  const orderedItems = useMemo(() => orderSongs(items, sort), [items, sort]);

  return (
    <section className="demo-library-remote" aria-label="Song remote">
      {orderedItems.length > 0 ? (
        <div className="demo-library-remote__grid">
          {orderedItems.map((item, index) => (
            <SongRemoteTile
              key={item.mbid ?? item.spotifyId ?? `${item.addedAt}:${index}`}
              item={item}
            />
          ))}
        </div>
      ) : (
        <p className="demo-library-remote__empty">No songs in this view.</p>
      )}
    </section>
  );
}