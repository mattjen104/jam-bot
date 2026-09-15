import { useMemo, useState } from "react";
import type { LibraryItem } from "../lib/meHooks";
import type { DialStation } from "../hooks/useDialData";
import {
  buildDemoRadioSections,
  selectEditorialHighlightStations,
  type DemoStationSort,
} from "../lib/demoRadioOrdering";
import {
  demoStationEvidence,
  missionStationEvidence,
  type DemoStationEvidence,
} from "../lib/demoStationEvidence";
import { StationMark } from "./StationMark";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { usePlayer } from "../player/PlayerProvider";
import { proxyArtUrl } from "../lib/proxyArt";
import { useInlinePreview } from "../player/inlinePreview";
import { toast } from "../hooks/use-toast";
import { compareLibrarySongs, type LibrarySongSort } from "../lib/librarySongOrdering";
import { libraryMatchEvidence, type LibraryMatchFilters } from "../lib/libraryMatchEvidence";
import {
  stationCurationSentence,
  stationLocationAndType,
} from "../lib/stationDisplayMetadata";
import { Link } from "wouter";
import { buildLibraryEntityUrl } from "../lib/libraryFocusedNavigation";

export type DemoSongSort = "added" | "artist" | "album" | "title" | "count";

function RemoteInspector({
  eyebrow,
  title,
  metadata,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  metadata?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <aside className="demo-library-remote__inspector" aria-live="polite">
      <span className="demo-library-remote__inspector-eyebrow">{eyebrow}</span>
      <div className="demo-library-remote__inspector-copy">
        <strong>{title}</strong>
        {metadata ? <span>{metadata}</span> : null}
      </div>
      {children ? <div className="demo-library-remote__inspector-evidence">{children}</div> : null}
    </aside>
  );
}

function StationRemoteTile({
  station,
  selected,
  focusedMatch,
  onPreview,
  onLeave,
  onTune,
}: {
  station: DialStation;
  selected: boolean;
  focusedMatch: boolean;
  onPreview: () => void;
  onLeave: () => void;
  onTune: () => void;
}) {
  const { radio } = usePlayer();
  const playable = resolvePlaybackSource(station.station) !== null;
  return (
    <button
      type="button"
      className={`demo-library-remote__tile demo-library-remote__station${selected ? " is-selected" : ""}${focusedMatch ? " is-focus-match" : ""}`}
      aria-label={`Tune in to ${station.station.name}`}
      aria-pressed={selected}
      title={station.station.name}
      disabled={!playable}
      onMouseEnter={onPreview}
      onMouseLeave={onLeave}
      onFocus={onPreview}
      onBlur={onLeave}
      onPointerDown={() => radio.warmup(station.station)}
      onPointerUp={radio.releaseWarmup}
      onPointerCancel={radio.cancelWarmup}
      onClick={onTune}
      data-testid="demo-station-remote-tile"
    >
      <StationMark
        name={station.station.name}
        iconUrl={station.station.stationIconUrl}
        logoUrl={station.station.logoUrl}
        variant="cube"
        faviconOnly
        className="demo-library-remote__station-mark"
      />
      <span className="demo-library-remote__station-name">{station.station.name}</span>
    </button>
  );
}

function SongRemoteTile({
  item,
  matchFilters,
  onPreview,
  onLeave,
}: {
  item: LibraryItem;
  matchFilters?: LibraryMatchFilters;
  onPreview: () => void;
  onLeave: () => void;
}) {
  const { playingMbid, loadingMbid, toggle } = useInlinePreview();
  const [artFailed, setArtFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const recording = item.recording;
  const title = recording?.title?.trim() || "Unresolved recording";
  const artist = recording?.artist?.trim() || "Unknown artist";
  const artwork = recording?.artworkUrl
    ?? (recording?.releaseGroupMbid
      ? `https://coverartarchive.org/release-group/${recording.releaseGroupMbid}/front-1200`
      : null);
  const proxiedArtwork = proxyArtUrl(artwork) ?? artwork;
  const playable = Boolean(item.mbid && recording);
  const playing = item.mbid != null && playingMbid === item.mbid;
  const loading = item.mbid != null && loadingMbid === item.mbid;
  const matchEvidence = matchFilters ? libraryMatchEvidence(recording, matchFilters) : [];
  return (
    <button
      type="button"
      className={`demo-library-remote__tile demo-library-remote__song${playing ? " is-selected" : ""}${loading ? " is-loading" : ""}${unavailable ? " is-unavailable" : ""}`}
      aria-label={unavailable
        ? `Preview unavailable for ${title} by ${artist}`
        : playing ? `Stop preview of ${title} by ${artist}`
          : loading ? `Loading preview of ${title} by ${artist}`
            : `Preview ${title} by ${artist}`}
      title={unavailable ? "Preview unavailable" : title}
      aria-pressed={playing}
      disabled={!playable || unavailable}
      onMouseEnter={onPreview}
      onMouseLeave={onLeave}
      onFocus={onPreview}
      onBlur={onLeave}
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
      {matchEvidence.length > 0 ? (
        <span className="demo-library-remote__match-dot" aria-hidden="true" />
      ) : null}
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
  if (sort === "artist" || sort === "title" || sort === "added") {
    return [...items].sort((a, b) => compareLibrarySongs(a, b, sort as LibrarySongSort));
  }
  return [...items].sort((a, b) => {
    const ar = a.recording;
    const br = b.recording;
    if (sort === "count") {
      return (artistCounts.get(br?.artist ?? "") ?? 0) - (artistCounts.get(ar?.artist ?? "") ?? 0)
        || (ar?.artist ?? "").localeCompare(br?.artist ?? "")
        || (ar?.title ?? "").localeCompare(br?.title ?? "");
    }
    if (sort === "album") {
      return (ar?.albumTitle ?? "").localeCompare(br?.albumTitle ?? "")
        || (ar?.artist ?? "").localeCompare(br?.artist ?? "")
        || (ar?.title ?? "").localeCompare(br?.title ?? "");
    }
    return Date.parse(b.addedAt) - Date.parse(a.addedAt)
      || (a.mbid ?? a.spotifyId ?? "").localeCompare(b.mbid ?? b.spotifyId ?? "");
  });
}

function EvidenceLinks({
  evidence,
  station,
  onFocusArtist,
  onOpenCrossings,
  returnContext,
}: {
  evidence: DemoStationEvidence;
  station: DialStation;
  onFocusArtist?: (artist: string, artistMbid?: string | null) => void;
  onOpenCrossings?: (slug: string) => void;
  returnContext?: string;
}) {
  if (evidence.kind === "none") return <span>Evidence unavailable</span>;
  return (
    <>
      {evidence.canOpenCrossings && onOpenCrossings ? (
        <button type="button" onClick={() => onOpenCrossings(station.station.slug)}>
          {evidence.lead}
        </button>
      ) : <span>{evidence.lead}</span>}
      {evidence.artists.length ? <span aria-hidden="true"> · </span> : null}
      {evidence.artists.map((artist, index) => (
        <span key={`${artist.artistMbid ?? artist.name}:${index}`}>
          {index ? ", " : null}
          {artist.artistMbid ? (
            <Link
              href={buildLibraryEntityUrl(`/artist/${encodeURIComponent(artist.artistMbid)}`, returnContext, { demoSurface: Boolean(returnContext) })}
              onClick={() => onFocusArtist?.(artist.name, artist.artistMbid)}
            >
              {artist.name}
            </Link>
          ) : onFocusArtist ? (
            <button type="button" onClick={() => onFocusArtist(artist.name, artist.artistMbid)}>
              {artist.name}
            </button>
          ) : artist.name}
        </span>
      ))}
    </>
  );
}

export function DemoStationRemote({
  mode = "all",
  onEnterAllStations,
  stations,
  hasData,
  focusedArtist,
  focusedArtistMbid,
  sort,
  forceAllStations = false,
  onFocusArtist,
  onOpenStationCrossings,
  returnContext,
  broZoneStations = [],
  broZoneLocationLabel = null,
  onRequestBroZoneZip,
  onEnterBroZoneStations,
}: {
  mode?: "highlights" | "all";
  onEnterAllStations?: (sort: "overlap" | "discovery") => void;
  stations: DialStation[];
  hasData: boolean;
  focusedArtist: string | null;
  focusedArtistMbid?: string | null;
  sort: DemoStationSort;
  forceAllStations?: boolean;
  onFocusArtist?: (artist: string, artistMbid?: string | null) => void;
  onOpenStationCrossings?: (slug: string) => void;
  returnContext?: string;
  broZoneStations?: DialStation[];
  broZoneLocationLabel?: string | null;
  onRequestBroZoneZip?: () => void;
  onEnterBroZoneStations?: () => void;
}) {
  const { radio } = usePlayer();
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [touchSlug, setTouchSlug] = useState<string | null>(null);
  const broZoneSlugs = useMemo(
    () => new Set(broZoneStations.map((station) => station.station.slug)),
    [broZoneStations],
  );
  const sectionStations = useMemo(
    () => mode === "highlights"
      ? stations.filter((station) => !broZoneSlugs.has(station.station.slug))
      : stations,
    [broZoneSlugs, mode, stations],
  );
  const sections = useMemo(
    () => buildDemoRadioSections({
      stations: sectionStations,
      hasData,
      focusedArtist,
      focusedArtistMbid,
      sort,
      forceAllStations,
    }),
    [focusedArtist, focusedArtistMbid, forceAllStations, hasData, sectionStations, sort],
  );
  const orderedStations = sections.orderedStations;
  const visibleForYou = mode === "highlights"
    ? sections.crossingStations
      .slice(0, 4)
    : sections.crossingStations;
  const editorialStations = mode === "highlights"
    ? selectEditorialHighlightStations(
      sectionStations,
      new Set([
        ...broZoneSlugs,
        ...visibleForYou.map((station) => station.station.slug),
      ]),
    )
    : [];
  const highlightStations = [
    ...broZoneStations,
    ...visibleForYou,
    ...editorialStations,
  ];
  const missionSlugs = new Set([
    ...sections.rosterStations,
    ...editorialStations,
  ].map((station) => station.station.slug));
  const selectedSlug = radio.station?.slug ?? touchSlug;
  const inspectableStations = mode === "highlights" ? highlightStations : orderedStations;
  const inspected = inspectableStations.find((station) => station.station.slug === previewSlug)
    ?? inspectableStations.find((station) => station.station.slug === selectedSlug)
    ?? inspectableStations[0]
    ?? null;
  const evidence = inspected ? (
    mode === "highlights" && (
      missionSlugs.has(inspected.station.slug)
      || (!focusedArtist && !forceAllStations && sort === "discovery")
    )
      ? missionStationEvidence(inspected)
      : null
  ) ?? demoStationEvidence(
      inspected,
      hasData,
      focusedArtist,
      focusedArtistMbid,
    ) : null;
  const eyebrow = previewSlug ? "Previewing"
    : selectedSlug ? "Tuned station"
      : "Top match";

  return (
    <section className="demo-library-remote" aria-label="Station remote">
      {inspected && evidence ? (
        <RemoteInspector
          eyebrow={eyebrow}
          title={inspected.station.name}
          metadata={stationLocationAndType(inspected.station)}
        >
          <span className="demo-library-remote__curation-sentence">
            {stationCurationSentence(inspected.station)}
          </span>
          {!(mode === "highlights" && evidence.kind === "mission") ? (
            <span className={mode === "highlights" ? "demo-library-remote__secondary-evidence" : undefined}>
              <EvidenceLinks
                evidence={evidence}
                station={inspected}
                onFocusArtist={onFocusArtist}
                onOpenCrossings={onOpenStationCrossings}
                returnContext={returnContext}
              />
            </span>
          ) : null}
          {evidence.liveContext ? <span> · {evidence.liveContext}</span> : null}
        </RemoteInspector>
      ) : null}
      {mode === "highlights" && !focusedArtist ? (
        <>
          {broZoneStations.length > 0 ? (
            <div className="demo-library-remote__grid">
              <div className="demo-library-remote__section-heading">
                <span>{broZoneLocationLabel ? "Near you (& bros)" : "Bro Zone"}</span>
                <span className="demo-radio__section-actions">
                  {onRequestBroZoneZip ? (
                    <button
                      type="button"
                      className="demo-station-section-action"
                      onClick={onRequestBroZoneZip}
                    >
                      {broZoneLocationLabel ? `${broZoneLocationLabel} · Change ZIP` : "Set ZIP"}
                    </button>
                  ) : null}
                  {onEnterBroZoneStations ? (
                    <button
                      type="button"
                      className="demo-station-section-action"
                      onClick={onEnterBroZoneStations}
                    >
                      Browse nearby
                    </button>
                  ) : null}
                </span>
              </div>
              {broZoneStations.slice(0, 1).map((station) => (
                  <StationRemoteTile
                    key={station.station.slug}
                    station={station}
                    selected={selectedSlug === station.station.slug}
                    focusedMatch={false}
                    onPreview={() => setPreviewSlug(station.station.slug)}
                    onLeave={() => setPreviewSlug(null)}
                    onTune={() => {
                      setTouchSlug(station.station.slug);
                      void radio.toggle(station.station);
                    }}
                  />
                ))}
            </div>
          ) : null}
          {sections.crossingStations.length > 0 ? (
            <div className="demo-library-remote__grid demo-library-remote__group--secondary">
              <div className="demo-library-remote__section-heading">
                <span>For you</span>
                {onEnterAllStations && (
                  <button
                    type="button"
                    onClick={() => onEnterAllStations("overlap")}
                    className="demo-station-section-action"
                  >
                    See all {sections.crossingStations.length}
                  </button>
                )}
              </div>
              {visibleForYou.map((station) => (
                <StationRemoteTile
                  key={station.station.slug}
                  station={station}
                  selected={selectedSlug === station.station.slug}
                  focusedMatch={false}
                  onPreview={() => setPreviewSlug(station.station.slug)}
                  onLeave={() => setPreviewSlug(null)}
                  onTune={() => {
                    setTouchSlug(station.station.slug);
                    void radio.toggle(station.station);
                  }}
                />
              ))}
            </div>
          ) : null}
          {editorialStations.length > 0 ? (
            <div className="demo-library-remote__grid demo-library-remote__group--secondary">
              <div className="demo-library-remote__section-heading">
                <span>Try something different</span>
                {onEnterAllStations && (
                  <button
                    type="button"
                    onClick={() => onEnterAllStations("discovery")}
                    className="demo-station-section-action"
                  >
                    Browse all stations
                  </button>
                )}
              </div>
              {editorialStations.map((station) => (
                <StationRemoteTile
                  key={station.station.slug}
                  station={station}
                  selected={selectedSlug === station.station.slug}
                  focusedMatch={false}
                  onPreview={() => setPreviewSlug(station.station.slug)}
                  onLeave={() => setPreviewSlug(null)}
                  onTune={() => {
                    setTouchSlug(station.station.slug);
                    void radio.toggle(station.station);
                  }}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : orderedStations.length > 0 ? (
        <div className="demo-library-remote__grid">
          {orderedStations.map((station, index) => {
            const stationEvidence = missionSlugs.has(station.station.slug)
              || (!focusedArtist && !forceAllStations && sort === "discovery")
              ? missionStationEvidence(station) ?? demoStationEvidence(
                station,
                hasData,
                focusedArtist,
                focusedArtistMbid,
              )
              : demoStationEvidence(
                station,
                hasData,
                focusedArtist,
                focusedArtistMbid,
              );
            return (
              <div key={station.station.slug} style={{ display: "contents" }}>
              {sections.rosterStations.length > 0
                && index === orderedStations.length - sections.rosterStations.length ? (
                  <div className="demo-library-remote__section-label" style={{ gridColumn: "1 / -1", color: "hsl(var(--muted-foreground))", fontFamily: "var(--app-font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", marginTop: 12, marginBottom: 2 }}>Beyond your Library</div>
                ) : null}
              <StationRemoteTile
                station={station}
                selected={selectedSlug === station.station.slug}
                focusedMatch={Boolean(focusedArtist && stationEvidence.rank > 0)}
                onPreview={() => setPreviewSlug(station.station.slug)}
                onLeave={() => setPreviewSlug(null)}
                onTune={() => {
                  setTouchSlug(station.station.slug);
                  void radio.toggle(station.station);
                }}
              />
              </div>
            );
          })}
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
  matchFilters,
  onArtistFocus,
  onAlbumFocus,
  returnContext,
}: {
  items: LibraryItem[];
  sort: DemoSongSort;
  matchFilters?: LibraryMatchFilters;
  onArtistFocus?: (artist: string, artistMbid?: string | null) => void;
  onAlbumFocus?: (album: string) => void;
  returnContext?: string;
}) {
  const { playingMbid, loadingMbid } = useInlinePreview();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const orderedItems = useMemo(() => orderSongs(items, sort), [items, sort]);
  const keyFor = (item: LibraryItem, index: number) =>
    item.mbid ?? item.spotifyId ?? `${item.addedAt}:${index}`;
  const playing = orderedItems.find((item) => item.mbid === playingMbid) ?? null;
  const inspected = orderedItems.find((item, index) => keyFor(item, index) === previewKey)
    ?? playing
    ?? orderedItems[0]
    ?? null;
  const recording = inspected?.recording;
  const evidence = inspected && matchFilters ? libraryMatchEvidence(recording, matchFilters) : [];
  const eyebrow = previewKey ? "Previewing"
    : playingMbid ? "Playing preview"
      : "First result";
  const provenance = inspected
    ? inspected.provenance.kind === "keep" ? "Kept from radio" : "Imported to Library"
    : null;

  return (
    <section className="demo-library-remote" aria-label="Song remote">
      {inspected ? (
        <RemoteInspector
          eyebrow={loadingMbid === inspected.mbid ? "Loading preview" : eyebrow}
          title={inspected.mbid ? (
            <Link href={buildLibraryEntityUrl(`/song/${encodeURIComponent(inspected.mbid)}`, returnContext, { demoSurface: Boolean(returnContext) })}>
              {recording?.title?.trim() || "Unresolved recording"}
            </Link>
          ) : recording?.title?.trim() || "Unresolved recording"}
          metadata={recording?.albumTitle?.trim() || provenance}
        >
          {recording?.artist && recording.artistMbid ? (
            <Link
              href={buildLibraryEntityUrl(`/artist/${encodeURIComponent(recording.artistMbid)}`, returnContext, { demoSurface: Boolean(returnContext) })}
              onClick={() => onArtistFocus?.(recording.artist!, recording.artistMbid)}
            >
              {recording.artist}
            </Link>
          ) : recording?.artist && onArtistFocus ? (
            <button
              type="button"
              onClick={() => onArtistFocus(recording.artist!, recording.artistMbid)}
            >
              {recording.artist}
            </button>
          ) : <span>{recording?.artist || "Unknown artist"}</span>}
          {recording?.albumTitle && recording.releaseGroupMbid ? (
            <>
              <span aria-hidden="true"> · </span>
              <Link
                href={buildLibraryEntityUrl(
                  `/album/${encodeURIComponent(recording.releaseGroupMbid)}${inspected.mbid ? `?track=${encodeURIComponent(inspected.mbid)}` : ""}`,
                  returnContext,
                  { demoSurface: Boolean(returnContext) },
                )}
              >
                {recording.albumTitle}
              </Link>
            </>
          ) : recording?.albumTitle && onAlbumFocus ? (
            <>
              <span aria-hidden="true"> · </span>
              <button
                type="button"
                onClick={() => onAlbumFocus(`${recording.albumTitle}\x1f${recording.artist ?? ""}`)}
              >
                {recording.albumTitle}
              </button>
            </>
          ) : null}
          {evidence.length ? ` · Matches ${evidence.map((fact) => fact.label).join(", ")}` : null}
          {!evidence.length && provenance ? ` · ${provenance}` : null}
        </RemoteInspector>
      ) : null}
      {orderedItems.length > 0 ? (
        <div className="demo-library-remote__grid">
          {orderedItems.map((item, index) => {
            const key = keyFor(item, index);
            return (
              <SongRemoteTile
                key={key}
                item={item}
                matchFilters={matchFilters}
                onPreview={() => setPreviewKey(key)}
                onLeave={() => setPreviewKey(null)}
              />
            );
          })}
        </div>
      ) : (
        <p className="demo-library-remote__empty">No songs in this view.</p>
      )}
    </section>
  );
}