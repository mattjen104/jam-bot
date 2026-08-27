import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { DialSpin } from "../hooks/useDialData";
import type { LibraryItem } from "../lib/meHooks";
import { FirstPlayFeed } from "./CompactDial";

type DiscoveryTrack = DialSpin & { spinId?: number | null };

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
  return <><span>Unknown · no claim</span><span> · </span>{station}</>;
}

function DiscoveryRow({
  row,
  track,
  active,
  arrived,
  onPlay,
}: {
  row: DialLaneRow;
  track: DiscoveryTrack;
  active: boolean;
  arrived: boolean;
  onPlay: () => void;
}) {
  const provenance = discoveryProvenance(row);
  return (
    <div
      className={`fdrow home-discovery__row${active ? " home-discovery__row--pinned" : ""}${arrived ? " home-discovery__row--arrived" : ""}`}
      role="button"
      tabIndex={0}
      data-testid={`fdrow-${row.ds.station.slug}`}
      data-station-slug={row.ds.station.slug}
      data-recording-id={track.mbid ?? `${track.artist}:${track.title}`}
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
        {byline(provenance)}
      </span>
      {active && <span className="home-discovery__pinned">Playing</span>}
    </div>
  );
}

function FallbackRow({ fallback, onPlay }: {
  fallback: HistoricalFallback;
  onPlay: () => void;
}) {
  return (
    <div
      className="fdrow home-discovery__row home-discovery__row--fallback"
      role="button"
      tabIndex={0}
      data-testid={`fdrow-${fallback.row.ds.station.slug}`}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
    >
      <span className="home-discovery__artist">{fallback.track.artist || "Artist unknown"}</span>
      <span className="home-discovery__track">{fallback.track.title || "Title unknown"}</span>
      <span className="home-discovery__byline home-discovery__byline--fallback">
        {fallback.row.ds.station.name} · Live now · tune in · {fallback.window} history: {fallback.artist} ({fallback.count})
      </span>
    </div>
  );
}

export function HomeDiscovery({
  rows,
  activeSlug,
  onPlay,
  warm,
  libraryItems,
}: {
  rows: DialLaneRow[];
  activeSlug: string | null;
  onPlay: (row: DialLaneRow) => void;
  warm: boolean;
  libraryItems: LibraryItem[];
}) {
  const [crossingOrder, setCrossingOrder] = useState<string[]>([]);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  const knownKeys = useRef(new Set<string>());

  const liveRows = useMemo(
    () => rows
      .filter((row) => row.ds.isLive && liveTrackForRow(row))
      .map((row) => ({ row, track: liveTrackForRow(row)! })),
    [rows],
  );
  const crossingRows = useMemo(
    () => liveRows.filter(({ track }) => track.isLibraryHit || track.isArtistHit),
    [liveRows],
  );
  const crossingByKey = useMemo(
    () => new Map(crossingRows.map(({ row, track }) => [
      `${row.ds.station.slug}:${track.mbid ?? `${track.artist}:${track.title}`}`,
      { row, track },
    ])),
    [crossingRows],
  );

  useEffect(() => {
    const current = [...crossingByKey.keys()];
    const fresh = current.filter((key) => !knownKeys.current.has(key));
    knownKeys.current = new Set(current);
    setCrossingOrder((previous) => [
      ...previous.filter((key) => crossingByKey.has(key)),
      ...fresh,
    ]);
    if (fresh.length > 0) {
      setArrivals((previous) => new Set([...previous, ...fresh]));
      const timer = window.setTimeout(() => {
        setArrivals((previous) => {
          const next = new Set(previous);
          fresh.forEach((key) => next.delete(key));
          return next;
        });
      }, 700);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [crossingByKey]);

  const orderedCrossings = crossingOrder
    .map((key) => crossingByKey.get(key))
    .filter((entry): entry is { row: DialLaneRow; track: DiscoveryTrack } => Boolean(entry));
  const generalRows = liveRows.filter(({ row, track }) => {
    const key = `${row.ds.station.slug}:${track.mbid ?? `${track.artist}:${track.title}`}`;
    return !crossingByKey.has(key);
  });
  const orderedGeneral = [...generalRows].sort((a, b) => {
    if (a.row.ds.station.slug === activeSlug) return -1;
    if (b.row.ds.station.slug === activeSlug) return 1;
    return Date.parse(b.track.sourcePlayedAt ?? b.track.playedAt) -
      Date.parse(a.track.sourcePlayedAt ?? a.track.playedAt);
  });
  const catches = buildCaughtKeeps(libraryItems).slice(0, 12);
  const fallback = warm && orderedCrossings.length === 0
    ? selectHistoricalFallback(rows)
    : null;
  const fallbackSlug = fallback?.row.ds.station.slug ?? null;
  const alsoOnAir = fallbackSlug
    ? orderedGeneral.filter(({ row }) => row.ds.station.slug !== fallbackSlug)
    : orderedGeneral;
  const displayRows = warm ? alsoOnAir : orderedGeneral;
  const heading = warm ? "Also on the air" : "On the air";

  return (
    <div className="home-discovery">
      {warm && (
        <section className="home-discovery__section" aria-label="Crossing now">
          <h2 className="home-discovery__heading">Crossing now</h2>
          <div className="home-discovery__list">
            {orderedCrossings.length > 0 ? orderedCrossings.map(({ row, track }) => {
              const key = `${row.ds.station.slug}:${track.mbid ?? `${track.artist}:${track.title}`}`;
              return <DiscoveryRow key={key} row={row} track={track} active={row.ds.station.slug === activeSlug} arrived={arrivals.has(key)} onPlay={() => onPlay(row)} />;
            }) : fallback ? (
              <FallbackRow fallback={fallback} onPlay={() => onPlay(fallback.row)} />
            ) : (
              <p className="home-discovery__empty">No library artist is live right now.</p>
            )}
          </div>
        </section>
      )}

      <section className="home-discovery__section" aria-label={heading}>
        <h2 className="home-discovery__heading">{heading}</h2>
        <div className="home-discovery__list">
          {displayRows.length === 0 ? (
            <p className="home-discovery__empty">Nothing live with confirmed metadata right now.</p>
          ) : displayRows.map(({ row, track }) => {
            const key = `${row.ds.station.slug}:${track.mbid ?? `${track.artist}:${track.title}`}`;
            return <DiscoveryRow key={key} row={row} track={track} active={row.ds.station.slug === activeSlug} arrived={false} onPlay={() => onPlay(row)} />;
          })}
        </div>
      </section>

      <FirstPlayFeed />

      {warm ? (
        <section className="home-discovery__section" aria-label="Last kept">
          <div className="home-discovery__heading-row">
            <h2 className="home-discovery__heading">Last kept</h2>
            <Link href="/library" className="home-discovery__more">Library</Link>
          </div>
          {catches.length === 0 ? (
            <p className="home-discovery__empty">No radio catches yet.</p>
          ) : (
            <div className="home-discovery__keeps">
              {catches.map((caught) => (
                <Link
                  key={caught.item.mbid ?? caught.item.addedAt}
                  href={caught.releaseGroupMbid
                    ? `/album/${caught.releaseGroupMbid}`
                    : caught.artistMbid
                      ? `/artist/${caught.artistMbid}`
                      : `/library?q=${encodeURIComponent(caught.artist)}`}
                  className={`home-discovery__keep${caught.releaseGroupMbid ? "" : " home-discovery__keep--unresolved"}`}
                >
                  <span className="home-discovery__keep-title">{caught.title}</span>
                  <span className="home-discovery__keep-artist">{caught.artist}</span>
                  <span className="home-discovery__keep-byline">Kept from {caught.stationName}</span>
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