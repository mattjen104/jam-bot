import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Heart, Radio, SkipForward } from "lucide-react";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { LibraryItem } from "../lib/meHooks";
import { useMutationKeep } from "../lib/meHooks";
import { useDialSkipped } from "../lib/dialFilterState";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError, RUMOURS } from "../lib/rumours";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { FilterDropdownMenu } from "./dial/FilterDropdownMenu";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../lib/dialCategories";
import { safeHttpUrl } from "../lib/utils";

export type RadioPreset = "now" | "lifetime";

const STATION_CATEGORY_OPTIONS = STATION_CATEGORY_DEFINITIONS.map(
  ({ cat, label, title }) => ({ value: cat, label, title }),
);

interface MinimalRadioSurfaceProps {
  rows: DialLaneRow[];
  libraryItems: LibraryItem[];
  preset: RadioPreset;
  activeCategories?: ReadonlySet<StationCategory>;
  onToggleCategory?: (category: StationCategory) => void;
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

interface CrossingSummary {
  count: number;
  label: "this set" | "24 hr" | "7d" | "30d" | "lifetime";
}

function crossingSummary(row: DialLaneRow, lifetimeOnly: boolean): CrossingSummary {
  const track = liveTrack(row);
  const liveHit =
    track && !track.resolving && (track.isLibraryHit || track.isArtistHit) ? 1 : 0;
  const summaries: CrossingSummary[] = [
    {
      // The live pulse can arrive before the schedule's show-spin poll, so
      // preserve a current confirmed hit in the "this set" fallback.
      count: Math.max(
        liveHit,
        (row.show?.crossings ?? 0) + (row.show?.artistCrossings ?? 0),
      ),
      label: "this set",
    },
    { count: row.ds.crossings + row.ds.artistCrossings, label: "24 hr" },
    { count: row.ds.weekCrossings + row.ds.weekArtistCrossings, label: "7d" },
    { count: row.ds.monthCrossings + row.ds.monthArtistCrossings, label: "30d" },
    {
      count: row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings,
      label: "lifetime",
    },
  ];
  if (lifetimeOnly) return summaries[summaries.length - 1]!;
  return summaries.find((summary) => summary.count > 0) ?? summaries[summaries.length - 1]!;
}

function StationPresetButton({
  row,
  active,
  onSelect,
  lifetimeOnly,
  testId,
}: {
  row: DialLaneRow;
  active: boolean;
  onSelect: () => void;
  lifetimeOnly: boolean;
  testId?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const safeLogo = safeHttpUrl(row.ds.station.logoUrl);
  const logo = safeLogo ? proxyArtUrl(safeLogo) : null;
  const showLogo = Boolean(logo && !imageFailed);
  const summary = crossingSummary(row, lifetimeOnly);
  const artist = liveTrack(row)?.artist?.trim() || "—";

  return (
    <div
      className="minimal-radio__station-option"
      data-testid={testId}
      role="group"
      aria-label={`${row.ds.station.name} station selection${active ? ", selected" : ""}`}
    >
      <span
        className="minimal-radio__station-crossing"
        data-testid={`minimal-radio-station-meta-${row.ds.station.slug}`}
        aria-label={`${summary.count} ${summary.count === 1 ? "crossing" : "crossings"} ${summary.label}`}
      >
        {summary.count} · {summary.label}
      </span>
      <button
        type="button"
        className={active ? "is-active" : ""}
        aria-pressed={active}
        aria-label={`Select ${row.ds.station.name}`}
        onClick={onSelect}
        title={`Select ${row.ds.station.name}`}
      >
        {showLogo ? (
          <img
            src={logo!}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{row.ds.station.name}</span>
        )}
      </button>
      <span
        className="minimal-radio__station-artist"
        data-testid={`minimal-radio-station-artist-${row.ds.station.slug}`}
        title={artist === "—" ? undefined : artist}
      >
        {artist}
      </span>
    </div>
  );
}

interface CrossingAlbum {
  releaseGroupMbid: string;
  title: string;
  artist: string;
  artworkUrl: string;
}

function crossingAlbums(row: DialLaneRow, libraryItems: LibraryItem[]): CrossingAlbum[] {
  const track = liveTrack(row);
  const crossingSpins = [
    ...(track && !track.resolving && (track.isLibraryHit || track.isArtistHit) ? [track] : []),
    ...[...(row.show?.spins ?? [])]
      .reverse()
      .filter((spin) => !spin.resolving && (spin.isLibraryHit || spin.isArtistHit)),
  ];
  const byMbid = new Map(
    libraryItems
      .filter((item): item is LibraryItem & { mbid: string } => Boolean(item.mbid))
      .map((item) => [item.mbid, item]),
  );
  const byReleaseGroup = new Map(
    libraryItems
      .filter((item) => Boolean(item.recording?.releaseGroupMbid))
      .map((item) => [item.recording!.releaseGroupMbid!, item]),
  );
  const byArtist = new Map<string, LibraryItem[]>();
  for (const item of libraryItems) {
    const recording = item.recording;
    if (!recording?.releaseGroupMbid) continue;
    const key = (recording.artistMbid ?? recording.artist).trim().toLowerCase();
    const matches = byArtist.get(key) ?? [];
    matches.push(item);
    byArtist.set(key, matches);
  }
  const seen = new Set<string>();
  const albums: CrossingAlbum[] = [];
  const add = (item: LibraryItem | undefined, spin?: typeof track) => {
    const recording = item?.recording;
    const releaseGroupMbid = spin?.releaseGroupMbid ?? recording?.releaseGroupMbid;
    if (!releaseGroupMbid || seen.has(releaseGroupMbid)) return;
    seen.add(releaseGroupMbid);
    albums.push({
      releaseGroupMbid,
      title: recording?.albumTitle ?? recording?.title ?? spin?.title ?? "Album",
      artist: recording?.artist ?? spin?.artist ?? "",
      artworkUrl: recording?.artworkUrl
        ?? `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-1200`,
    });
  };

  for (const spin of crossingSpins) {
    if (spin.isLibraryHit) {
      add(
        (spin.releaseGroupMbid ? byReleaseGroup.get(spin.releaseGroupMbid) : undefined)
        ?? (spin.mbid ? byMbid.get(spin.mbid) : undefined),
        spin,
      );
    } else if (spin.isArtistHit) {
      if (spin.releaseGroupMbid) add(byReleaseGroup.get(spin.releaseGroupMbid), spin);
      const artistKey = (spin.artistMbid ?? spin.artist).trim().toLowerCase();
      for (const item of byArtist.get(artistKey) ?? []) add(item);
    }
    if (albums.length >= 5) break;
  }
  return albums.slice(0, 5);
}

function artForTrack(row: DialLaneRow, libraryItems: LibraryItem[]): string | null {
  const track = liveTrack(row);
  if (!track) return null;
  return libraryItems.find((item) => item.mbid === track.mbid)?.recording?.artworkUrl ?? null;
}

function MinimalRadioCard({
  row,
  libraryItems,
  crossing,
}: {
  row: DialLaneRow;
  libraryItems: LibraryItem[];
  crossing: CrossingSummary;
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
    >
      <div className="minimal-radio-card__heading">
        <div className="minimal-radio-card__station">
          <span className="minimal-radio-card__live"><Radio size={13} aria-hidden="true" /> ON AIR</span>
          <h2>{row.ds.station.name}</h2>
          {row.show?.showName ? <p>{row.show.showName}</p> : null}
          <div
            className="minimal-radio-card__crossing"
            data-testid="minimal-radio-hero-crossing"
            aria-label={`${crossing.count} ${crossing.count === 1 ? "crossing" : "crossings"} ${crossing.label}`}
          >
            <strong>{crossing.count}</strong>
            {" "}
            <span>{crossing.count === 1 ? "crossing" : "crossings"}</span>
            {" · "}
            <span>{crossing.label}</span>
          </div>
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
            {albums.map((album) => (
              <a
                key={album.releaseGroupMbid}
                href={`/album/${album.releaseGroupMbid}`}
                className="minimal-radio-card__album"
                title={`${album.title} by ${album.artist}`}
                aria-label={`Open ${album.title} by ${album.artist}`}
              >
                <img
                  src={proxyArtUrl(album.artworkUrl) ?? RUMOURS}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={onArtError}
                />
                <span>{album.title}</span>
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
  activeCategories = new Set<StationCategory>(),
  onToggleCategory,
  loading = false,
  error = false,
  onRetry,
}: MinimalRadioSurfaceProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [lifetimeOnly, setLifetimeOnly] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; stationIndex: number } | null>(null);
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
  const selectedCrossing = selected ? crossingSummary(selected, lifetimeOnly) : null;

  const selectStation = useCallback((index: number) => {
    const next = candidates[index];
    if (!next) return;
    setSelectedSlug(next.ds.station.slug);
  }, [candidates]);

  const selectOffset = useCallback((offset: number) => {
    if (candidates.length === 0) return;
    const nextIndex = (selectedIndex + offset + candidates.length) % candidates.length;
    selectStation(nextIndex);
  }, [candidates.length, selectStation, selectedIndex]);

  const handleRailKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectOffset(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectOffset(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectStation(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectStation(candidates.length - 1);
    }
  }, [candidates.length, selectOffset, selectStation]);

  const handleHeroTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, stationIndex: selectedIndex };
  }, [selectedIndex]);

  const handleHeroTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || candidates.length < 2) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    const offset = deltaX < 0 ? 1 : -1;
    const nextIndex = (start.stationIndex + offset + candidates.length) % candidates.length;
    selectStation(nextIndex);
  }, [candidates.length, selectStation]);

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
      <div className="minimal-radio__controls" role="group" aria-label="Radio presets and stations">
        {onToggleCategory ? (
          <FilterDropdownMenu
            label="Station type"
            ariaLabel="Station categories"
            options={STATION_CATEGORY_OPTIONS}
            active={activeCategories}
            onToggle={onToggleCategory}
            variant="chips"
            className="minimal-radio__category-filter"
          />
        ) : null}
      </div>

      <div
        className="minimal-radio__hero-region"
        data-testid="minimal-radio-hero"
        role="region"
        aria-label="Selected radio station"
        tabIndex={0}
        onKeyDown={handleRailKeyDown}
        onTouchStart={handleHeroTouchStart}
        onTouchEnd={handleHeroTouchEnd}
      >
        <div
          className="minimal-radio__hero-slide"
          data-testid="minimal-radio-hero-slide"
          role="group"
          aria-label={`${selected?.ds.station.name ?? "Current"} now-playing hero`}
        >
          <div className="minimal-radio__nav" role="group" aria-label="Radio station navigation">
            <button type="button" onClick={() => selectOffset(-1)} aria-label="Previous station">
              <ChevronLeft size={18} aria-hidden="true" /> Previous
            </button>
            <span data-testid="minimal-radio-selection" aria-live="polite">
              {selected?.ds.station.name ?? "Current"} · {selectedIndex + 1} of {candidates.length}
            </span>
            <button type="button" onClick={() => selectOffset(1)} aria-label="Next station">
              Next <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>

          {selected && selectedCrossing ? (
            <MinimalRadioCard
              key={selected.ds.station.slug}
              row={selected}
              libraryItems={libraryItems}
              crossing={selectedCrossing}
            />
          ) : null}
        </div>
      </div>

      <div className="minimal-radio__remote-panel">
        <div className="minimal-radio__station-heading">
          <div className="minimal-radio__remote-label">Stations</div>
          <span className="minimal-radio__remote-hint">Choose a station</span>
          <button
            type="button"
            data-testid="radio-preset-lifetime"
            className={`minimal-radio__lifetime-toggle${lifetimeOnly ? " is-active" : ""}`}
            aria-label="Show lifetime crossings"
            aria-pressed={lifetimeOnly}
            onClick={() => setLifetimeOnly((previous) => !previous)}
          >
            {lifetimeOnly ? "Auto" : "Lifetime"}
          </button>
        </div>
        {candidates.length > 1 ? (
          <div
            className="minimal-radio__remote"
            data-testid="minimal-radio-rail"
            role="region"
            aria-label="Radio station remote"
          >
            {candidates.map((row, index) => (
              <StationPresetButton
                key={row.ds.station.slug}
                row={row}
                active={selectedIndex === index}
                onSelect={() => selectStation(index)}
                lifetimeOnly={lifetimeOnly}
                testId={`minimal-radio-station-slide-${row.ds.station.slug}`}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}