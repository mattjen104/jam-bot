/**
 * DialView — the Dial Radio timeline.
 *
 * Manages a level state machine (all → station → show → dj) and renders the
 * appropriate view at each level. The bottom pill-nav (Radio · Selectors ·
 * Library) lives in AppLayout; DialView renders the topbar/scanbar/subnav
 * chrome above the scroll body.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useDialData, normalizeDjName, type DialStation, type DialShow, type DialSpin } from "../hooks/useDialData";
import { useMyGhostMissed, useSpotifyLibraryConnected, startSpotifyLibraryConnect, type GhostStation } from "../lib/meHooks";
import { useFrontDoorScan } from "../hooks/useFrontDoorScan";
import { StationLane } from "./StationLane";
import { ContextRail } from "./ContextRail";
import { SearchOverlay } from "./SearchOverlay";
import { usePlayer } from "../player/PlayerProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a version of `value` that only flips to `true` after it has been
 * `true` continuously for `delayMs` milliseconds.  Flipping back to `false`
 * is immediate, so skeleton rows vanish the instant real data arrives.
 *
 * Usage: avoids a jarring flash of skeleton rows on fast connections where
 * the loading state resolves in under ~150 ms.
 */
function useDelayedBoolean(value: boolean, delayMs = 150): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }
    const id = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return delayed;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtHM(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m}${ampm}`;
}

function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type Level = "all" | "station" | "show" | "dj";

// ---------------------------------------------------------------------------
// Reason-ladder helpers (spec §3, §9)
// ---------------------------------------------------------------------------

/** How far into the current show the set started */
function intoSet(startedAt: string): string {
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Oxford-comma list with ≤3 full names; 4+ collapses to "A, B, C and N more" */
/** Renders a list of artist names with each name in its own {@code <b>}
 *  so the CSS amber colour applies only to the names, not the separators. */
function nameNodes(artists: string[]): ReactNode {
  if (artists.length === 0) return null;
  const shown = artists.slice(0, 3);
  const rest  = artists.length - shown.length;
  const nodes: ReactNode[] = [];
  shown.forEach((name, i) => {
    if (i > 0) nodes.push(i === shown.length - 1 && rest === 0 ? " and " : ", ");
    nodes.push(<b key={i}>{name}</b>);
  });
  if (rest > 0) nodes.push(` and ${rest} more`);
  return <>{nodes}</>;
}

interface ReasonResult { r: number; cls: string; node: ReactNode }

/** One sentence per rung; returns the strongest rung that applies (spec §3).
 *
 * r values are consecutive integers — no gaps, no shared values:
 *   r=1 — exact library track playing right now             (Zone 1, warm)
 *   r=2 — library artist playing right now (live, SSE-fresh)(Zone 1, warm)
 *   r=3 — exact library tracks already aired this show      (Zone 1, warm)
 *   r=4 — library artists aired this show, no exact match   (Zone 1, warm)
 *   r=5 — attributed show on air, no crossing evidence yet  (Zone 3, dim)
 *   r=6 — 24h station exact crossings, no selector listed   (Zone 3, dim)
 *   r=7 — 24h station artist crossings, no exact hits       (Zone 3, dim)
 *   r=0 — dark: Lore has no now-playing data                (Zone 3, dim)
 *
 * Zone boundary: r >= 1 && r <= 4 → Zone 1 ("with a reason").
 *                r === 0 || r >= 5 → Zone 3 ("also on air", dimmed).
 */
function reason(
  show: DialShow | null,
  stationCrossings: number,
  stationArtistCrossings = 0,
): ReasonResult {
  if (!show) return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };

  // r=1: exact library track playing right now
  if (show.currentTrack?.isLibraryHit) {
    return {
      r: 1, cls: "w1",
      node: <>◆ playing <b>{show.currentTrack.title}</b> — in your library</>,
    };
  }

  // r=2: library artist playing right now (not an exact track match).
  // The live track hasn't been logged into spins yet (SSE lag), so
  // show.artistCrossings won't include it — check currentTrack directly.
  if (show.currentTrack?.isArtistHit) {
    return {
      r: 2, cls: "w2",
      node: <>playing <b>{show.currentTrack.artist}</b> — an artist from your library</>,
    };
  }

  // r=3: exact library tracks already aired this show
  if (show.crossings > 0) {
    const nn = show.topArtists.length > 0 ? nameNodes(show.topArtists) : null;
    return {
      r: 3, cls: "w3",
      node: nn
        ? <>{nn} already this set</>
        : <><b>{show.crossings} of yours</b> already this set</>,
    };
  }

  // r=4: library artists aired this show, no exact track match
  if (show.artistCrossings > 0) {
    const nn = show.topArtistNames.length > 0 ? nameNodes(show.topArtistNames) : null;
    return {
      r: 4, cls: "w4",
      node: nn
        ? <>{nn} — an artist from your library</>
        : <><b>{show.artistCrossings}</b> tracks by artists from your library</>,
    };
  }

  // r=5: attributed show on air, no crossing evidence yet
  if (show.djName) {
    return { r: 5, cls: "w5", node: `on air · ${intoSet(show.startedAt)} into the set` };
  }

  // r=6: 24h station exact crossings (no selector listed)
  if (stationCrossings > 0) {
    return {
      r: 6, cls: "w6",
      node: <><b>{stationCrossings} of yours</b> here in the last 24h — no selector listed</>,
    };
  }

  // r=7: 24h station artist crossings (no exact hits, no selector listed)
  if (stationArtistCrossings > 0) {
    return {
      r: 7, cls: "w7",
      node: <><b>{stationArtistCrossings}</b> tracks by your artists here in the last 24h</>,
    };
  }

  // r=0: dark — nothing to go on
  return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };
}

// ---------------------------------------------------------------------------
// Front-door scan hook (spec §11)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Front-door row (spec §8, §9, §13)
// ---------------------------------------------------------------------------

interface FrontDoorRowProps {
  ds: DialStation;
  show: DialShow | null;
  ov: number;          // lifetime selector overlap (attributed) or 24h crossings (unattributed)
  isActive: boolean;
  isSampling: boolean;
  onTuneIn: () => void;
  onEarlier: () => void;
}

export function FrontDoorRow({ ds, show, ov, isActive, isSampling, onTuneIn, onEarlier }: FrontDoorRowProps) {
  const rz = reason(show, ds.crossings, ds.artistCrossings);

  // Tier 2: DJ name. Non-human stations (i.e. automationClass === 'automated')
  // have no reliable human host — suppress the fallback slot so an automated
  // period doesn't surface a stale DJ name implying a DJ is still on air.
  // The schema only allows 'human' | 'automated' | null; 'mixed' is resolved
  // server-side and never appears in API responses.
  const isNonHumanStation = ds.station.automationClass != null && ds.station.automationClass !== "human";
  const liveDjName = show?.djName ?? null;
  // When the station is live but no schedule run has attached yet (run creation
  // lags the first logged spin by up to a few minutes), fall back to the most
  // recently-ended show's DJ name so the slot doesn't silently disappear.
  // A 4-hour cutoff prevents surfacing a stale name from a prior day's show.
  const fallbackDjName = !isNonHumanStation && liveDjName === null
    ? (() => {
        const CUTOFF_MS = 4 * 60 * 60 * 1000;
        const now = Date.now();
        return ds.shows
          .filter(sh => sh.djName != null && sh.state !== "future" && (now - new Date(sh.endedAt).getTime()) < CUTOFF_MS)
          .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())[0]
          ?.djName ?? null;
      })()
    : null;
  const djName = liveDjName ?? fallbackDjName;

  // Tier 3: [showName ·] station.name — destination label only.
  // Collapse showName when null or any "unknown show" variant.
  const rawShow = show?.showName ?? null;
  const showName = rawShow && rawShow.toLowerCase() !== "unknown show" ? rawShow : null;

  const currentTrack = show?.currentTrack ?? null;

  // T3 carries the ♪ track note only for Zone 1 crossing rows (r=3/r=4) where
  // the reason mentions artist names — not the current track title. All other
  // rungs either already have the title in the reason (r=1) or get a more
  // prominent bare-fact slot below (Zone 3: r=0/r≥5).
  const showTrackInT3 = (rz.r === 3 || rz.r === 4) && currentTrack !== null;
  // Zone 3 rows get a standalone bare-fact track line, more legible than T3.
  const showBareTrack = (rz.r === 0 || rz.r >= 5) && currentTrack !== null;

  const tier3Text = [showName, ds.station.name].filter(Boolean).join(" · ");
  const tier3Node = showTrackInT3 ? (
    <>
      {tier3Text}
      {" · "}
      <span className="fdrow__t3-live">♪</span>
      {` ${currentTrack!.title}`}
    </>
  ) : (
    <>{tier3Text}</>
  );

  const rowCls = [
    "fdrow",
    rz.r === 1 ? "fdrow--t1" : "",
    rz.r >= 2 && rz.r <= 4 ? "fdrow--z1" : "",
    rz.r === 0 || rz.r >= 5 ? "fdrow--dim" : "",
    isSampling ? "fdrow--sampling" : "",
    isActive ? "fdrow--playing" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={rowCls}
      role="button"
      tabIndex={0}
      onClick={onTuneIn}
      onKeyDown={(e) => e.key === "Enter" && onTuneIn()}
    >
      <div className="fdrow__c">
        {/* Tier 1: reason sentence — leads at full display weight */}
        <div className={`fdrow__t1 ${rz.cls}`}>{rz.node}</div>

        {/* Tier 2: human DJ name when known. Never rendered for automated stations. */}
        {djName && (
          <div className="fdrow__t2">
            {djName}
            {ov > 0 && <span className="fdrow__t2-ov">{ov}</span>}
          </div>
        )}

        {/* Tier 3: show · station — small identity label */}
        <div className="fdrow__t3">{tier3Node}</div>

        {/* Bare track: Zone 3 rows only — a legible plain fact, not a caption */}
        {showBareTrack && (
          <div className="fdrow__bare-track">
            {currentTrack!.isFirstSpin && <span className="fdrow__bare-track__new" title="First time in the archive">◈ </span>}
            {currentTrack!.title}
          </div>
        )}

        {/* Footer: station is always in Tier 3, so we never need to repeat it */}
        <div className="fdrow__foot">
          <button
            type="button"
            className="fdrow__back"
            onClick={(e) => { e.stopPropagation(); onEarlier(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onEarlier(); } }}
          >
            ↩ earlier
          </button>
        </div>
      </div>
    </div>
  );
}

interface GhostRowProps {
  station: GhostStation;
  isActive: boolean;
  onTuneIn: () => void;
}
function ZoneLabel({ label, n, hint, accent, estimated, collapsed, onCollapse }: {
  label: string;
  n?: number;
  hint?: string;
  accent?: "library" | "picker" | "live";
  /** When true, renders the count with a leading ~ to signal it's a pre-load estimate */
  estimated?: boolean;
  /** When true, the zone is fully collapsed (no rows shown) */
  collapsed?: boolean;
  /** When provided, renders a collapse/expand toggle button on the label */
  onCollapse?: () => void;
}) {
  return (
    <div className={`fdzone-lbl${collapsed ? " fdzone-lbl--collapsed" : ""}`}>
      {accent && <span className={`fdzone-lbl__pip fdzone-lbl__pip--${accent}`} />}
      <span className="fdzone-lbl__text">{label}</span>
      {n != null && (
        <span className={`fdzone-lbl__n${accent === "picker" ? " fdzone-lbl__n--picker" : ""}${estimated ? " fdzone-lbl__n--est" : ""}`}>
          {estimated ? `~${n}` : n}
        </span>
      )}
      {hint && !collapsed && <span className="fdzone-lbl__hint">{hint}</span>}
      {onCollapse != null && (
        <button
          type="button"
          className="fdzone-lbl__collapse"
          aria-label={collapsed ? "Expand zone" : "Collapse zone"}
          aria-expanded={!collapsed}
          onClick={(e) => { e.stopPropagation(); onCollapse(); }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-zone visible-row budgets (truncation defaults).
// Zone distribution over a representative 7-day window (scripts/zoneDistribution.ts):
//   Zone 1 p50≈4  p90≈9  max≈18
//   Zone 3 p50≈3  p90≈7  max≈12
// Zone 1 p90 > 5, so truncation is worth shipping.
// ---------------------------------------------------------------------------
const ZONE1_VISIBLE = 5;
const ZONE2_VISIBLE = 3;
const ZONE3_VISIBLE = 3;

// ---------------------------------------------------------------------------
// Stations list view
// ---------------------------------------------------------------------------
function StationsListView({
  stations,
  onStationClick,
}: {
  stations: DialStation[];
  onStationClick: (slug: string) => void;
}) {
  return (
    <div>
      {stations.map((ds) => (
        <div
          key={ds.station.slug}
          className="dial-stn-row"
          onClick={() => onStationClick(ds.station.slug)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onStationClick(ds.station.slug)}
        >
          <span className={`dial-stn-dot${ds.isLive ? " dial-stn-dot--live" : ""}`} />
          <div className="dial-stn-info">
            <div className="dial-stn-name">{ds.station.name}</div>
            {ds.shows.length > 0 && ds.shows[ds.shows.length - 1].showName && (
              <div className="dial-stn-now">
                {ds.shows[ds.shows.length - 1].showName}
                {ds.shows[ds.shows.length - 1].djName && (
                  <> · <b>{ds.shows[ds.shows.length - 1].djName}</b></>
                )}
              </div>
            )}
          </div>
          <div className={`dial-stn-cross${ds.crossings === 0 ? " dial-stn-cross--zero" : ""}`}>
            <span className="dial-stn-cross__num">{ds.crossings > 0 ? `◆ ${ds.crossings}` : "—"}</span>
            <span className="dial-stn-cross__lbl">crossings</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Station detail (fat-block list)
// ---------------------------------------------------------------------------
function StationDetailView({
  dialStation,
  onShowClick,
}: {
  dialStation: DialStation;
  onShowClick: (show: DialShow) => void;
}) {
  const shows = [...dialStation.shows].reverse(); // newest first

  return (
    <div className="dial-fat-list">
      {shows.map((show, i) => {
        const isLive = show.state === "live";
        const isPast = show.state === "past";
        const isFuture = show.state === "future";
        const warm = show.crossings > 0 && !isFuture;
        const isPicker = show.isPickerShow;

        const bars = show.spins.slice(0, 28).map((sp, j) => (
          <i key={j} className={sp.isLibraryHit ? "dial-fbar__hit" : ""} />
        ));

        const first = show.spins.find((sp) => sp.isLibraryHit);
        const when = `${fmtHM(show.startedAt)}–${isLive ? "now" : fmtHM(show.endedAt)} · ${agoLabel(isLive ? show.endedAt : show.endedAt)}`;

        let cls = "dial-fatblk";
        if (isLive) cls += " dial-fatblk--live";
        if (isFuture) cls += " dial-fatblk--future";
        if (warm && !isPicker && !isFuture) cls += " dial-fatblk--warm";
        if (isPicker && !isFuture) cls += " dial-fatblk--picker";

        return (
          <div key={show.runId ?? i} className={cls} onClick={() => onShowClick(show)} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onShowClick(show)}>
            <div className="dial-fatblk__top">
              <div className="dial-fatblk__show">{show.showName}</div>
              <div className="dial-fatblk__when">{when}</div>
            </div>
            {(show.djName || isPicker) && (
              <div className="dial-fatblk__dj">
                {show.djName && <>with <b>{show.djName}</b></>}
                {isPicker && <span className="dial-fatblk__pickerbadge">◆ Selector</span>}
              </div>
            )}
            {!isFuture && (
              <>
                <div className="dial-fbar">{bars}</div>
                <div className={`dial-fatblk__cross${show.crossings === 0 ? " dial-fatblk__cross--zero" : ""}`}>
                  {show.crossings} of {show.spins.length} were yours
                </div>
                {first && (
                  <div className="dial-fatblk__peek">
                    opened with{" "}
                    <span className="dial-fatblk__peek-hit">
                      {first.artist} — {first.title}
                    </span>
                  </div>
                )}
              </>
            )}
            {isFuture && (
              <div className="dial-fatblk__cross dial-fatblk__cross--zero" style={{ marginTop: 8 }}>
                scheduled · no data yet
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Show tracklist view
// ---------------------------------------------------------------------------
function ShowTracklistView({
  show,
  station,
  allStationsData: allStations,
  onDjClick,
}: {
  show: DialShow;
  station: DialStation;
  allStationsData: DialStation[];
  onDjClick: (name: string) => void;
}) {
  const isLive = show.state === "live";
  const isPicker = show.isPickerShow;
  const djFirst = show.djName ? show.djName.split(" ")[0] : "DJ";

  // Count how many sets this DJ has across all stations in today's data
  const sameSetCount = allStations
    .flatMap((ds) => ds.shows)
    .filter((sh) => sh.djName === show.djName && sh !== show).length;

  return (
    <div>
      <div className="dial-djhd">
        <div className="dial-djhd__name">{show.showName}</div>
        <div className="dial-djhd__sub">
          {show.djName && <><b style={{ fontStyle: "normal", fontWeight: 600 }}>{show.djName}</b>{" · "}</>}
          {station.station.name} · {fmtHM(show.startedAt)}{isLive ? "–now" : `–${fmtHM(show.endedAt)}`}
        </div>
        <div className="dial-djhd__stats">
          <div className="dial-djhd__stat">
            <b>{show.spins.length}</b>spins
          </div>
          <div className="dial-djhd__stat dial-djhd__stat--warm">
            <b>{show.crossings}</b>yours
          </div>
          <div className="dial-djhd__stat">
            <b>{sameSetCount + 1}</b>sets logged
          </div>
        </div>
        {isPicker && (
          <div className="dial-pickerbadge">◆ Selector — high overlap DJ</div>
        )}
        {show.djName && (
          <button
            type="button"
            className="dial-dj-chip"
            onClick={() => onDjClick(show.djName!)}
          >
            All of {djFirst}'s sets →
          </button>
        )}
      </div>

      <div className="dial-sec-lbl">
        In order
        <span className="dial-sec-lbl__hint">tap to ride from here</span>
      </div>

      {show.spins.map((sp, i) => (
        <div key={i} className={`dial-trow${sp.isLibraryHit ? " dial-trow--hit" : ""}`}>
          <div className="dial-trow__time">{fmtHM(sp.playedAt)}</div>
          <div className="dial-trow__content">
            <div className="dial-trow__title">{sp.title}</div>
            <div className="dial-trow__artist">{sp.artist}</div>
          </div>
          <div className={`dial-trow__badge dial-trow__badge--${sp.isLibraryHit ? "own" : "new"}`}>
            {sp.isLibraryHit ? "◆ library" : "new"}
          </div>
        </div>
      ))}

      {show.spins.length === 0 && (
        <div className="dial-sec-lbl" style={{ opacity: 0.4 }}>No spins recorded</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DJ view
// ---------------------------------------------------------------------------
function DjView({
  djName,
  allStations,
  onShowClick,
}: {
  djName: string;
  allStations: DialStation[];
  onShowClick: (show: DialShow, station: DialStation) => void;
}) {
  const djSets = allStations
    .flatMap((ds) => ds.shows.map((sh) => ({ show: sh, station: ds })))
    .filter(({ show }) => show.djName === djName && show.state !== "future")
    .sort((a, b) => new Date(a.show.startedAt).getTime() - new Date(b.show.startedAt).getTime());

  const totalSpins = djSets.reduce((sum, { show }) => sum + show.spins.length, 0);
  const totalCross = djSets.reduce((sum, { show }) => sum + show.crossings, 0);
  const overlapPct = totalSpins > 0 ? Math.round((totalCross / totalSpins) * 100) : 0;
  const isPicker = djSets.some(({ show }) => show.isPickerShow);
  const stationNames = [...new Set(djSets.map(({ station }) => station.station.name))];

  return (
    <div>
      <div className="dial-djhd">
        <div className="dial-djhd__name">{djName}</div>
        <div className="dial-djhd__sub">{stationNames.join(" · ")}</div>
        <div className="dial-djhd__stats">
          <div className="dial-djhd__stat"><b>{djSets.length}</b>sets</div>
          <div className="dial-djhd__stat"><b>{totalSpins}</b>spins</div>
          <div className="dial-djhd__stat dial-djhd__stat--warm"><b>{totalCross}</b>yours</div>
          <div className="dial-djhd__stat"><b>{overlapPct}%</b>overlap</div>
        </div>
        {isPicker && (
          <div className="dial-pickerbadge">◆ Selector — consistently finds your music</div>
        )}
      </div>

      <div className="dial-sec-lbl">
        Every set in archive
        <span className="dial-sec-lbl__hint">oldest first</span>
      </div>

      <div className="dial-fat-list">
        {djSets.map(({ show, station }, i) => {
          const bars = show.spins.slice(0, 28).map((sp, j) => (
            <i key={j} className={sp.isLibraryHit ? "dial-fbar__hit" : ""} />
          ));
          return (
            <div
              key={show.runId ?? i}
              className={`dial-fatblk${show.state === "live" ? " dial-fatblk--live" : ""}${show.crossings > 0 ? " dial-fatblk--warm" : ""}`}
              onClick={() => onShowClick(show, station)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onShowClick(show, station)}
            >
              <div className="dial-fatblk__top">
                <div className="dial-fatblk__show">{show.showName}</div>
                <div className="dial-fatblk__when">{station.station.name} · {agoLabel(show.endedAt)}</div>
              </div>
              <div className="dial-fatblk__dj">with <b>{show.djName}</b></div>
              <div className="dial-fbar">{bars}</div>
              <div className={`dial-fatblk__cross${show.crossings === 0 ? " dial-fatblk__cross--zero" : ""}`}>
                {show.crossings} of {show.spins.length} were yours
              </div>
            </div>
          );
        })}
        {djSets.length === 0 && (
          <div style={{ padding: "20px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 12 }}>
            No sets archived for today
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scan bar
// ---------------------------------------------------------------------------
interface ScanBarProps {
  stations: DialStation[];
  level: Level;
  currentStation: DialStation | null;
  currentShow: DialShow | null;
  currentDj: string | null;
  onPlay: (ds: DialStation) => void;
}

function useScanState(cands: Array<{ sp: DialSpin; show: DialShow; station: DialStation }>) {
  const [scanning, setScanning] = useState(false);
  const [sampling, setSampling] = useState<{ sp: DialSpin; show: DialShow; station: DialStation } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idxRef = useRef(0);

  const stopScan = useCallback(() => {
    setScanning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startScan = useCallback(() => {
    if (!cands.length) return;
    setScanning(true);
    idxRef.current = 0;
    const hop = () => {
      setSampling(cands[idxRef.current % cands.length]);
      idxRef.current++;
    };
    hop();
    timerRef.current = setInterval(hop, 3000);
  }, [cands]);

  const land = useCallback((onLand?: (s: { sp: DialSpin; show: DialShow; station: DialStation }) => void) => {
    stopScan();
    // sampling is kept as-is after land; fire the callback with the frozen sample
    setSampling((current) => {
      if (current && onLand) onLand(current);
      return current;
    });
  }, [stopScan]);

  const toggle = useCallback(() => {
    if (scanning) stopScan();
    else startScan();
  }, [scanning, stopScan, startScan]);

  // Stop scan when candidates change (e.g. level changes)
  useEffect(() => { stopScan(); setSampling(null); }, [cands.length]); // eslint-disable-line

  return { scanning, sampling, toggle, land, stopScan };
}

function ScanBar({
  stations,
  level,
  currentStation,
  currentShow,
  currentDj,
  onPlay,
}: ScanBarProps) {
  // Collect library-crossing candidates for the current scope
  const cands = useMemo(() => {
    const hits: Array<{ sp: DialSpin; show: DialShow; station: DialStation }> = [];
    if (level === "show" && currentShow) {
      for (const sp of currentShow.spins) {
        if (sp.isLibraryHit) {
          hits.push({ sp, show: currentShow, station: currentStation! });
        }
      }
    } else if (level === "station" && currentStation) {
      for (const show of currentStation.shows) {
        if (show.state === "future") continue;
        const sp = show.spins.find((s) => s.isLibraryHit);
        if (sp) hits.push({ sp, show, station: currentStation });
      }
    } else if (level === "dj" && currentDj) {
      for (const ds of stations) {
        for (const show of ds.shows) {
          if (show.djName !== currentDj || show.state === "future") continue;
          const sp = show.spins.find((s) => s.isLibraryHit);
          if (sp) hits.push({ sp, show, station: ds });
        }
      }
    } else {
      // all — crossings from every station
      for (const ds of stations) {
        for (const show of ds.shows) {
          if (show.state === "future") continue;
          const sp = show.spins.find((s) => s.isLibraryHit);
          if (sp) hits.push({ sp, show, station: ds });
        }
      }
    }
    return hits;
  }, [stations, level, currentStation, currentShow, currentDj]);

  const { scanning, sampling, toggle, land } = useScanState(cands);

  const ctxLabel =
    level === "show" && currentShow ? currentShow.showName :
    level === "station" && currentStation ? currentStation.station.name :
    level === "dj" && currentDj ? currentDj :
    "All stations";

  return (
    <div className="dial-scanbar">
      <button
        type="button"
        className={`dial-scanbtn${scanning ? " dial-scanbtn--on" : ""}`}
        onClick={toggle}
      >
        {scanning ? "Stop" : "Scan"}
      </button>

      <div className="dial-scantrack">
        {sampling ? (
          <>
            <div className="dial-scantrack__name">{sampling.sp.title} · {sampling.sp.artist}</div>
            <div className="dial-scantrack__by">{sampling.show.djName} · {sampling.show.showName} · {sampling.station.station.name}</div>
          </>
        ) : (
          <div className="dial-scantrack__idle">
            <b>{ctxLabel}</b> — {cands.length} stop{cands.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`dial-landbtn${sampling ? " dial-landbtn--show" : ""}`}
        onClick={() => land((s) => onPlay(s.station))}
      >
        Land
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule view (simple list of today's shows sorted by station/time)
// ---------------------------------------------------------------------------
function ScheduleView({ stations }: { stations: DialStation[] }) {
  const allShows = stations
    .flatMap((ds) => ds.shows.map((sh) => ({ show: sh, station: ds })))
    .sort((a, b) => new Date(a.show.startedAt).getTime() - new Date(b.show.startedAt).getTime());

  const pastAndLive = allShows.filter(({ show }) => show.state !== "future");
  const upcoming = allShows.filter(({ show }) => show.state === "future");

  const SectionLabel = ({ label }: { label: string }) => (
    <div className="dial-sec-lbl" style={{ paddingTop: 16 }}>{label}</div>
  );

  const ShowRow = ({ show, station }: { show: import("../hooks/useDialData").DialShow; station: DialStation }) => {
    const isLive = show.state === "live";
    const isFuture = show.state === "future";
    const warm = show.crossings > 0 && !isFuture;
    return (
      <div className={`dial-sch-row${isLive ? " dial-sch-row--live" : ""}${warm ? " dial-sch-row--warm" : ""}${isFuture ? " dial-sch-row--future" : ""}`}>
        <div className="dial-sch-time">{fmtHM(show.startedAt)}</div>
        <div className="dial-sch-info">
          <div className="dial-sch-show">{show.showName}</div>
          {show.djName && <div className="dial-sch-dj"><b>{show.djName}</b></div>}
          <div className="dial-sch-stn">{station.station.name}</div>
        </div>
        <div className="dial-sch-badge">
          {isLive && <span className="dial-sch-badge--live">● Live</span>}
          {isFuture && <span style={{ color: "hsl(var(--faint))", fontSize: 8 }}>Soon</span>}
          {!isLive && !isFuture && warm && <span className="dial-sch-badge--cross">◆ {show.crossings}</span>}
          {show.isPickerShow && <span className="dial-sch-badge--sel">Selector</span>}
        </div>
      </div>
    );
  };

  return (
    <div>
      {pastAndLive.length === 0 && upcoming.length === 0 && (
        <div style={{ padding: "24px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 12 }}>
          No show data for today
        </div>
      )}
      {pastAndLive.length > 0 && (
        <>
          <SectionLabel label="Today so far" />
          {pastAndLive.map(({ show, station }, i) => <ShowRow key={i} show={show} station={station} />)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <SectionLabel label="Coming up" />
          {upcoming.map(({ show, station }, i) => <ShowRow key={i} show={show} station={station} />)}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offline station row — reason-first layout matching FrontDoorRow's three-tier
// reading order: reason / what was aired → DJ attribution → station label.
// ---------------------------------------------------------------------------
function OfflineRow({
  dialStation,
  isActive,
  onStationClick,
  onPlay,
}: {
  dialStation: DialStation;
  isActive: boolean;
  onStationClick: () => void;
  onPlay: () => void;
}) {
  const { station, shows, crossings, artistCrossings } = dialStation;
  // Most recent non-future show (shows are sorted oldest→newest)
  const lastShow = [...shows].reverse().find((sh) => sh.state !== "future") ?? null;
  // Most recent spin in that show
  const lastSpin = lastShow && lastShow.spins.length > 0
    ? lastShow.spins[lastShow.spins.length - 1]
    : null;

  // ── Tier 1: reason — what was aired ──────────────────────────────────────
  // Mirror the live reason() rungs adapted for past context:
  //   crossings (exact library hits) → w3 warm
  //   artist crossings only          → w4 warm
  //   last track title (bare fact)   → w5 dim
  //   no data                        → w0 very dim
  let t1Node: ReactNode;
  let t1Cls: string;
  if (crossings > 0) {
    const topArtists = lastShow?.topArtists ?? [];
    const nn = topArtists.length > 0 ? nameNodes(topArtists) : null;
    t1Node = nn
      ? <>{nn} aired here</>
      : <><b>{crossings} of yours</b> aired here</>;
    t1Cls = "w3";
  } else if (artistCrossings > 0) {
    const topArtistNames = lastShow?.topArtistNames ?? [];
    const nn = topArtistNames.length > 0 ? nameNodes(topArtistNames) : null;
    t1Node = nn
      ? <>{nn} — an artist from your library</>
      : <><b>{artistCrossings}</b> tracks by your artists here</>;
    t1Cls = "w4";
  } else if (lastSpin) {
    t1Node = (
      <>
        {lastSpin.isFirstSpin && <span className="fdrow__bare-track__new">◈ </span>}
        {lastSpin.title}
      </>
    );
    t1Cls = "w5";
  } else {
    t1Node = "no recent data";
    t1Cls = "w0";
  }

  // ── Tier 2: DJ attribution (omit unknown show) ────────────────────────────
  const djName = lastShow?.djName ?? null;
  // Suppress "Unknown show" — never surface it
  const showName = lastShow?.showName && lastShow.showName.toLowerCase() !== "unknown show"
    ? lastShow.showName
    : null;

  // ── Tier 3: station destination label ────────────────────────────────────
  const t3Text = showName ? `${showName} · ${station.name}` : station.name;

  const hasCrossings = crossings > 0 || artistCrossings > 0;
  const rowCls = [
    "fdrow",
    hasCrossings ? "fdrow--z1" : "fdrow--dim",
    isActive ? "fdrow--playing" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={rowCls}
      role="button"
      tabIndex={0}
      onClick={onStationClick}
      onKeyDown={(e) => e.key === "Enter" && onStationClick()}
    >
      <div className="fdrow__c">
        {/* Tier 1: reason sentence — leads at full display weight */}
        <div className={`fdrow__t1 ${t1Cls}`}>{t1Node}</div>

        {/* Tier 2: human DJ name when known */}
        {djName && (
          <div className="fdrow__t2">{djName}</div>
        )}

        {/* Tier 3: show · station — small identity label */}
        <div className="fdrow__t3">{t3Text}</div>
      </div>

      <button
        type="button"
        className={`dial-lane__play${isActive ? " dial-lane__play--on" : ""}`}
        onClick={(e) => { e.stopPropagation(); onPlay(); }}
        aria-label={isActive ? `Stop ${station.name}` : `Play ${station.name}`}
      >
        {isActive ? "■" : "▶"}
      </button>
    </div>
  );
}

export function DialView() {
  const [location] = useLocation();
  const [level, setLevel] = useState<Level>("all");
  const [currentStationSlug, setCurrentStationSlug] = useState<string | null>(null);
  const [currentShow, setCurrentShow] = useState<DialShow | null>(null);
  const [currentDjName, setCurrentDjName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const { stations, isLoading, isCoreLoading, liveLoading, crossingsLoading, hasLibrary, overlapByPickerId, pickerNameToId } = useDialData();
  // Delay skeleton visibility so fast loads (< 150 ms) never flash shimmer rows.
  // The delayed flag only flips true after crossingsLoading has been true for
  // 150 ms; it resets to false immediately when crossingsLoading clears so that
  // real content replaces skeletons without any extra lag.
  const showSkeleton = useDelayedBoolean(crossingsLoading, 150);
  const isSpotifyConnected = useSpotifyLibraryConnected();
  const { radio } = usePlayer();

  // Picker overlap lookup — pickerId-first, normalised-name bridge fallback.
  // Both maps come from useDialData (same fetch, no double network call).
  function pickerOv(pickerId: number | null, djName: string | null): number {
    if (pickerId != null) return overlapByPickerId.get(pickerId) ?? 0;
    if (djName != null) {
      const pid = pickerNameToId.get(normalizeDjName(djName));
      if (pid != null) return overlapByPickerId.get(pid) ?? 0;
    }
    return 0;
  }

  const currentStation = useMemo(
    () => stations.find((ds) => ds.station.slug === currentStationSlug) ?? null,
    [stations, currentStationSlug],
  );

  // --- navigation helpers ---
  const goAll = useCallback(() => { setLevel("all"); setCurrentShow(null); setCurrentDjName(null); }, []);
  const goStation = useCallback((slug: string) => { setCurrentStationSlug(slug); setLevel("station"); setCurrentShow(null); }, []);
  const goShow = useCallback((show: DialShow, station: DialStation) => {
    setCurrentStationSlug(station.station.slug);
    setCurrentShow(show);
    setLevel("show");
  }, []);
  const goDj = useCallback((name: string) => { setCurrentDjName(name); setLevel("dj"); }, []);

  // --- attribution-ladder sort (spec §4) ---
  // One live entry per stream (show and station are 1:1 at any instant — §5)
  const sortedRows = useMemo(() => {
    const FALLBACK_CUTOFF_MS = 4 * 60 * 60 * 1000;
    const now = Date.now();
    return [...stations]
      .filter((ds) => ds.isLive)
      .map((ds) => {
        const show = ds.shows.find((sh) => sh.state === "live") ?? null;
        const rz = reason(show, ds.crossings, ds.artistCrossings);
        // Mirror the fallback-DJ logic from FrontDoorRow so the sort key matches
        // what the row actually displays. The server resolves 'mixed' to
        // 'human'/'automated' at query time, so 'mixed' is never received here.
        const isNonHuman = ds.station.automationClass != null && ds.station.automationClass !== "human";
        const liveDjName = show?.djName ?? null;
        const fallbackDjName = !isNonHuman && liveDjName === null
          ? ds.shows
              .filter((sh) => sh.djName != null && sh.state !== "future" && (now - new Date(sh.endedAt).getTime()) < FALLBACK_CUTOFF_MS)
              .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())[0]
              ?.djName ?? null
          : null;
        const effectiveDjName = liveDjName ?? fallbackDjName;
        return { ds, show, rz, effectiveDjName };
      })
      .sort((a, b) => {
        // 1. Live crossing (rung 1) floats to the very top
        const ac = a.rz.r === 1 ? 0 : 1;
        const bc = b.rz.r === 1 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        // 2. Lifetime overlap desc — attributed rows use pickerId-first overlap
        //    (falling back to normalised-name bridge when no pickerId is linked);
        //    unattributed rows use lifetime station crossings so both axes are
        //    comparable (all-time vs all-time, not lifetime vs 24h). Both values
        //    are now count(distinct mbid) so the scale is identical to pickerOv().
        const aOv = a.effectiveDjName != null ? pickerOv(a.show?.pickerId ?? null, a.effectiveDjName) : a.ds.lifetimeCrossings;
        const bOv = b.effectiveDjName != null ? pickerOv(b.show?.pickerId ?? null, b.effectiveDjName) : b.ds.lifetimeCrossings;
        if (aOv !== bOv) return bOv - aOv;
        // 3. Attribution tier as tiebreaker within the same overlap band
        const at = a.effectiveDjName != null ? 0 : 1;
        const bt = b.effectiveDjName != null ? 0 : 1;
        if (at !== bt) return at - bt;
        // 4. Rung asc as final tiebreaker
        return a.rz.r - b.rz.r;
      });
  }, [stations, overlapByPickerId, pickerNameToId]);

  // Three zones (spec §6)
  // Zone 1: r=1..4 — has crossing evidence (warm).
  // Zone 3: r=0 or r>=5 — attributed-only or dark (dimmed).
  const withReason = useMemo(() => sortedRows.filter((row) => row.rz.r >= 1 && row.rz.r <= 4), [sortedRows]);
  const alsoOnAir = useMemo(() => sortedRows.filter((row) => row.rz.r === 0 || row.rz.r >= 5), [sortedRows]);
  // Ghost zone: stations that played library artists but user hasn't tuned into
  const { data: ghostStations = [] } = useMyGhostMissed();
  // Exclude any ghost station already appearing in Zone 1 or Zone 3 (live sets)
  const liveSlugSet = useMemo(
    () => new Set(sortedRows.map((r) => r.ds.station.slug)),
    [sortedRows],
  );
  const ghost = useMemo(
    () => ghostStations.filter((g) => !liveSlugSet.has(g.slug)),
    [ghostStations, liveSlugSet],
  );

  // Offline stations (recently aired):
  //   1. Crossings desc — library matches first
  //   2. Stations with any show history above stations with no data ever
  //      (prevents "NO DATA TODAY" stations from clogging the top of the list)
  //   3. Stable within each tier
  const offlineStations = useMemo(() =>
    [...stations]
      .filter((ds) => !ds.isLive)
      .sort((a, b) => {
        if (b.crossings !== a.crossings) return b.crossings - a.crossings;
        const aHas = a.shows.length > 0 ? 1 : 0;
        const bHas = b.shows.length > 0 ? 1 : 0;
        return bHas - aHas;
      }),
    [stations],
  );

  // Render cap — start with 40 rows, expand on demand. Prevents mounting
  // 500+ StationLane components at once when the user hasn't scrolled there.
  const OFFLINE_PAGE = 40;
  const [visibleOfflineCount, setVisibleOfflineCount] = useState(OFFLINE_PAGE);
  const visibleOffline = useMemo(
    () => offlineStations.slice(0, visibleOfflineCount),
    [offlineStations, visibleOfflineCount],
  );

  // --- per-zone truncation (spec §16) ---
  // Zone 1: rung-1 rows are never hidden — expand the budget to cover them all.
  const rung1Count = useMemo(() => withReason.filter((r) => r.rz.r === 1).length, [withReason]);
  const zone1Visible = Math.max(Math.min(ZONE1_VISIBLE, 7), rung1Count);

  const [zone1Expanded, setZone1Expanded] = useState(false);
  const [zone2Expanded, setZone2Expanded] = useState(false);
  const [zone3Expanded, setZone3Expanded] = useState(false);

  // Collapsed state — session-only. A collapsed zone shows only the ZoneLabel
  // header (no rows, no see-more button).  Distinct from expanded: collapsed=true
  // hides even the default N-row truncated view.
  const [zone1Collapsed, setZone1Collapsed] = useState(false);
  const [zone2Collapsed, setZone2Collapsed] = useState(false);
  const [zone3Collapsed, setZone3Collapsed] = useState(false);

  // Slug-key strings — order-insensitive (sorted) so a live reorder of the same
  // stations does NOT reset expansion; only a real membership change does.
  const zone1SlugKey = useMemo(() => withReason.map((r) => r.ds.station.slug).sort().join(","), [withReason]);
  const zone2SlugKey = useMemo(() => ghost.map((g) => g.slug).sort().join(","), [ghost]);
  const zone3SlugKey = useMemo(() => alsoOnAir.map((r) => r.ds.station.slug).sort().join(","), [alsoOnAir]);

  // Reset expansion AND collapse when zone membership genuinely changes (not on every re-render).
  useEffect(() => { setZone1Expanded(false); setZone1Collapsed(false); }, [zone1SlugKey]);
  useEffect(() => { setZone2Expanded(false); setZone2Collapsed(false); }, [zone2SlugKey]);
  useEffect(() => { setZone3Expanded(false); setZone3Collapsed(false); }, [zone3SlugKey]);

  // --- front-door scan (spec §11) ---
  const scan = useFrontDoorScan(withReason.length);

  // Play each sample as scan advances — uses radio.preview() so no listen event
  // is written to the journal or server ledger (spec §11).
  const prevSamplingIdx = useRef<number | null>(null);
  useEffect(() => {
    if (scan.scanning && scan.samplingIdx != null && scan.samplingIdx !== prevSamplingIdx.current) {
      prevSamplingIdx.current = scan.samplingIdx;
      const row = withReason[scan.samplingIdx];
      if (row) void radio.preview(row.ds.station);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.scanning, scan.samplingIdx]);

  // Auto-expand Zone 1 when the scan cursor advances into a hidden row so the
  // highlighted station is always visible.  setZone1Expanded(true) when already
  // true is a React no-op (no re-render), so the dependency on zone1Visible alone
  // is safe.  Also un-collapse so the scanning station is never hidden.
  useEffect(() => {
    if (scan.samplingIdx != null && scan.samplingIdx >= zone1Visible) {
      setZone1Expanded(true);
      setZone1Collapsed(false);
    }
  }, [scan.samplingIdx, zone1Visible]);

  // Top row for Listen button label (spec §10)
  const topRow = sortedRows[0] ?? null;
  const topLabel = topRow?.show?.djName
    ? `${topRow.show.djName} · ${topRow.ds.station.name}`
    : (topRow?.ds.station.name ?? "—");

  const tuneTop = useCallback(() => {
    if (topRow) {
      scan.stop();
      void radio.toggle(topRow.ds.station);
    }
  }, [topRow, scan, radio]);

  const handleScanLand = useCallback(() => {
    const idx = scan.samplingIdx;
    if (idx != null && withReason[idx]) {
      scan.land();
      void radio.toggle(withReason[idx].ds.station);
    } else {
      scan.land();
    }
  }, [scan, withReason, radio]);

  // --- topbar ---
  function renderTopbar() {
    if (level === "all") {
      // Minimal header — action bar carries the primary actions (§10)
      return (
        <div className="dial-topbar">
          <span className="dial-topbar__wordmark">Lore</span>
          <button
            type="button"
            className="dial-topbar__search"
            onClick={() => setSearchOpen(true)}
            aria-label="Search stations, selectors, shows"
            title="Search"
          >
            🔍
          </button>
        </div>
      );
    }
    if (level === "station" && currentStation) {
      return (
        <div className="dial-topbar">
          <button type="button" className="dial-topbar__crumb" onClick={goAll}>Radio</button>
          <span className="dial-topbar__sep">›</span>
          <span className="dial-topbar__title dial-topbar__title--active">{currentStation.station.name}</span>
          <button type="button" className="dial-topbar__back" onClick={goAll}>↑ Back</button>
        </div>
      );
    }
    if (level === "show" && currentShow && currentStation) {
      return (
        <div className="dial-topbar">
          <button type="button" className="dial-topbar__crumb" onClick={goAll}>Radio</button>
          <span className="dial-topbar__sep">›</span>
          <button type="button" className="dial-topbar__crumb" onClick={() => goStation(currentStation.station.slug)}>
            {currentStation.station.name}
          </button>
          <span className="dial-topbar__sep">›</span>
          <span className="dial-topbar__title dial-topbar__title--active" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentShow.showName}
          </span>
          <button type="button" className="dial-topbar__back" onClick={() => goStation(currentStation.station.slug)}>↑ Back</button>
        </div>
      );
    }
    if (level === "dj" && currentDjName) {
      return (
        <div className="dial-topbar">
          <button type="button" className="dial-topbar__crumb" onClick={goAll}>Radio</button>
          <span className="dial-topbar__sep">›</span>
          <span className="dial-topbar__title dial-topbar__title--active">{currentDjName}</span>
          <button type="button" className="dial-topbar__back" onClick={goAll}>↑ Back</button>
        </div>
      );
    }
    return null;
  }

  // determine if Radio tab is active
  const isRadioActive = location === "/" || location === "" || location.startsWith("/?");

  // Current scan sample row (for scan band display)
  const samplingRow = scan.samplingIdx != null ? (withReason[scan.samplingIdx] ?? null) : null;

  return (
    <div className="dial-root">
      {/* Search overlay */}
      {searchOpen && (
        <SearchOverlay
          dialStations={stations}
          onClose={() => setSearchOpen(false)}
          onStationDrill={(slug) => { goStation(slug); setSearchOpen(false); }}
          onShowDrill={(show, station) => { goShow(show, station); setSearchOpen(false); }}
        />
      )}

      {/* Topbar */}
      {renderTopbar()}

      {/* Action bar — front door only (spec §10) */}
      {level === "all" && isRadioActive && (
        <div className="dial-actbar">
          <button type="button" className="dial-act dial-act--listen" onClick={tuneTop} disabled={!topRow}>
            <span className="dial-act__lbl">▶ Listen</span>
            <span className="dial-act__dest">{topLabel}</span>
          </button>
          <button
            type="button"
            className={`dial-act dial-act--scan${scan.scanning ? " dial-act--on" : ""}`}
            onClick={scan.toggle}
            disabled={withReason.length === 0}
          >
            <span className="dial-act__lbl">{scan.scanning ? "■ Stop" : "⇢ Scan"}</span>
            <span className="dial-act__dest">{scan.scanning ? "sampling" : `all ${withReason.length}`}</span>
          </button>
        </div>
      )}

      {/* Scan detail band — visible while scanning (spec §11) */}
      {level === "all" && isRadioActive && scan.scanning && (
        <div className="dial-scanband">
          <div className="dial-sb-top">
            <button type="button" className="dial-sb-step" onClick={scan.back} title="Back one">◀</button>
            <div className="dial-sb-now">
              {samplingRow ? (
                <>
                  <div className="dial-sb-t">
                    {samplingRow.show?.currentTrack?.title ?? (samplingRow.show?.showName ?? samplingRow.ds.station.name)}
                  </div>
                  <div className="dial-sb-u">
                    {samplingRow.show?.djName && <b>{samplingRow.show.djName}</b>}
                    {samplingRow.show?.djName ? " · " : ""}{samplingRow.ds.station.name}
                    {" · "}{(scan.samplingIdx! + 1)} of {withReason.length}
                  </div>
                </>
              ) : (
                <div className="dial-sb-t">—</div>
              )}
            </div>
            <button type="button" className="dial-sb-step" onClick={scan.next} title="Next">▶</button>
          </div>
          <div className="dial-sb-track">
            <div className="dial-sb-fill" style={{ width: `${scan.progress * 100}%` }} />
          </div>
          <div className="dial-sb-bot">
            <button type="button" className="dial-sb-land" onClick={handleScanLand}>Land</button>
            <div className="dial-sb-dwell">
              <button type="button" onClick={() => scan.adjustDwell(-1)}>−</button>
              <span>{scan.dwellMs / 1000}s</span>
              <button type="button" onClick={() => scan.adjustDwell(1)}>+</button>
            </div>
            <button type="button" className="dial-sb-stop" onClick={scan.stop} title="Stop scan">✕</button>
          </div>
        </div>
      )}

      {/* Scan bar — station / show / dj levels only */}
      {level !== "all" && isRadioActive && (
        <ScanBar
          stations={stations}
          level={level}
          currentStation={currentStation}
          currentShow={currentShow}
          currentDj={currentDjName}
          onPlay={(ds) => radio.toggle(ds.station)}
        />
      )}

      {/* Main scroll body */}
      <div className="dial-body">
        {/* DIAL view — three-zone front door (spec §6) */}
        {level === "all" && (
          <>
            {/* While crossing scores are in-flight, render all three zone headings
                immediately in their canonical order so no section can jump ahead
                of another. Each heading is accompanied by a loading indicator
                until real content is ready. Zone 1 keeps its context-sensitive
                placeholder; Zones 2 and 3 show a pulsing dot. */}
            {!isCoreLoading && showSkeleton && (
              <>
                {/* Zone 1 heading + context-sensitive placeholder.
                    Show an estimated count (~N) derived from client-side crossings
                    (server crossings haven't resolved yet, so these are pre-scores). */}
                <ZoneLabel
                  label="On air, with a reason"
                  accent="library"
                  n={withReason.length > 0 ? withReason.length : undefined}
                  estimated={withReason.length > 0}
                />
                <Zone1Placeholder
                  isSpotifyConnected={isSpotifyConnected}
                  hasLibrary={hasLibrary}
                />
                {/* Zone 2 heading + skeleton rows — no pre-load signal for ghost stations */}
                <ZoneLabel label="Missed while you were away" accent="picker" />
                <DialRowSkeleton delay={0} />
                <DialRowSkeleton delay={1} />
                <DialRowSkeleton delay={2} />
                {/* Zone 3 heading + skeleton rows.
                    Estimated count from stations with no crossing evidence yet. */}
                <ZoneLabel
                  label="Also on air"
                  accent="live"
                  n={alsoOnAir.length > 0 ? alsoOnAir.length : undefined}
                  estimated={alsoOnAir.length > 0}
                />
                <DialRowSkeleton delay={0} />
                <DialRowSkeleton delay={1} />
                <DialRowSkeleton delay={2} />
              </>
            )}

            {/* Zone 1: On air, with a reason — only once crossing scores are ready */}
            {!crossingsLoading && withReason.length > 0 && (
              <>
                <div className="fdzone-lbl-row">
                  <ZoneLabel
                    label="On air, with a reason"
                    n={withReason.length}
                    hint="best first · scan walks this list"
                    accent="library"
                    collapsed={zone1Collapsed}
                    onCollapse={() => { setZone1Collapsed((c) => !c); if (!zone1Collapsed) setZone1Expanded(false); }}
                  />
                  {zone1Expanded && !zone1Collapsed && withReason.length > zone1Visible && (
                    <button
                      className="dial-show-more-inline"
                      aria-expanded={true}
                      aria-controls="zone1-rows"
                      onClick={() => setZone1Expanded(false)}
                    >
                      See less
                    </button>
                  )}
                </div>
                {!zone1Collapsed && (
                  <>
                    {/* Map over the FULL array so isSampling index is always the
                        unsliced position; rows beyond zone1Visible are null until
                        zone1Expanded is true. */}
                    <div id="zone1-rows">
                      {withReason.map((row, i) =>
                        !zone1Expanded && i >= zone1Visible ? null : (
                          <FrontDoorRow
                            key={row.ds.station.slug}
                            ds={row.ds}
                            show={row.show}
                            ov={row.show?.djName != null ? pickerOv(row.show?.pickerId ?? null, row.show.djName) : row.ds.lifetimeCrossings}
                            isActive={row.ds.station.slug === radio.station?.slug}
                            isSampling={scan.samplingIdx === i}
                            onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                            onEarlier={() => goStation(row.ds.station.slug)}
                          />
                        )
                      )}
                    </div>
                    {withReason.length > zone1Visible && (
                      <button
                        className="dial-show-more"
                        aria-expanded={zone1Expanded}
                        aria-controls="zone1-rows"
                        onClick={() => setZone1Expanded((e) => !e)}
                      >
                        {zone1Expanded ? "See less" : `See all ${withReason.length}`}
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* Zone 2: Ghost — shown only after crossings load so it never
                jumps above Zone 1 while scores are still in-flight */}
            {!crossingsLoading && ghost.length > 0 && (
              <>
                <ZoneLabel
                  label="Missed while you were away"
                  n={ghost.length}
                  accent="picker"
                  collapsed={zone2Collapsed}
                  onCollapse={() => { setZone2Collapsed((c) => !c); if (!zone2Collapsed) setZone2Expanded(false); }}
                />
                {!zone2Collapsed && (
                  <>
                    <div id="zone2-rows">
                      {ghost.slice(0, zone2Expanded ? ghost.length : ZONE2_VISIBLE).map((g) => (
                        <GhostRow
                          key={g.slug}
                          station={g}
                          isActive={g.slug === radio.station?.slug}
                          onTuneIn={() => goStation(g.slug)}
                        />
                      ))}
                    </div>
                    {ghost.length > ZONE2_VISIBLE && (
                      <button
                        className="dial-show-more"
                        aria-expanded={zone2Expanded}
                        aria-controls="zone2-rows"
                        onClick={() => setZone2Expanded((e) => !e)}
                      >
                        {zone2Expanded ? "See less" : `See all ${ghost.length}`}
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* Zone 3: Also on air — gated on crossingsLoading like Zones 1 & 2
                so it never jumps ahead while scores are still in-flight */}
            {!crossingsLoading && alsoOnAir.length > 0 && (
              <>
                <ZoneLabel
                  label="Also on air"
                  n={alsoOnAir.length}
                  hint="nothing Lore can point to yet"
                  accent="live"
                  collapsed={zone3Collapsed}
                  onCollapse={() => { setZone3Collapsed((c) => !c); if (!zone3Collapsed) setZone3Expanded(false); }}
                />
                {!zone3Collapsed && (
                  <>
                    <div id="zone3-rows">
                      {alsoOnAir.slice(0, zone3Expanded ? alsoOnAir.length : ZONE3_VISIBLE).map((row) => (
                        <FrontDoorRow
                          key={row.ds.station.slug}
                          ds={row.ds}
                          show={row.show}
                          ov={row.show?.djName != null ? pickerOv(row.show?.pickerId ?? null, row.show.djName) : row.ds.lifetimeCrossings}
                          isActive={row.ds.station.slug === radio.station?.slug}
                          isSampling={false}
                          onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                          onEarlier={() => goStation(row.ds.station.slug)}
                        />
                      ))}
                    </div>
                    {alsoOnAir.length > ZONE3_VISIBLE && (
                      <button
                        className="dial-show-more"
                        aria-expanded={zone3Expanded}
                        aria-controls="zone3-rows"
                        onClick={() => setZone3Expanded((e) => !e)}
                      >
                        {zone3Expanded ? "See less" : `See all ${alsoOnAir.length}`}
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* Live-zone skeleton — shown after crossings resolve but while the
                first live pulse is still in-flight and no stations have appeared.
                Suppressed during the crossings-loading window because the three
                zone skeletons above already hold the layout. */}
            {!crossingsLoading && liveLoading && !isCoreLoading && sortedRows.length === 0 && (
              <>
                <DialRowSkeleton delay={0} />
                <DialRowSkeleton delay={1} />
                <DialRowSkeleton delay={2} />
              </>
            )}

            {/* Recently aired — held until both crossings AND live data have
                loaded so it never appears above the live zones.
                For unauthenticated users crossingsLoading resolves in ~100 ms
                (empty 200) but liveLoading can take several seconds, so gating
                on crossingsLoading alone would flood the screen with 100+
                offline rows before any live station has had a chance to appear. */}
            {!crossingsLoading && !liveLoading && offlineStations.length > 0 && (
              <ZoneLabel label="Recently aired" n={offlineStations.length} />
            )}
            {!crossingsLoading && !liveLoading && visibleOffline.map((ds) => (
              <OfflineRow
                key={ds.station.slug}
                dialStation={ds}
                isActive={ds.station.slug === radio.station?.slug}
                onStationClick={() => goStation(ds.station.slug)}
                onPlay={() => void radio.toggle(ds.station)}
              />
            ))}
            {!crossingsLoading && !liveLoading && visibleOfflineCount < offlineStations.length && (
              <button
                className="dial-show-more"
                onClick={() => setVisibleOfflineCount((n) => n + OFFLINE_PAGE)}
              >
                Show {Math.min(OFFLINE_PAGE, offlineStations.length - visibleOfflineCount)} more stations
              </button>
            )}

            {/* Spinner while the live pulse hasn't arrived yet */}
            {isCoreLoading && (
              <div className="dial-loading">Loading stations…</div>
            )}

            {sortedRows.length === 0 && offlineStations.length === 0 && !isLoading && (
              <div className="dial-loading" style={{ opacity: 0.4 }}>No stations online</div>
            )}
          </>
        )}

        {/* STATION detail level */}
        {level === "station" && currentStation && (
          <>
            <StationDetailView
              dialStation={currentStation}
              onShowClick={(show) => goShow(show, currentStation)}
            />
            <ContextRail
              level="station"
              station={currentStation}
              show={null}
              djName={null}
              allStations={stations}
              onStationClick={goStation}
              onDjClick={goDj}
            />
          </>
        )}

        {/* SHOW tracklist level */}
        {level === "show" && currentShow && currentStation && (
          <>
            <ShowTracklistView
              show={currentShow}
              station={currentStation}
              allStationsData={stations}
              onDjClick={goDj}
            />
            <ContextRail
              level="show"
              station={currentStation}
              show={currentShow}
              djName={currentShow.djName}
              allStations={stations}
              onStationClick={goStation}
              onDjClick={goDj}
            />
          </>
        )}

        {/* DJ level */}
        {level === "dj" && currentDjName && (
          <>
            <DjView
              djName={currentDjName}
              allStations={stations}
              onShowClick={(show, station) => goShow(show, station)}
            />
            <ContextRail
              level="dj"
              station={currentStation}
              show={null}
              djName={currentDjName}
              allStations={stations}
              onStationClick={goStation}
              onDjClick={goDj}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone 1 loading placeholder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DialRowSkeleton — shimmer placeholder that mimics the shape of a FrontDoorRow
// ---------------------------------------------------------------------------

function DialRowSkeleton({ delay = 0 }: { delay?: 0 | 1 | 2 }) {
  return (
    <div className="fdrow-skeleton" style={{ "--delay": delay } as React.CSSProperties}>
      <div className="fdrow-skeleton__name" />
      <div className="fdrow-skeleton__sub" />
    </div>
  );
}

function Zone1Placeholder({
  isSpotifyConnected,
  hasLibrary,
}: {
  isSpotifyConnected: boolean;
  hasLibrary: boolean;
}) {
  if (!isSpotifyConnected) {
    // New user — explain Lore and invite them to connect.
    return (
      <div className="z1-placeholder z1-placeholder--connect">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            Lore finds the stations playing <em>your</em> music — right now,
            live, ranked by how much of your library they've touched.
          </p>
          <button
            type="button"
            className="dial-ctabtn dial-ctabtn--keep"
            onClick={() => void startSpotifyLibraryConnect()}
          >
            Connect Spotify to see what's playing your music
          </button>
        </div>
      </div>
    );
  }

  if (!hasLibrary) {
    // Connected but library empty — prompt an import.
    return (
      <div className="z1-placeholder z1-placeholder--import">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            Import your Spotify library so Lore can match it against what's
            on air right now.
          </p>
          <a className="dial-ctabtn dial-ctabtn--keep" href="/lore/library">
            Go to Library → Import
          </a>
        </div>
      </div>
    );
  }

  // Library exists — show a "working on it" status line + skeleton rows.
  return (
    <div className="z1-placeholder z1-placeholder--loading">
      <div className="z1-placeholder__status">
        <span className="dial-live-skeleton__pip" />
        <span className="z1-placeholder__lbl">Finding which stations are playing your music…</span>
      </div>
      <DialRowSkeleton delay={0} />
      <DialRowSkeleton delay={1} />
    </div>
  );
}

function GhostRow({ station, isActive, onTuneIn }: GhostRowProps) {
  const cls = ["ghost-row", isActive ? "ghost-row--playing" : ""].filter(Boolean).join(" ");
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={onTuneIn}
      onKeyDown={(e) => e.key === "Enter" && onTuneIn()}
    >
      <div className="ghost-row__c">
        <div className="ghost-row__name">{station.name}</div>
        <div className="ghost-row__reason">
          played <b>{station.artistName}</b> — an artist from your library
        </div>
      </div>
    </div>
  );
}
