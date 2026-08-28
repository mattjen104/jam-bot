import { useMemo, useRef } from "react";
import { Link } from "wouter";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { DialSpin, DialStation } from "../hooks/useDialData";
import type { LibraryItem } from "../lib/meHooks";
import { CrossingScopePill } from "./dial/CrossingScopePill";
import {
  crossingCountForScope,
  crossingScopeLabel,
  type CrossingScope,
} from "../lib/crossingScope";

type DiscoveryTrack = DialSpin & { spinId?: number | null };

interface StableDiscoveryCard {
  cardKey: string;
  track: DiscoveryTrack;
}

interface StableDiscoveryState {
  cards: Map<string, StableDiscoveryCard>;
  order: Array<string | null>;
  crossingScope: CrossingScope;
}

export interface HomeCrossingMetric {
  count: number;
  scope: CrossingScope;
}

const HOME_CROSSING_INTERVALS: readonly CrossingScope[] = [
  "now",
  "set",
  "24h",
  "7d",
  "lifetime",
];

/**
 * "Now" is the narrowest end of the range control. When there is no literal
 * live crossing, retain useful context by widening only as far as needed for
 * this station. Other selected scopes remain exact.
 */
export function homeCrossingMetric(
  ds: DialStation,
  selectedScope: CrossingScope,
): HomeCrossingMetric {
  if (selectedScope !== "now") {
    return { count: crossingCountForScope(ds, selectedScope), scope: selectedScope };
  }
  for (const scope of HOME_CROSSING_INTERVALS) {
    const count = crossingCountForScope(ds, scope);
    if (count > 0) return { count, scope };
  }
  return { count: 0, scope: "lifetime" };
}

/**
 * Identity for the live card, deliberately independent of resolution fields.
 * sourcePlayedAt is the station's play-start observation and stays stable while
 * MusicBrainz/artist enrichment arrives. Text is the fallback for older rows
 * that do not carry the source timestamp.
 */
export function discoveryTrackCardKey(track: DiscoveryTrack): string {
  const sourcePlayedAt = track.sourcePlayedAt?.trim();
  if (sourcePlayedAt) return `source:${sourcePlayedAt}`;
  const artist = track.artist?.trim().toLowerCase() ?? "";
  const title = track.title?.trim().toLowerCase() ?? "";
  if (artist || title) return `text:${artist}|${title}`;
  return `mbid:${track.mbid ?? "unknown"}`;
}

function discoveryTrackTextKey(track: DiscoveryTrack): string {
  const artist = track.artist?.trim().toLowerCase() ?? "";
  const title = track.title?.trim().toLowerCase() ?? "";
  return artist || title ? `${artist}|${title}` : "";
}

export function sameDiscoveryTrackCard(
  previous: DiscoveryTrack,
  current: DiscoveryTrack,
): boolean {
  if (previous.spinId != null && current.spinId != null) {
    return previous.spinId === current.spinId;
  }
  const previousText = discoveryTrackTextKey(previous);
  const currentText = discoveryTrackTextKey(current);
  if (previousText && currentText && previousText === currentText) return true;
  const previousTitle = previous.title?.trim().toLowerCase() ?? "";
  const currentTitle = current.title?.trim().toLowerCase() ?? "";
  if (previousTitle && currentTitle && previousTitle === currentTitle) return true;
  const previousSource = previous.sourcePlayedAt?.trim();
  const currentSource = current.sourcePlayedAt?.trim();
  if (previousSource && currentSource) return previousSource === currentSource;
  return discoveryTrackCardKey(previous) === discoveryTrackCardKey(current);
}

export function reconcileDiscoverySlots(
  previousSlots: Array<string | null>,
  currentOrder: string[],
  lockedSlugs: ReadonlySet<string>,
): Array<string | null> {
  const available = currentOrder.filter((slug) => !lockedSlugs.has(slug));
  let availableIndex = 0;
  const next = previousSlots.map((slug) => {
    if (slug && lockedSlugs.has(slug)) return slug;
    return available[availableIndex++] ?? null;
  });
  return [...next, ...available.slice(availableIndex)];
}

export type DiscoveryProvenance =
  | { kind: "named"; name: string; station: string; stationSlug: string }
  | { kind: "inferred"; name: string; station: string; stationSlug: string }
  | { kind: "claim"; station: string; stationSlug: string }
  | { kind: "unknown"; station: string; stationSlug: string };

export interface CaughtKeep {
  item: LibraryItem;
  artist: string;
  title: string;
  stationName: string;
  stationSlug: string;
  releaseGroupMbid: string | null;
  artistMbid: string | null;
}

export interface HistoricalFallback {
  row: DialLaneRow;
  track: DiscoveryTrack;
  artist: string;
  count: number;
  window: "set" | "24h" | "7d" | "30d" | "lifetime";
}

export function liveTrackForRow(row: DialLaneRow): DiscoveryTrack | null {
  return (row.ds.liveTrack ?? row.show?.currentTrack ?? null) as DiscoveryTrack | null;
}

export function discoveryProvenance(row: DialLaneRow): DiscoveryProvenance {
  const station = row.ds.station.name;
  const stationSlug = row.ds.station.slug;
  const name = row.effectiveDjName ?? row.show?.djName ?? null;
  if (name && row.show?.isPickerShow) {
    return { kind: "named", name, station, stationSlug };
  }
  if (name) {
    return { kind: "inferred", name, station, stationSlug };
  }
  const showName = row.show?.showName?.trim();
  if (showName && showName !== "Unknown" && showName !== "Unknown show") {
    return { kind: "claim", station, stationSlug };
  }
  return { kind: "unknown", station, stationSlug };
}

/** Only explicit keeps with a real station provenance are radio catches. */
export function buildCaughtKeeps(items: LibraryItem[]): CaughtKeep[] {
  return items
    .filter((item) =>
      !item.removed &&
      item.provenance.kind === "keep" &&
      Boolean(item.provenance.stationSlug) &&
      Boolean(item.recording),
    )
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
    .map((item) => ({
      item,
      artist: item.recording!.artist,
      title: item.recording!.title,
      stationName: item.provenance.stationName ?? item.provenance.stationSlug!,
      stationSlug: item.provenance.stationSlug!,
      releaseGroupMbid: item.recording!.releaseGroupMbid ?? null,
      artistMbid: item.recording!.artistMbid ?? null,
    }));
}

export interface HomeKeepGroup {
  key: string;
  albumTitle: string;
  artist: string;
  stationName: string | null;
  count: number;
  releaseGroupMbid: string | null;
  artistMbid: string | null;
}

/** Shape recent radio catches into the album-first rows used by Stack. */
export function buildHomeKeepGroups(catches: CaughtKeep[]): HomeKeepGroup[] {
  const groups = new Map<string, HomeKeepGroup & { stationSlugs: Set<string> }>();
  for (const caught of catches) {
    const key = caught.releaseGroupMbid
      ? `album:${caught.releaseGroupMbid}`
      : `track:${caught.item.mbid ?? `${caught.artist}:${caught.title}`}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.stationSlugs.add(caught.stationSlug);
      if (existing.stationSlugs.size > 1) existing.stationName = null;
      continue;
    }
    groups.set(key, {
      key,
      albumTitle: caught.item.recording?.albumTitle ?? caught.title,
      artist: caught.artist,
      stationName: caught.stationName,
      count: 1,
      releaseGroupMbid: caught.releaseGroupMbid,
      artistMbid: caught.artistMbid,
      stationSlugs: new Set([caught.stationSlug]),
    });
  }
  return [...groups.values()].map(({ stationSlugs: _stationSlugs, ...group }) => group);
}

/**
 * Use the narrowest real history window that contains evidence. Within that
 * window, count wins and the most recent current observation breaks ties.
 */
export function selectHistoricalFallback(rows: DialLaneRow[]): HistoricalFallback | null {
  const candidates = rows
    .map((row) => ({ row, track: liveTrackForRow(row) }))
    .filter((entry): entry is { row: DialLaneRow; track: DiscoveryTrack } => {
      const track = entry.track;
      return track != null && entry.row.ds.isLive &&
        !track.isLibraryHit && !track.isArtistHit;
    });
  const windows: Array<{
    window: HistoricalFallback["window"];
    count: (row: DialLaneRow) => number;
    artists: (row: DialLaneRow) => string[];
  }> = [
    {
      window: "set",
      count: (row) => (row.show?.crossings ?? 0) + (row.show?.artistCrossings ?? 0),
      artists: (row) => [...(row.show?.topArtists ?? []), ...(row.show?.topArtistNames ?? [])],
    },
    {
      window: "24h",
      count: (row) => row.ds.crossings + row.ds.artistCrossings,
      artists: (row) => row.ds.topArtistNames24h,
    },
    {
      window: "7d",
      count: (row) => row.ds.weekCrossings + row.ds.weekArtistCrossings,
      artists: (row) => row.ds.topArtistNames7d,
    },
    {
      window: "30d",
      count: (row) => row.ds.monthCrossings + row.ds.monthArtistCrossings,
      artists: (row) => row.ds.topArtistNamesLifetime,
    },
    {
      window: "lifetime",
      count: (row) => row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings,
      artists: (row) => row.ds.topArtistNamesLifetime,
    },
  ];
  for (const definition of windows) {
    const ranked = candidates
      .map(({ row, track }) => ({
        row,
        track,
        artist: definition.artists(row)[0] ?? "",
        count: definition.count(row),
        window: definition.window,
      }))
      .filter((entry) => entry.count > 0 && entry.artist.length > 0)
      .sort((a, b) =>
        b.count - a.count ||
        Date.parse(b.track.sourcePlayedAt ?? b.track.playedAt) -
          Date.parse(a.track.sourcePlayedAt ?? a.track.playedAt),
      );
    if (ranked[0]) return ranked[0];
  }
  return null;
}

function byline(provenance: DiscoveryProvenance) {
  const station = (
    <Link
      href={`/archive/stations/${provenance.stationSlug}`}
      className="home-discovery__station"
      onClick={(event) => event.stopPropagation()}
    >
      {provenance.station}
    </Link>
  );
  if (provenance.kind === "named") {
    return (
      <>
        <Link
          href={`/dj/${encodeURIComponent(provenance.name)}`}
          className="home-discovery__selector home-discovery__selector--confirmed"
          onClick={(event) => event.stopPropagation()}
        >
          {provenance.name}
        </Link>
        <span> · </span>{station}
      </>
    );
  }
  if (provenance.kind === "inferred") {
    return <><span>{provenance.name} †</span><span> · </span>{station}</>;
  }
  if (provenance.kind === "claim") {
    return <><span>Station claim</span><span> · </span>{station}</>;
  }
  return station;
}

function DiscoveryRow({
  row,
  track,
  active,
  arrived,
  onPlay,
  crossingScope,
}: {
  row: DialLaneRow;
  track: DiscoveryTrack;
  active: boolean;
  arrived: boolean;
  onPlay: () => void;
  crossingScope: CrossingScope;
}) {
  const provenance = discoveryProvenance(row);
  const metric = homeCrossingMetric(row.ds, crossingScope);
  const metricLabel = crossingScopeLabel(metric.scope);
  return (
    <div
      className={`fdrow home-discovery__row${active ? " home-discovery__row--pinned" : ""}${arrived ? " home-discovery__row--arrived" : ""}`}
      role="button"
      tabIndex={0}
      data-testid={`fdrow-${row.ds.station.slug}`}
      data-station-slug={row.ds.station.slug}
      data-recording-id={track.mbid ?? `${track.artist}:${track.title}`}
      data-crossing-count={metric.count}
      data-crossing-scope={metric.scope}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
    >
      <span className="home-discovery__artist">
        {track.artistMbid ? (
          <Link href={`/artist/${track.artistMbid}`} onClick={(event) => event.stopPropagation()}>
            {track.artist || "Artist unknown"}
          </Link>
        ) : track.artist || "Artist unknown"}
      </span>
      <span className="home-discovery__track">{track.title || "Title unknown"}</span>
      <span className={`home-discovery__byline home-discovery__byline--${provenance.kind}`}>
        <span
          className="home-discovery__crossing-count"
          title={`${metric.count} crossings in ${metricLabel}`}
        >
          {metric.count} {metric.count === 1 ? "crossing" : "crossings"} · {metricLabel}
        </span>
        <span aria-hidden="true"> · </span>
        {byline(provenance)}
      </span>
      {active && <span className="home-discovery__pinned">Playing</span>}
    </div>
  );
}

export function HomeDiscovery({
  rows,
  activeSlug,
  onPlay,
  warm,
  libraryItems,
  crossingScope,
  onCycleCrossingScope,
}: {
  rows: DialLaneRow[];
  activeSlug: string | null;
  onPlay: (row: DialLaneRow) => void;
  warm: boolean;
  libraryItems: LibraryItem[];
  crossingScope: CrossingScope;
  onCycleCrossingScope: () => void;
}) {
  const stableDisplayRef = useRef<StableDiscoveryState>({
    cards: new Map(),
    order: [],
    crossingScope,
  });

  const liveRows = useMemo(
    () => rows
      .filter((row) => row.ds.isLive && liveTrackForRow(row))
      .map((row) => ({ row, track: liveTrackForRow(row)! })),
    [rows],
  );

  const orderedLive = useMemo(() => [...liveRows].sort((a, b) => {
    const aMetric = homeCrossingMetric(a.row.ds, crossingScope);
    const bMetric = homeCrossingMetric(b.row.ds, crossingScope);
    if (crossingScope === "now") {
      const intervalDelta =
        HOME_CROSSING_INTERVALS.indexOf(aMetric.scope) -
        HOME_CROSSING_INTERVALS.indexOf(bMetric.scope);
      if (intervalDelta !== 0) return intervalDelta;
    }
    const crossingDelta = bMetric.count - aMetric.count;
    if (crossingDelta !== 0) return crossingDelta;
    if (a.row.ds.station.slug === activeSlug) return -1;
    if (b.row.ds.station.slug === activeSlug) return 1;
    return Date.parse(b.track.sourcePlayedAt ?? b.track.playedAt) -
      Date.parse(a.track.sourcePlayedAt ?? a.track.playedAt);
  }), [liveRows, activeSlug, crossingScope]);

  /**
   * Keep a station in the same slot while its current card is being enriched.
   * Resolution can change crossing flags, MBIDs, and display times; none of
   * those are a card change. A scope change or new source play timestamp is the
   * point at which the current ordering is allowed to settle again.
   */
  const stableDisplay = useMemo(() => {
    const previous = stableDisplayRef.current;
    const nextCards = new Map<string, StableDiscoveryCard>();
    const entriesBySlug = new Map<string, { row: DialLaneRow; track: DiscoveryTrack }>();
    const unchangedSlugs = new Set<string>();

    for (const entry of liveRows) {
      const slug = entry.row.ds.station.slug;
      const cardKey = discoveryTrackCardKey(entry.track);
      const prior = previous.cards.get(slug);
      const sameCard = previous.crossingScope === crossingScope &&
        prior != null && sameDiscoveryTrackCard(prior.track, entry.track);
      if (sameCard) unchangedSlugs.add(slug);
      nextCards.set(slug, {
        cardKey: sameCard ? prior!.cardKey : cardKey,
        track: entry.track,
      });
      entriesBySlug.set(slug, entry);
    }

    const currentOrder = orderedLive.map(({ row }) => row.ds.station.slug);
    const order = reconcileDiscoverySlots(previous.order, currentOrder, unchangedSlugs);

    const nextState = { cards: nextCards, order, crossingScope };
    stableDisplayRef.current = nextState;
    return { ...nextState, entriesBySlug };
  }, [liveRows, orderedLive, crossingScope]);

  const orderedSlots = useMemo(
    () => stableDisplay.order
      .map((slug) => slug ? stableDisplay.entriesBySlug.get(slug) ?? null : null),
    [stableDisplay],
  );
  const visibleStationSlots = orderedSlots.slice(0, 6);

  const catches = buildCaughtKeeps(libraryItems).slice(0, 12);
  const keepGroups = buildHomeKeepGroups(catches);

  return (
    <div className="home-discovery">
      <section className="home-discovery__section" aria-label="On the air">
        <div className="home-discovery__heading-row">
          <h2 className="home-discovery__heading">On the air</h2>
          <CrossingScopePill
            scope={crossingScope}
            enabled
            onCycle={onCycleCrossingScope}
          />
        </div>
        <div className="home-discovery__list">
          {visibleStationSlots.every((entry) => entry == null) ? (
            <p className="home-discovery__empty">Nothing live with confirmed metadata right now.</p>
          ) : visibleStationSlots.map((entry, index) => {
            if (!entry) {
              return (
                <div
                  key={`also-cell-${index}`}
                  className="fdrow home-discovery__row home-discovery__row--vacant"
                  aria-hidden="true"
                />
              );
            }
            const { row, track } = entry;
            return (
              <DiscoveryRow
                key={`also-cell-${index}`}
                row={row}
                track={track}
                crossingScope={crossingScope}
                active={row.ds.station.slug === activeSlug}
                arrived={false}
                onPlay={() => onPlay(row)}
              />
            );
          })}
        </div>
      </section>

      {warm ? (
        <section className="home-discovery__section" aria-label="Last kept">
          <div className="home-discovery__heading-row">
            <h2 className="home-discovery__heading">Last kept</h2>
            <Link href="/library" className="home-discovery__more">Library</Link>
          </div>
          {keepGroups.length === 0 ? (
            <p className="home-discovery__empty">No radio catches yet.</p>
          ) : (
            <div className="home-discovery__keeps">
              {keepGroups.map((group) => (
                <Link
                  key={group.key}
                  href={group.releaseGroupMbid
                    ? `/album/${group.releaseGroupMbid}`
                    : group.artistMbid
                      ? `/artist/${group.artistMbid}`
                      : `/library?q=${encodeURIComponent(group.artist)}`}
                  className={`home-discovery__keep${group.releaseGroupMbid ? "" : " home-discovery__keep--unresolved"}`}
                >
                  <span className="home-discovery__keep-title">{group.albumTitle}</span>
                  <span className="home-discovery__keep-artist">{group.artist}</span>
                  {group.stationName && (
                    <span className="home-discovery__keep-byline">{group.stationName}</span>
                  )}
                  <span className="home-discovery__keep-count">
                    {group.count} kept
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="home-discovery__section home-discovery__library-empty" aria-label="Library">
          <h2 className="home-discovery__heading">Library</h2>
          <p className="home-discovery__empty">Nothing kept yet. Keep a radio catch and it will appear here.</p>
          <button
            type="button"
            className="home-discovery__import"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("lore:open-import-modal", {
                detail: { mode: "artist-seeds" },
              }));
            }}
          >
            Add music
          </button>
        </section>
      )}
    </div>
  );
}