/**
 * DialView — the Dial Radio timeline.
 *
 * Manages a level state machine (all → station → show → dj) and renders the
 * appropriate view at each level. The bottom pill-nav (Radio · Selectors ·
 * Library) lives in AppLayout; DialView renders the topbar/scanbar/subnav
 * chrome above the scroll body.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useDialData, togglePin, readPins, type DialStation, type DialShow, type DialSpin } from "../hooks/useDialData";
import { StationLane } from "./StationLane";
import { ContextRail } from "./ContextRail";
import { SearchOverlay } from "./SearchOverlay";

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

  const land = useCallback(() => {
    stopScan();
    // sampling is kept as-is after land
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
        onClick={land}
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
// DialView — top-level
// ---------------------------------------------------------------------------
export function DialView() {
  const [location] = useLocation();
  const [level, setLevel] = useState<Level>("all");
  const [currentStationSlug, setCurrentStationSlug] = useState<string | null>(null);
  const [currentShow, setCurrentShow] = useState<DialShow | null>(null);
  const [currentDjName, setCurrentDjName] = useState<string | null>(null);
  const [pins, setPins] = useState<Set<string>>(() => readPins());
  const [searchOpen, setSearchOpen] = useState(false);

  const { stations, isLoading } = useDialData();

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

  // --- pin toggle ---
  const handlePinToggle = useCallback((slug: string) => {
    togglePin(slug);
    setPins(readPins());
  }, []);

  // --- sort stations: pinned first, then live, then by crossing count ---
  const sortedStations = useMemo(
    () =>
      [...stations].sort((a, b) => {
        const aPinned = pins.has(a.station.slug);
        const bPinned = pins.has(b.station.slug);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        return b.crossings - a.crossings;
      }),
    [stations, pins],
  );

  // --- derived tiers ---
  const liveStations = sortedStations.filter((s) => s.isLive);
  const offlineStations = sortedStations.filter((s) => !s.isLive);

  // --- topbar ---
  function renderTopbar() {
    if (level === "all") {
      return (
        <div className="dial-topbar">
          <span className="dial-topbar__wordmark">Lore</span>
          <span className="dial-topbar__sort-chip">◆ by library overlap</span>
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

  // determine if Radio tab is active (vs location being /selectors or /library)
  const isRadioActive = location === "/" || location === "" || location.startsWith("/?");

  return (
    <div className="dial-root">
      {/* Search overlay — covers the whole view when open */}
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

      {/* Scan bar — radio dial only */}
      {isRadioActive && (
        <ScanBar
          stations={stations}
          level={level}
          currentStation={currentStation}
          currentShow={currentShow}
          currentDj={currentDjName}
        />
      )}

      {/* Main scroll body */}
      <div className="dial-body">
        {isLoading && sortedStations.length === 0 && (
          <div className="dial-loading">Loading stations…</div>
        )}

        {/* DIAL view */}
        {level === "all" && (
          <>
            {liveStations.length > 0 && <TierHeader live />}
            {liveStations.map((ds) => (
              <StationLane
                key={ds.station.slug}
                dialStation={ds}
                isPinned={pins.has(ds.station.slug)}
                isActive={ds.station.slug === currentStationSlug}
                onStationClick={() => goStation(ds.station.slug)}
                onShowClick={(show) => goShow(show, ds)}
                onPinToggle={() => handlePinToggle(ds.station.slug)}
              />
            ))}
            {offlineStations.length > 0 && <TierHeader live={false} />}
            {offlineStations.map((ds) => (
              <StationLane
                key={ds.station.slug}
                dialStation={ds}
                isPinned={pins.has(ds.station.slug)}
                isActive={ds.station.slug === currentStationSlug}
                onStationClick={() => goStation(ds.station.slug)}
                onShowClick={(show) => goShow(show, ds)}
                onPinToggle={() => handlePinToggle(ds.station.slug)}
              />
            ))}
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
