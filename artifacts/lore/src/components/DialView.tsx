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
import { useDialData, type DialStation, type DialShow, type DialSpin } from "../hooks/useDialData";
import { useMyOverlapSelectors } from "../lib/meHooks";
import { StationLane } from "./StationLane";
import { ContextRail } from "./ContextRail";
import { SearchOverlay } from "./SearchOverlay";
import { usePlayer } from "../player/PlayerProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
function listNames(artists: string[]): string {
  if (artists.length === 0) return "";
  if (artists.length === 1) return artists[0];
  if (artists.length <= 3) return `${artists.slice(0, -1).join(", ")} and ${artists[artists.length - 1]}`;
  return `${artists.slice(0, 3).join(", ")} and ${artists.length - 3} more`;
}

interface ReasonResult { r: number; cls: string; node: ReactNode }

/** One sentence per rung; returns the strongest rung that applies (spec §3). */
function reason(show: DialShow | null, stationCrossings: number): ReasonResult {
  if (!show) return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };

  // Rung 1: crossing is playing right now
  if (show.currentTrack?.isLibraryHit) {
    return {
      r: 1, cls: "w1",
      node: <>◆ playing <b>{show.currentTrack.title}</b> — in your library</>,
    };
  }

  // Rung 2: artist names from crossings already this set (§9 names, not counts)
  if (show.crossings > 0) {
    const names = show.topArtists.length > 0 ? listNames(show.topArtists) : null;
    return {
      r: 2, cls: "w2",
      node: names
        ? <><b>{names}</b> already this set</>
        : <><b>{show.crossings} of yours</b> already this set</>,
    };
  }

  // Rung 3: artists from user's library played this set (no exact track match)
  if (show.artistCrossings > 0) {
    const names = show.topArtistNames.length > 0 ? listNames(show.topArtistNames) : null;
    return {
      r: 3, cls: "w3",
      node: names
        ? <><b>{names}</b> — an artist from your library</>
        : <><b>{show.artistCrossings}</b> tracks by artists from your library</>,
    };
  }

  // Rung 6: on air, attributed, no evidence yet
  if (show.djName) {
    return { r: 6, cls: "w6", node: `on air · ${intoSet(show.startedAt)} into the set` };
  }

  // Rung 7: 24h station crossings, no selector listed
  if (stationCrossings > 0) {
    return {
      r: 7, cls: "w7",
      node: <><b>{stationCrossings} of yours</b> here in the last 24h — no selector listed</>,
    };
  }

  // Rung 0: dark — nothing to go on
  return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };
}

// ---------------------------------------------------------------------------
// Front-door scan hook (spec §11)
// ---------------------------------------------------------------------------

const DWELL_PRESETS = [3000, 5000, 7000, 12000, 20000] as const;

function useFrontDoorScan(count: number) {
  const [scanning, setScanning] = useState(false);
  const [samplingIdx, setSamplingIdx] = useState<number | null>(null);
  const [dwellMs, setDwellMs] = useState(7000);
  const [progress, setProgress] = useState(0);

  // All mutable timer state in a single ref — avoids stale closures
  const rt = useRef({ timer: null as ReturnType<typeof setTimeout> | null, raf: null as number | null, t0: 0, idx: 0, active: false });
  const countRef = useRef(count);
  const dwellRef = useRef(7000);
  useEffect(() => { countRef.current = count; }, [count]);
  useEffect(() => { dwellRef.current = dwellMs; }, [dwellMs]);

  const cancelTimers = useCallback(() => {
    if (rt.current.timer != null) { clearTimeout(rt.current.timer); rt.current.timer = null; }
    if (rt.current.raf != null) { cancelAnimationFrame(rt.current.raf); rt.current.raf = null; }
  }, []);

  const tick = useCallback(() => {
    if (!rt.current.active) return;
    const p = Math.min(1, (Date.now() - rt.current.t0) / dwellRef.current);
    setProgress(p);
    if (p < 1) rt.current.raf = requestAnimationFrame(tick);
  }, []);

  const hop = useCallback((idx: number) => {
    const n = countRef.current;
    if (!n) return;
    const i = ((idx % n) + n) % n;
    rt.current.idx = i;
    rt.current.t0 = Date.now();
    cancelTimers();
    setSamplingIdx(i);
    setProgress(0);
    rt.current.raf = requestAnimationFrame(tick);
    rt.current.timer = setTimeout(() => hop(i + 1), dwellRef.current);
  }, [cancelTimers, tick]);

  const stop = useCallback(() => {
    rt.current.active = false;
    cancelTimers();
    setScanning(false);
    setSamplingIdx(null);
    setProgress(0);
  }, [cancelTimers]);

  const start = useCallback(() => {
    if (!countRef.current) return;
    rt.current.active = true;
    setScanning(true);
    hop(0);
  }, [hop]);

  const toggle = useCallback(() => { if (rt.current.active) stop(); else start(); }, [stop, start]);

  /** Back-one: go to previous sample, restart dwell from that position */
  const back = useCallback(() => { if (rt.current.active) hop(rt.current.idx - 1); }, [hop]);
  const next = useCallback(() => { if (rt.current.active) hop(rt.current.idx + 1); }, [hop]);

  /** Land: commit current sample — stop auto-advance, keep highlight */
  const land = useCallback(() => {
    rt.current.active = false;
    cancelTimers();
    setScanning(false);
    setProgress(0);
    // samplingIdx intentionally kept so caller can read which row was landed on
  }, [cancelTimers]);

  const adjustDwell = useCallback((dir: 1 | -1) => {
    setDwellMs(prev => {
      const idx = DWELL_PRESETS.indexOf(prev as (typeof DWELL_PRESETS)[number]);
      const ni = Math.max(0, Math.min(DWELL_PRESETS.length - 1, (idx < 0 ? 2 : idx) + dir));
      return DWELL_PRESETS[ni];
    });
    if (rt.current.active) setTimeout(() => hop(rt.current.idx), 0);
  }, [hop]);

  useEffect(() => () => cancelTimers(), [cancelTimers]);

  return { scanning, samplingIdx, dwellMs, progress, toggle, back, next, land, adjustDwell, stop };
}

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

function FrontDoorRow({ ds, show, ov, isActive, isSampling, onTuneIn, onEarlier }: FrontDoorRowProps) {
  const rz = reason(show, ds.crossings);
  const isAttributed = !!show?.djName;

  // §8 Person leads — selector name when attributed, station name otherwise
  const primary = show?.djName ?? ds.station.name;

  // Mono ctx line: station · show · ♪ track (truncated, one line)
  const ctxParts = isAttributed
    ? [ds.station.name, show!.showName, show!.currentTrack ? `♪ ${show!.currentTrack.title}` : null]
    : [show?.showName ?? null, show?.currentTrack ? `♪ ${show.currentTrack.title}` : null];
  const ctx = ctxParts.filter(Boolean).join(" · ") || "—";

  // ovi: sort key shown inline with person name
  const oviStr = isAttributed
    ? (ov > 0 ? String(ov) : "0")
    : (ov > 0 ? String(ov) : "—");

  const rowCls = [
    "fdrow",
    rz.r === 1 ? "fdrow--t1" : "",
    rz.r === 0 || rz.r === 6 || rz.r === 7 ? "fdrow--dim" : "",
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
        <div className="fdrow__hd">
          <span className="fdrow__pri">{primary}</span>
          <span className={`fdrow__ovi${!isAttributed ? " fdrow__ovi--st" : ov === 0 ? " fdrow__ovi--zero" : ""}`}>
            {oviStr}
          </span>
        </div>
        <div className="fdrow__ctx">{ctx}</div>
        <div className={`fdrow__why ${rz.cls}`}>{rz.node}</div>
        <div className="fdrow__foot">
          <button
            type="button"
            className="fdrow__back"
            onClick={(e) => { e.stopPropagation(); onEarlier(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onEarlier(); } }}
          >
            ↩ earlier on {ds.station.name}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone label (§6 section headers)
// ---------------------------------------------------------------------------

function ZoneLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="fdzone-lbl">
      <span className="fdzone-lbl__text">{label}</span>
      {hint && <span className="fdzone-lbl__hint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier header
// ---------------------------------------------------------------------------
function TierHeader({ live }: { live: boolean }) {
  return (
    <div className="dial-tier-hd">
      <span className={`dial-tier-hd__label${live ? " dial-tier-hd__label--live" : ""}`}>
        {live ? "● On air" : "Recently aired"}
      </span>
      <div className="dial-tier-hd__rule" />
    </div>
  );
}

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
            <div className="dial-fatblk__dj">
              with <b>{show.djName ?? "Unknown"}</b>
              {isPicker && <span className="dial-fatblk__pickerbadge">◆ Selector</span>}
            </div>
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
          with <b style={{ fontStyle: "normal", fontWeight: 600 }}>{show.djName ?? "Unknown"}</b>
          {" "}on {station.station.name} · {fmtHM(show.startedAt)}{isLive ? "–now" : `–${fmtHM(show.endedAt)}`}
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

export function DialView() {
  const [location] = useLocation();
  const [level, setLevel] = useState<Level>("all");
  const [currentStationSlug, setCurrentStationSlug] = useState<string | null>(null);
  const [currentShow, setCurrentShow] = useState<DialShow | null>(null);
  const [currentDjName, setCurrentDjName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const { stations, isLoading, isCoreLoading, liveLoading } = useDialData();
  const { radio } = usePlayer();

  // Lifetime overlap counts per selector name (spec §4 sort key)
  const { data: selectorOverlaps } = useMyOverlapSelectors();
  const ovByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of selectorOverlaps ?? []) m.set(item.selector.name, item.sharedCount);
    return m;
  }, [selectorOverlaps]);

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
    return [...stations]
      .filter((ds) => ds.isLive)
      .map((ds) => {
        const show = ds.shows.find((sh) => sh.state === "live") ?? null;
        const rz = reason(show, ds.crossings);
        return { ds, show, rz };
      })
      .sort((a, b) => {
        // 1. Live crossing (rung 1) floats to the very top
        const ac = a.rz.r === 1 ? 0 : 1;
        const bc = b.rz.r === 1 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        // 2. Attribution tier: named selector unconditionally outranks station
        const at = a.show?.djName != null ? 0 : 1;
        const bt = b.show?.djName != null ? 0 : 1;
        if (at !== bt) return at - bt;
        // 3. Within attributed: lifetime overlap desc, then rung asc
        if (a.show?.djName != null && b.show?.djName != null) {
          const aOv = ovByName.get(a.show.djName) ?? 0;
          const bOv = ovByName.get(b.show.djName) ?? 0;
          if (aOv !== bOv) return bOv - aOv;
          return a.rz.r - b.rz.r;
        }
        // 4. Within unattributed: 24h station crossings desc
        return b.ds.crossings - a.ds.crossings;
      });
  }, [stations, ovByName]);

  // Three zones (spec §6)
  const withReason = useMemo(() => sortedRows.filter((row) => row.rz.r >= 1 && row.rz.r <= 5), [sortedRows]);
  const alsoOnAir = useMemo(() => sortedRows.filter((row) => !(row.rz.r >= 1 && row.rz.r <= 5)), [sortedRows]);
  // Ghost zone: stub — requires /me/ghost/missed endpoint (spec §7)
  const ghost: Array<unknown> = [];

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
            {/* Zone 1: On air, with a reason (rungs 1–5) */}
            {withReason.length > 0 && (
              <>
                <ZoneLabel label="On air, with a reason" hint="best first · scan walks this list" />
                {withReason.map((row, i) => (
                  <FrontDoorRow
                    key={row.ds.station.slug}
                    ds={row.ds}
                    show={row.show}
                    ov={row.show?.djName != null ? (ovByName.get(row.show.djName) ?? 0) : row.ds.crossings}
                    isActive={row.ds.station.slug === radio.station?.slug}
                    isSampling={scan.samplingIdx === i}
                    onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                    onEarlier={() => goStation(row.ds.station.slug)}
                  />
                ))}
              </>
            )}

            {/* Zone 2: Missed while you were away (ghost — stub, needs /me/ghost/missed, spec §7) */}
            {ghost.length > 0 && (
              <ZoneLabel label="Missed while you were away" />
            )}

            {/* Zone 3: Also on air (rungs 6, 7, 0 — dimmed) */}
            {alsoOnAir.length > 0 && (
              <>
                <ZoneLabel label="Also on air" hint="nothing Lore can point to yet" />
                {alsoOnAir.map((row) => (
                  <FrontDoorRow
                    key={row.ds.station.slug}
                    ds={row.ds}
                    show={row.show}
                    ov={row.show?.djName != null ? (ovByName.get(row.show.djName) ?? 0) : row.ds.crossings}
                    isActive={row.ds.station.slug === radio.station?.slug}
                    isSampling={false}
                    onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                    onEarlier={() => goStation(row.ds.station.slug)}
                  />
                ))}
              </>
            )}

            {/* Live-zone skeleton — shown while the first live pulse is in-flight
                and no live stations have appeared yet. Holds the zone-1 slot so
                the offline section below doesn't jump down when live data lands. */}
            {liveLoading && !isCoreLoading && sortedRows.length === 0 && (
              <div className="dial-live-skeleton">
                <span className="dial-live-skeleton__pip" />
                <span className="dial-live-skeleton__label">Finding what's on air…</span>
              </div>
            )}

            {/* Recently aired — shown once stations are loaded.
                liveLoading is no longer gated here: waiting for it caused a
                blank page for unauthenticated users (no live zones, no offline
                section). The skeleton above reserves the live slot so this
                section doesn't jump when live data arrives. */}
            {!isCoreLoading && offlineStations.length > 0 && <TierHeader live={false} />}
            {!isCoreLoading && offlineStations.map((ds) => (
              <StationLane
                key={ds.station.slug}
                dialStation={ds}
                isPinned={false}
                isActive={ds.station.slug === radio.station?.slug}
                onStationClick={() => goStation(ds.station.slug)}
                onShowClick={(show) => goShow(show, ds)}
                onPinToggle={() => {}}
                onPlay={() => void radio.toggle(ds.station)}
              />
            ))}

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
