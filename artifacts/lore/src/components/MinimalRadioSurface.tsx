import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Heart, Radio, SkipForward } from "lucide-react";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { LibraryItem } from "../lib/meHooks";
import { useMutationKeep } from "../lib/meHooks";
import { useDialSkipped } from "../lib/dialFilterState";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError, RUMOURS } from "../lib/rumours";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";

export type RadioPreset = "now" | "lifetime";

interface MinimalRadioSurfaceProps {
  rows: DialLaneRow[];
  libraryItems: LibraryItem[];
  preset: RadioPreset;
  onPresetChange: (preset: RadioPreset) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

function liveTrack(row: DialLaneRow) {
  return row.ds.liveTrack ?? row.show?.currentTrack ?? null;
}

function scoreFor(row: DialLaneRow, preset: RadioPreset): number {
  if (preset === "now") {
    const track = liveTrack(row);
    return (track?.isLibraryHit ? 2 : 0) + (track?.isArtistHit ? 1 : 0);
  }
  return row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings;
}

function crossingAlbums(row: DialLaneRow, libraryItems: LibraryItem[]): LibraryItem[] {
  const track = liveTrack(row);
  const spins = row.show?.spins ?? [];
  const artists = new Set(
    [track?.artist, ...spins.filter((spin) => spin.isLibraryHit || spin.isArtistHit).map((spin) => spin.artist)]
      .filter((artist): artist is string => Boolean(artist?.trim()))
      .map((artist) => artist.trim().toLowerCase()),
  );
  const matched = libraryItems.filter((item) => {
    const recording = item.recording;
    if (!recording) return false;
    if (track?.mbid && item.mbid === track.mbid) return true;
    return artists.has(recording.artist.trim().toLowerCase());
  });
  const seen = new Set<string>();
  return matched.filter((item) => {
    const key = item.recording?.releaseGroupMbid ?? item.recording?.albumTitle ?? item.mbid;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function artForTrack(row: DialLaneRow, libraryItems: LibraryItem[]): string | null {
  const track = liveTrack(row);
  if (!track) return null;
  return libraryItems.find((item) => item.mbid === track.mbid)?.recording?.artworkUrl ?? null;
}

function MinimalRadioCard({
  row,
  libraryItems,
  onPrevious,
  onNext,
}: {
  row: DialLaneRow;
  libraryItems: LibraryItem[];
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { radio } = usePlayer();
  const keep = useMutationKeep();
  const { isSkipped, toggleSkip } = useDialSkipped();
  const track = liveTrack(row);
  const albums = useMemo(() => crossingAlbums(row, libraryItems), [row, libraryItems]);
  const artwork = artForTrack(row, libraryItems);
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const isCurrent = radio.station?.slug === row.ds.station.slug;
  const isPlaying = isCurrent && radio.status === "playing";
  const kept = Boolean(track?.mbid && libraryItems.some((item) => item.mbid === track.mbid));

  const play = useCallback(() => {
    if (playable) void radio.toggle(row.ds.station);
  }, [playable, radio, row.ds.station]);

  const handleKeep = () => {
    if (!track?.mbid || keep.isPending) return;
    keep.mutate({ mbid: track.mbid, provenance: { kind: "keep", stationSlug: row.ds.station.slug } });
  };

  return (
    <article
      className="minimal-radio-card"
      data-testid="minimal-radio-card"
      aria-label={`${row.ds.station.name} station card`}
      onTouchStart={(event) => {
        (event.currentTarget as HTMLElement).dataset.touchX = String(event.touches[0]?.clientX ?? 0);
      }}
      onTouchEnd={(event) => {
        const start = Number((event.currentTarget as HTMLElement).dataset.touchX ?? 0);
        const end = event.changedTouches[0]?.clientX ?? start;
        if (Math.abs(end - start) > 48) (end < start ? onNext : onPrevious)();
      }}
    >
      <div className="minimal-radio-card__heading">
        <div className="minimal-radio-card__station">
          <span className="minimal-radio-card__live"><Radio size={13} aria-hidden="true" /> ON AIR</span>
          <h2>{row.ds.station.name}</h2>
          {row.show?.showName ? <p>{row.show.showName}</p> : null}
        </div>
        <a
          className="minimal-radio-card__site"
          href={row.ds.station.homepageUrl ?? `/archive/stations/${row.ds.station.slug}`}
          target={row.ds.station.homepageUrl ? "_blank" : undefined}
          rel={row.ds.station.homepageUrl ? "noopener noreferrer" : undefined}
          aria-label={`Open ${row.ds.station.name} station page`}
        >
          <ExternalLink size={15} aria-hidden="true" />
          station
        </a>
      </div>

      <section className="minimal-radio-card__albums" aria-label="Albums crossing with this station">
        <div className="minimal-radio-card__eyebrow">From your crate</div>
        {albums.length > 0 ? (
          <div className="minimal-radio-card__album-grid">
            {albums.map((item) => (
              <a
                key={item.mbid}
                href={item.recording?.releaseGroupMbid ? `/album/${item.recording.releaseGroupMbid}` : `/recording/${item.mbid}`}
                className="minimal-radio-card__album"
                title={`${item.recording?.albumTitle ?? item.recording?.title ?? "Album"} by ${item.recording?.artist ?? ""}`}
              >
                <img
                  src={proxyArtUrl(item.recording?.artworkUrl) ?? RUMOURS}
                  alt=""
                  onError={onArtError}
                />
                <span>{item.recording?.albumTitle ?? item.recording?.title ?? "Untitled"}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="minimal-radio-card__empty-albums">Your saved albums will appear here when this station crosses them.</p>
        )}
      </section>

      <section className="minimal-radio-card__track" aria-label="Current track">
        <div className="minimal-radio-card__track-art">
          <img src={proxyArtUrl(artwork) ?? RUMOURS} alt="" onError={onArtError} />
        </div>
        <div className="minimal-radio-card__track-copy">
          <div className="minimal-radio-card__eyebrow">Now playing</div>
          <strong>{track?.title || "Waiting for track metadata"}</strong>
          <span>{track?.artist || "The station is live"}</span>
        </div>
        <button
          type="button"
          className="minimal-radio-card__play"
          disabled={!playable}
          onClick={play}
          aria-label={isPlaying ? `Pause ${row.ds.station.name}` : `Tune in to ${row.ds.station.name}`}
        >
          {isPlaying ? "Pause" : "Tune in"}
        </button>
      </section>

      <div className="minimal-radio-card__actions">
        <button type="button" onClick={handleKeep} disabled={!track?.mbid || keep.isPending || kept} aria-pressed={kept}>
          <Heart size={14} aria-hidden="true" /> {kept ? "Kept" : keep.isPending ? "Keeping…" : "Keep"}
        </button>
        <button
          type="button"
          onClick={() => toggleSkip(row.ds.station.slug)}
          aria-pressed={isSkipped(row.ds.station.slug)}
        >
          <SkipForward size={14} aria-hidden="true" /> {isSkipped(row.ds.station.slug) ? "Skipped" : "Skip"}
        </button>
      </div>
    </article>
  );
}

export function MinimalRadioSurface({
  rows,
  libraryItems,
  preset,
  onPresetChange,
  loading = false,
  error = false,
  onRetry,
}: MinimalRadioSurfaceProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const candidates = useMemo(
    () => [...rows]
      .filter((row) => liveTrack(row) != null || row.ds.station.streamUrl != null || row.ds.station.relayUrl != null)
      .sort((a, b) => scoreFor(b, preset) - scoreFor(a, preset) || a.ds.station.name.localeCompare(b.ds.station.name)),
    [preset, rows],
  );
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((row) => row.ds.station.slug === selectedSlug),
  );
  const selected = candidates[selectedIndex] ?? null;

  const selectOffset = useCallback((offset: number) => {
    if (candidates.length === 0) return;
    const nextIndex = (selectedIndex + offset + candidates.length) % candidates.length;
    setSelectedSlug(candidates[nextIndex]!.ds.station.slug);
  }, [candidates, selectedIndex]);

  if (loading && rows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-loading" aria-live="polite">
        <Radio size={24} aria-hidden="true" />
        <h2>Tuning the dial…</h2>
        <p>Finding the live stations that cross your library.</p>
      </section>
    );
  }
  if (error && rows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-error" role="alert">
        <Radio size={24} aria-hidden="true" />
        <h2>The dial couldn’t load.</h2>
        <button type="button" onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-empty">
        <Radio size={24} aria-hidden="true" />
        <h2>Nothing is on the air right now.</h2>
        <p>Try again in a moment, or open the full Feed to browse every station.</p>
      </section>
    );
  }
  if (candidates.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-no-candidates">
        <Radio size={24} aria-hidden="true" />
        <h2>The live stations have no playable signal yet.</h2>
        <p>Metadata can arrive a little after a station comes on air.</p>
      </section>
    );
  }

  return (
    <section className="minimal-radio" data-testid="minimal-radio-surface">
      <div className="minimal-radio__remote" role="group" aria-label="Radio presets and stations">
        <div className="minimal-radio__preset-label">Preset</div>
        <div className="minimal-radio__presets">
          {(["now", "lifetime"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={preset === value ? "is-active" : ""}
              aria-pressed={preset === value}
              onClick={() => onPresetChange(value)}
              data-testid={`radio-preset-${value}`}
            >
              {value === "now" ? "Now" : "Lifetime"}
            </button>
          ))}
        </div>
        <div className="minimal-radio__remote-label">Stations</div>
        <div className="minimal-radio__station-buttons">
          {candidates.map((row, index) => (
            <button
              key={row.ds.station.slug}
              type="button"
              className={selectedIndex === index ? "is-active" : ""}
              aria-pressed={selectedIndex === index}
              onClick={() => setSelectedSlug(row.ds.station.slug)}
              title={`Select ${row.ds.station.name}`}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="minimal-radio__nav" role="group" aria-label="Radio station navigation">
        <button type="button" onClick={() => selectOffset(-1)} aria-label="Previous station">
          <ChevronLeft size={18} aria-hidden="true" /> Previous
        </button>
        <span aria-live="polite">{selectedIndex + 1} of {candidates.length}</span>
        <button type="button" onClick={() => selectOffset(1)} aria-label="Next station">
          Next <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {selected ? (
        <MinimalRadioCard
          key={selected.ds.station.slug}
          row={selected}
          libraryItems={libraryItems}
          onPrevious={() => selectOffset(-1)}
          onNext={() => selectOffset(1)}
        />
      ) : null}
    </section>
  );
}