import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { StationCategory } from "../lib/dialCategories";
import { STATION_CATEGORY_DEFINITIONS } from "../lib/dialCategories";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { readPins, togglePin } from "../hooks/useDialData";
import { usePlayer } from "../player/PlayerProvider";
import {
  adaptiveListeningCopy,
  importProgressLabel,
  isConfirmedCrossing,
  type AdaptiveListeningState,
} from "../lib/adaptiveListening";

interface AdaptiveNowProps {
  rows: DialLaneRow[];
  state: AdaptiveListeningState;
  importJob?: {
    status: "pending" | "running" | "done" | "error";
    phase: "fetching" | "spine" | "cache" | "resolve" | null;
    total: number;
    resolved: number;
  } | null;
  activeCategories: ReadonlySet<StationCategory>;
  supportOnly: boolean;
  onToggleCategory: (category: StationCategory) => void;
  onSetCategories: (categories: ReadonlySet<StationCategory>) => void;
  onToggleSupport: () => void;
}

function trackFor(row: DialLaneRow) {
  return row.ds.liveTrack ?? row.show?.currentTrack ?? null;
}

function categoryFor(row: DialLaneRow): StationCategory | null {
  const value = row.ds.station.stationCategories?.[0] as StationCategory | undefined;
  return value && STATION_CATEGORY_DEFINITIONS.some((definition) => definition.cat === value)
    ? value
    : null;
}

function reasonFor(row: DialLaneRow, state: AdaptiveListeningState): string {
  const track = trackFor(row);
  if (state === "crossing-ready" && isConfirmedCrossing(track)) {
    return track?.isLibraryHit ? "Exact record crossing" : "Artist crossing";
  }
  if (row.show?.isPickerShow && row.show.showName) return row.show.showName;
  if (row.show?.showName && row.show.showName !== "Unknown show") return row.show.showName;
  if (row.ds.crossings > 0 || row.ds.artistCrossings > 0) return "Recent station overlap";
  return "A strong place to start";
}

function Row({
  row,
  state,
  onInspect,
}: {
  row: DialLaneRow;
  state: AdaptiveListeningState;
  onInspect: (row: DialLaneRow) => void;
}) {
  const { radio } = usePlayer();
  const track = trackFor(row);
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const active = radio.station?.slug === row.ds.station.slug;
  const playing = active && radio.status === "playing";
  const artist = track?.artist?.trim() || "Live metadata unavailable";
  const title = track?.title?.trim();

  return (
    <article className={`adaptive-now__row${active ? " is-active" : ""}`} data-testid="adaptive-now-row">
      <button
        type="button"
        className="adaptive-now__play"
        disabled={!playable}
        onPointerDown={() => radio.warmup(row.ds.station)}
        onPointerUp={radio.releaseWarmup}
        onPointerCancel={radio.cancelWarmup}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") radio.cancelWarmup();
        }}
        onClick={() => { if (playable) void radio.toggle(row.ds.station); }}
        aria-label={playing ? `Pause ${row.ds.station.name}` : `Tune in to ${row.ds.station.name}`}
      >
        {playing ? "Pause" : "Tune live"}
      </button>
      <button
        type="button"
        className="adaptive-now__body"
        onClick={() => onInspect(row)}
        aria-label={`Inspect ${row.ds.station.name}`}
      >
        <span className="adaptive-now__reason">{reasonFor(row, state)}</span>
        <strong>{row.ds.station.name}</strong>
        <span className="adaptive-now__track">
          {title ? `${artist} · ${title}` : artist}
        </span>
      </button>
      {active ? <span className="adaptive-now__active" aria-label="Current station">On air</span> : null}
    </article>
  );
}

function StationDetail({
  row,
  followed,
  onToggleFollow,
  onClose,
}: {
  row: DialLaneRow;
  followed: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
}) {
  const { radio } = usePlayer();
  const track = trackFor(row);
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const isCurrent = radio.station?.slug === row.ds.station.slug;
  const freshness = track?.sourcePlayedAt ?? track?.playedAt;

  return (
    <aside className="adaptive-now__detail" role="dialog" aria-label={`${row.ds.station.name} station details`}>
      <div className="adaptive-now__detail-heading">
        <div>
          <span className="adaptive-now__eyebrow">Station detail</span>
          <h2>{row.ds.station.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close station details">Close</button>
      </div>
      <p className="adaptive-now__detail-track">
        {track ? `${track.artist} · ${track.title}` : "Live track details are not available yet."}
      </p>
      <p className="adaptive-now__detail-meta">
        {row.show?.showName && row.show.showName !== "Unknown show" ? `Show: ${row.show.showName}` : "Show context unavailable"}
        {freshness ? ` · observed ${new Date(freshness).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
      </p>
      <div className="adaptive-now__detail-actions">
        <button
          type="button"
          disabled={!playable}
          onPointerDown={() => radio.warmup(row.ds.station)}
          onPointerUp={radio.releaseWarmup}
          onPointerCancel={radio.cancelWarmup}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") radio.cancelWarmup();
          }}
          onClick={() => { if (playable) void radio.toggle(row.ds.station); }}
        >
          {isCurrent && radio.status === "playing" ? "Pause broadcast" : "Tune live"}
        </button>
        <button type="button" onClick={onToggleFollow}>
          {followed ? "Following station" : "Follow station"}
        </button>
        <Link href="/feed" onClick={onClose}>Explore this station in Feed</Link>
      </div>
    </aside>
  );
}

export function AdaptiveNow({
  rows,
  state,
  importJob,
  activeCategories,
  supportOnly,
  onToggleCategory,
  onSetCategories,
  onToggleSupport,
}: AdaptiveNowProps) {
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inspected, setInspected] = useState<DialLaneRow | null>(null);
  const [followedSlugs, setFollowedSlugs] = useState<Set<string>>(() => readPins());
  const copy = adaptiveListeningCopy(state);
  const progress = importProgressLabel(importJob);
  const visibleRows = useMemo(() => {
    const sorted = [...rows]
      .filter((row) => !supportOnly || Boolean(row.ds.station.donateUrl))
      .filter((row) => activeCategories.size === 0 || activeCategories.has(categoryFor(row)!))
      .sort((a, b) => {
        const aCross = Number(isConfirmedCrossing(trackFor(a)));
        const bCross = Number(isConfirmedCrossing(trackFor(b)));
        return bCross - aCross
          || ((b.ds.crossings + b.ds.artistCrossings) - (a.ds.crossings + a.ds.artistCrossings))
          || a.ds.station.name.localeCompare(b.ds.station.name);
      });
    return expanded ? sorted : sorted.slice(0, 6);
  }, [activeCategories, expanded, rows, supportOnly]);
  const totalRows = useMemo(
    () => rows.filter((row) => !supportOnly || Boolean(row.ds.station.donateUrl))
      .filter((row) => activeCategories.size === 0 || activeCategories.has(categoryFor(row)!)).length,
    [activeCategories, rows, supportOnly],
  );
  const crossingCount = rows.filter((row) => isConfirmedCrossing(trackFor(row))).length;

  return (
    <section className="adaptive-now" data-testid="adaptive-now" aria-labelledby="adaptive-now-heading">
      <header className="adaptive-now__header">
        <div>
          <p className="adaptive-now__eyebrow">{copy.eyebrow}</p>
          <h2 id="adaptive-now-heading">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="adaptive-now__context" data-testid="adaptive-now-context">
          {usePlayerStatusLabel()}
        </div>
      </header>
      {progress ? <p className="adaptive-now__progress" role="status">{progress}</p> : null}
      {state === "crossing-ready" && crossingCount > 0 ? (
        <p className="adaptive-now__evidence" data-testid="adaptive-now-crossing-evidence">
          {crossingCount} confirmed live {crossingCount === 1 ? "crossing" : "crossings"} ready
        </p>
      ) : null}

      <div className="adaptive-now__filters" aria-label="Now filters">
        <button
          type="button"
          className={activeCategories.size === 0 ? "is-active" : ""}
          aria-pressed={activeCategories.size === 0}
          onClick={() => onSetCategories(new Set())}
        >
          All <span>{rows.length}</span>
        </button>
        {STATION_CATEGORY_DEFINITIONS.map((definition) => {
          const count = rows.filter((row) => categoryFor(row) === definition.cat).length;
          return (
            <button
              key={definition.cat}
              type="button"
              className={activeCategories.has(definition.cat) ? "is-active" : ""}
              aria-pressed={activeCategories.has(definition.cat)}
              onClick={() => onToggleCategory(definition.cat)}
            >
              {definition.shortLabel} <span>{count}</span>
            </button>
          );
        })}
        <button type="button" className={supportOnly ? "is-active" : ""} aria-pressed={supportOnly} onClick={onToggleSupport}>
          Support
        </button>
      </div>

      <div className="adaptive-now__list">
        {visibleRows.length > 0 ? visibleRows.map((row) => (
          <Row key={row.ds.station.slug} row={row} state={state} onInspect={setInspected} />
        )) : <p className="adaptive-now__empty">No stations match these filters. Choose All to reopen the dial.</p>}
      </div>
      <div className="adaptive-now__footer">
        <span>Showing {visibleRows.length} of {totalRows} eligible stations</span>
        {totalRows > 6 ? (
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show fewer stations" : `More stations (${totalRows - 6})`}
          </button>
        ) : null}
        <button type="button" onClick={() => setPickerOpen(true)}>Switch station</button>
        <Link href="/feed">Explore the full Feed</Link>
        <Link href="/library">Open Stack</Link>
      </div>
      {inspected ? (
        <StationDetail
          row={inspected}
          followed={followedSlugs.has(inspected.ds.station.slug)}
          onToggleFollow={() => {
            const slug = inspected.ds.station.slug;
            togglePin(slug);
            setFollowedSlugs(readPins());
          }}
          onClose={() => setInspected(null)}
        />
      ) : null}
      {pickerOpen ? (
        <StationPicker
          rows={[...rows]
            .filter((row) => !supportOnly || Boolean(row.ds.station.donateUrl))
            .filter((row) => activeCategories.size === 0 || activeCategories.has(categoryFor(row)!))}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}

function usePlayerStatusLabel(): string {
  const { radio, ride } = usePlayer();
  if (ride.current && ride.sourceLabel) return `${ride.sourceLabel} · ${ride.current.title}`;
  if (radio.station) return `Live broadcast · ${radio.station.name}`;
  return "Nothing playing";
}

function StationPicker({ rows, onClose }: { rows: DialLaneRow[]; onClose: () => void }) {
  const { radio } = usePlayer();
  const currentSlug = radio.station?.slug ?? null;
  const ordered = [...rows].sort((a, b) =>
    Number(b.ds.station.slug === currentSlug) - Number(a.ds.station.slug === currentSlug)
    || a.ds.station.name.localeCompare(b.ds.station.name));

  return (
    <aside className="adaptive-now__picker" role="dialog" aria-label="Switch live station">
      <header>
        <div>
          <span className="adaptive-now__eyebrow">Station picker</span>
          <h2>Switch without leaving Now</h2>
          <p>{ordered.length} eligible stations · current station stays first</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="adaptive-now__picker-list">
        {ordered.map((row) => {
          const current = row.ds.station.slug === currentSlug;
          const track = trackFor(row);
          return (
            <button
              key={row.ds.station.slug}
              type="button"
              className={current ? "is-current" : ""}
              onPointerDown={() => radio.warmup(row.ds.station)}
              onPointerUp={radio.releaseWarmup}
              onPointerCancel={radio.cancelWarmup}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") radio.cancelWarmup();
              }}
              onClick={() => {
                if (resolvePlaybackSource(row.ds.station)) void radio.toggle(row.ds.station);
                onClose();
              }}
            >
              <strong>{row.ds.station.name}</strong>
              <span>{track?.artist?.trim() || "Live metadata unavailable"}</span>
              {current ? <em>Current</em> : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}