/**
 * DialView — the Dial Radio timeline.
 *
 * Manages a level state machine (all → station → show → dj) and renders the
 * appropriate view at each level. The bottom pill-nav (Radio · Selectors ·
 * Library) lives in AppLayout; DialView renders the topbar/scanbar/subnav
 * chrome above the scroll body.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { SeedInput } from "./SeedInput";
import { Search } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useMyGhostMissed, useSpotifyLibraryConnected, startSpotifyLibraryConnect, useMyTasteSeeds, useSetTasteSeeds, useMattStarterLibrary, useStartMattLibrary, type GhostStation } from "../lib/meHooks";
import { useFrontDoorScan } from "../hooks/useFrontDoorScan";
import { StationLane } from "./StationLane";
import { ContextRail } from "./ContextRail";
import { SearchOverlay } from "./SearchOverlay";
import { usePlayer } from "../player/PlayerProvider";
import { BottlePanel } from "./BottlePanel";
import { AlbumAvatarPicker } from "./AlbumAvatarPicker";
import { useSocialMode, setSocialEnabled } from "../lib/social";
import { eligibleDjName, eligibleDjNames } from "@workspace/lore-attribution";
import {
  cleanLiveValue,
  sameLiveValue,
  nameNodes,
  crossingSentence,
  reason,
  intoSet,
  type ReasonResult,
} from "./dialViewHelpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import {
  useDialData,
  readPins,
  normalizeDjName,
  liveIdentityKey,
  type DialStation,
  type DialShow,
  type DialSpin,
  type LiveArtistSuggestion,
  type OnboardingArtistSuggestion,
  type DialDisplayMode,
} from "../hooks/useDialData";
import { useStationPresence, type StationPresence } from "../hooks/useStationPresence";
import { ListenerAvatarStack } from "./ListenerAvatarStack";

/**
 * Returns a version of `value` that only flips to `true` after it has been
 * `true` continuously for `delayMs` milliseconds.  Flipping back to `false`
 * is immediate, so skeleton rows vanish the instant real data arrives.
 *
 * Usage: avoids a jarring flash of skeleton rows on fast connections where
 * the loading state resolves in under ~150 ms.
 *
 * The return expression is `value && delayed` (not just `delayed`) to close a
 * subtle race: `useEffect` runs after the render, so when `value` flips false
 * there is one render where the state variable `delayed` is still `true`.
 * Without the `value &&` guard that render would emit `showSkeleton=true` while
 * `!crossingsLoading` is already `true`, causing skeleton rows and real zone
 * rows to coexist for one frame.
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
  // Short-circuit: when value is false, always return false regardless of the
  // pending effect clearing `delayed`.  This prevents a one-frame coexistence
  // of skeleton rows and real content when crossingsLoading flips false.
  return value && delayed;
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
/**
 * The front door is a tune-in affordance, so live context is deliberately one
 * sentence rather than a stack of independently clickable identities.  Prefer
 * the current DJ and exact now-playing values; never use a recently-ended DJ
 * as if they were currently on air.
 */
function liveSentence(
  stationName: string,
  show: DialShow | null,
): { node: ReactNode; hasTrack: boolean } | null {
  const station = cleanLiveValue(stationName);
  if (!station || !show) return null;

  // Use eligibleDjNames so a single DJ provided only via djNames (djName=null)
  // still gets credited, and two distinct DJs collapse to null (no credit).
  const djList = eligibleDjNames(
    { name: show.showName ?? "", djName: show.djName ?? undefined, djNames: show.djNames },
    { artist: show.currentTrack?.artist, title: show.currentTrack?.title, showTitle: show.showName, stationName: station },
  );
  const dj = djList.length === 1 ? djList[0] : null;
  const artist = cleanLiveValue(show?.currentTrack?.artist);
  const usableArtist = sameLiveValue(artist, station) ? null : artist;

  // Show name: suppress if it duplicates the DJ name, station, or "Continuous"
  const rawShow = cleanLiveValue(show?.showName);
  const showName = rawShow
    && rawShow.toLowerCase() !== "continuous"
    && !sameLiveValue(rawShow, dj)
    && !sameLiveValue(rawShow, station)
    ? rawShow : null;

  // Language hierarchy — song titles are never shown; the player handles that.
  if (dj && usableArtist && showName) {
    return {
      node: <><b className="fdrow__dj">{dj}</b>{" selected "}<b className="fdrow__artist">{usableArtist}</b>{" on "}<span className="fdrow__show">{showName}</span></>,
      hasTrack: true,
    };
  }
  if (dj && usableArtist) {
    return {
      node: <><b className="fdrow__dj">{dj}</b>{" selected "}<b className="fdrow__artist">{usableArtist}</b></>,
      hasTrack: true,
    };
  }
  if (dj && showName) {
    return {
      node: <><b className="fdrow__dj">{dj}</b>{" · "}<span className="fdrow__show">{showName}</span></>,
      hasTrack: false,
    };
  }
  if (dj) {
    return { node: <><b className="fdrow__dj">{dj}</b>{" is on air"}</>, hasTrack: false };
  }
  if (usableArtist && showName) {
    return {
      node: <><b className="fdrow__artist">{usableArtist}</b>{" on "}<span className="fdrow__show">{showName}</span>{" now"}</>,
      hasTrack: true,
    };
  }
  if (usableArtist) {
    return { node: <><b className="fdrow__artist">{usableArtist}</b>{" on now"}</>, hasTrack: true };
  }

  // Without current attribution, preserve the established weak-match
  // reason instead of manufacturing a generic sentence.
  return null;
}
interface FrontDoorRowProps {
  ds: DialStation;
  show: DialShow | null;
  ov: number;          // lifetime selector overlap (attributed) or 24h crossings (unattributed)
  isActive: boolean;
  isSampling: boolean;
  onTuneIn: () => void;
  onEarlier: () => void;
  displayMode?: DialDisplayMode;
  presence?: StationPresence;
}

export function FrontDoorRow({ ds, show, ov, isActive, isSampling, onTuneIn, onEarlier, displayMode = "personal", presence }: FrontDoorRowProps) {
  const usableDjList = eligibleDjNames(
    { name: show?.showName ?? "", djName: show?.djName ?? undefined, djNames: show?.djNames },
    { artist: show?.currentTrack?.artist, title: show?.currentTrack?.title, showTitle: show?.showName, stationName: ds.station.name },
  );
  const usableDj = usableDjList.length === 1 ? usableDjList[0] : null;
  const safeShow = show && usableDj !== show.djName
    ? { ...show, djName: usableDj }
    : show;
  const rz = reason(safeShow, ds.crossings, ds.artistCrossings, displayMode, ds.topArtistNames);

  const crossing = crossingSentence(ds.station.name, safeShow, displayMode);
  // In blended mode: live sentence is a secondary attribution line shown below rz.node
  // (the community count). It uses only public DJ/track metadata — no personal flags.
  // In personal mode: live sentence fills in when there is no crossing sentence.
  const live = displayMode === "blended"
    ? liveSentence(ds.station.name, safeShow)
    : crossing ? null : liveSentence(ds.station.name, safeShow);
  // Tier 1 always shows the community aggregate sentence in blended mode.
  const tier1Cls = displayMode === "blended"
    ? rz.cls
    : crossing ? rz.cls : live ? "fdrow__live-sentence" : rz.cls;
  const tier1Node = displayMode === "blended"
    ? rz.node
    : crossing?.node ?? live?.node ?? rz.node;
  const dj = usableDj;
  // Show name is now in the sentence itself — the byline only carries the
  // station name. "Continuous" is appended for automated streams with no show.
  const isExplicitlyContinuous = ds.station.automationClass === "automated"
    && !cleanLiveValue(safeShow?.showName);
  const stationLabel = cleanLiveValue(ds.station.name) ?? ds.station.name;
  const bylineContext = isExplicitlyContinuous ? "Continuous" : null;

  const currentTrack = safeShow?.currentTrack ?? null;

  const rowCls = [
    "fdrow",
    rz.r === 1 ? "fdrow--t1" : "",
    rz.r >= 2 && rz.r <= 4 ? "fdrow--z1" : "",
    rz.r === 6 || rz.r === 7 ? "fdrow--hist" : "",
    rz.r === 0 || rz.r === 5 ? "fdrow--dim" : "",
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
        <div className={`fdrow__t1 ${tier1Cls}`}>
          {tier1Node}
        </div>

        {/* Blended mode secondary: live DJ/track attribution shown below the
            community count. Uses only public DJ/track metadata, not personal
            crossing flags, so it is safe in an anonymised aggregate context. */}
        {displayMode === "blended" && live && (
          <div className="fdrow__live-secondary">
            {live.node}
          </div>
        )}

        <span className="sr-only">{ds.station.slug}</span>

        {/* Continuous context label — only shown for automated streams; station
            name has moved to the right-side chip so it is not duplicated here. */}
        {bylineContext && (
          <div className="fdrow__t3 fdrow__context">
            {bylineContext}
          </div>
        )}

        {/* Zone 3 lifetime overlap caption: shown when the reason sentence carries no
            taste signal (r=0: no data; r=5: attributed show but no crossings yet) but
            we do have a nonzero lifetime artist-overlap count.  Gives every row a
            human explanation of why it surfaced instead of just a name and a number. */}
        {(rz.r === 0 || rz.r === 5) && ov > 0 && (
             <div className="fdrow__ov-caption">
            <b>{ov} artists</b> {displayMode === "blended" ? "represented here" : "you know"} play here
          </div>
        )}

        {/* Listener avatar stack — community presence below the reason sentence.
            Visible on every row that has active listeners, regardless of whether
            the viewer has personal crossings. Click propagation stopped so the
            tune-in handler doesn't fire. */}
        {presence && presence.count > 0 && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ListenerAvatarStack
              avatars={presence.avatars}
              count={presence.count}
              isActive={isActive}
            />
          </div>
        )}

        {/* BottlePanel gates itself on social mode; click propagation is stopped
            so the row's tune-in handler doesn't fire. */}
        {currentTrack?.mbid && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <BottlePanel
              mbid={currentTrack.mbid}
              stationId={ds.station.id}
              stationName={ds.station.name}
              trackTitle={currentTrack.title}
            />
          </div>
        )}

        {/* Footer: the sentence carries the station destination for live rows. */}
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

      {/* Station chip — far-right navigational affordance; tap goes to the
          station archive rather than tuning in. Propagation stopped so the
          row's tune-in handler doesn't fire. */}
      <Link
        href={`/archive/stations/${ds.station.slug}`}
        className="fdrow__station-chip"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        title={stationLabel}
      >
        {stationLabel}
      </Link>
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
// Zone collapse localStorage persistence
// Keys are stable identifiers — not tied to station slugs — so the preference
// survives even when zone membership changes between sessions.
// ---------------------------------------------------------------------------
const LS_ZONE1_COLLAPSED = "lore.zone.1.collapsed";
const LS_ZONE2_COLLAPSED = "lore.zone.2.collapsed";
const LS_ZONE3_COLLAPSED = "lore.zone.3.collapsed";

function readLSBool(key: string): boolean {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}

function writeLSBool(key: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(key, "true");
    } else {
      localStorage.removeItem(key);
    }
  } catch { /* storage unavailable — silently ignore */ }
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
  displayMode = "personal",
}: {
  dialStation: DialStation;
  isActive: boolean;
  onStationClick: () => void;
  onPlay: () => void;
  displayMode?: DialDisplayMode;
}) {
  const { station, shows, crossings, artistCrossings, topArtistNames: stationTopArtistNames } = dialStation;
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
    // Blended mode: prefer cumulative station-level names from the group endpoint.
    // Personal mode: fall back to the most recent show's individual artist names.
    const names = (displayMode === "blended" && stationTopArtistNames.length > 0)
      ? stationTopArtistNames
      : (lastShow?.topArtists ?? []);
    const nn = names.length > 0 ? nameNodes(names) : null;
    t1Node = nn
      ? displayMode === "blended"
        ? <>Your group: {nn}</>
        : <>Set included {nn}.</>
      : <><b>{crossings}</b> {displayMode === "blended" ? "heard here" : "of yours."}</>;
    t1Cls = "w3";
  } else if (artistCrossings > 0) {
    const names = (displayMode === "blended" && stationTopArtistNames.length > 0)
      ? stationTopArtistNames
      : (lastShow?.topArtistNames ?? []);
    const nn = names.length > 0 ? nameNodes(names) : null;
    t1Node = nn
      ? displayMode === "blended"
        ? <>Your group: {nn}</>
        : <>Set included {nn}.</>
      : <><b>{artistCrossings}</b> {displayMode === "blended" ? "community artists here" : "tracks by your artists."}</>;
    t1Cls = "w4";
  } else if (lastSpin) {
    t1Node = (
      <>
        {lastSpin.isFirstSpin && <span className="fdrow__first-spin">◈ </span>}
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
  const { enabled: socialEnabled } = useSocialMode();
  // displayMode is derived directly from socialEnabled — one toggle drives both.
  const displayMode: DialDisplayMode = socialEnabled ? "blended" : "personal";
  const {
    stations,
    isLoading,
    isCoreLoading,
    liveLoading,
    crossingsLoading,
    hasLibrary,
    hasSeeds,
    liveArtistSuggestions,
    onboardingArtists,
    onboardingArtistsLoading,
    overlapByPickerId,
    pickerNameToId,
    crossingSourceMode,
    crossingError,
  } = useDialData(displayMode);

  useEffect(() => {
    const send = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.resolve(fetch("/api/me/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialEnabled }),
      })).catch(() => undefined);
    };
    send();
    const id = window.setInterval(send, 45_000);
    return () => window.clearInterval(id);
  }, [socialEnabled]);

  useEffect(() => {
    // Keep server-side participation aligned with the existing social switch.
    void import("../lib/meHooks").then(({ patchPreferences }) =>
      Promise.resolve(patchPreferences({ socialParticipation: socialEnabled })).catch(() => undefined),
    );
  }, [socialEnabled]);

  // ── Taste seeds — zero-friction artist onboarding ───────────────────────
  const { data: seedArtists = [] } = useMyTasteSeeds();
  const setSeedsMutation = useSetTasteSeeds();
  const { data: mattStarter } = useMattStarterLibrary();
  const mattStarterMutation = useStartMattLibrary();
  const seedWriteRef = useRef<Promise<string[]> | null>(null);
  // Keep the cloud responsive while the serialized PUT queue is in flight.
  // The server query remains the source of truth; this optimistic mirror only
  // prevents a fast click from looking unselected until the round trip ends.
  const [optimisticSeeds, setOptimisticSeeds] = useState<string[] | null>(null);
  const visibleSeeds = optimisticSeeds ?? seedArtists;
  const startMattLibrary = useCallback(() => {
    mattStarterMutation.mutate();
  }, [mattStarterMutation]);

  const addSeed = useCallback((artist: string) => {
    const trimmed = artist.trim();
    if (!trimmed) return;
    // Serialize rapid picker clicks. Without this, two clicks in the same
    // render both read the old query result and the later PUT can overwrite
    // the first selected artist.
    const pending = seedWriteRef.current;
    const base = pending ? pending.catch(() => seedArtists) : Promise.resolve(visibleSeeds);
    seedWriteRef.current = base.then(async (current) => {
      const lower = trimmed.toLowerCase();
      if (current.some((s) => s.toLowerCase() === lower) || current.length >= 10) return current;
      const next = [...current, trimmed];
      setOptimisticSeeds(next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        setOptimisticSeeds(result.artists);
        return result.artists;
      } catch (error) {
        setOptimisticSeeds(null);
        throw error;
      }
    });
    void seedWriteRef.current.catch(() => undefined);
  }, [seedArtists, setSeedsMutation, visibleSeeds]);

  const removeSeed = useCallback((artist: string) => {
    const pending = seedWriteRef.current;
    const base = pending ? pending.catch(() => seedArtists) : Promise.resolve(visibleSeeds);
    seedWriteRef.current = base.then(async (current) => {
      const lower = artist.toLowerCase();
      const next = current.filter((s) => s.toLowerCase() !== lower);
      if (next.length === current.length) return current;
      setOptimisticSeeds(next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        setOptimisticSeeds(result.artists);
        return result.artists;
      } catch (error) {
        setOptimisticSeeds(null);
        throw error;
      }
    });
    void seedWriteRef.current.catch(() => undefined);
  }, [seedArtists, setSeedsMutation, visibleSeeds]);
  // Delay skeleton visibility so fast loads (< 150 ms) never flash shimmer rows.
  // The delayed flag only flips true after crossingsLoading has been true for
  // 150 ms; it resets to false immediately when crossingsLoading clears so that
  // real content replaces skeletons without any extra lag.
  const showSkeleton = useDelayedBoolean(crossingsLoading, 150);
  // Zone 1 has settled when both crossing scores and the core station pulse have
  // resolved. At that point we know what's in Zone 1 and can show the tab strip.
  const zone1Settled = !crossingsLoading && !isCoreLoading;
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
    const pins = readPins();
    return [...stations]
      .filter((ds) => ds.isLive)
      .map((ds) => {
        const show = ds.shows.find((sh) => sh.state === "live") ?? null;
        // Only the current run may establish live attribution. A recently
        // ended DJ must not affect either the sentence or its ordering.
        const djNameList = eligibleDjNames(
          { name: show?.showName ?? "", djName: show?.djName ?? undefined, djNames: show?.djNames },
          { artist: show?.currentTrack?.artist, title: show?.currentTrack?.title, showTitle: show?.showName, stationName: ds.station.name },
        );
        const effectiveDjName = djNameList.length === 1 ? djNameList[0] : null;
        const attributionSafeShow = show && effectiveDjName !== show.djName
          ? { ...show, djName: effectiveDjName }
          : show;
        const rz = reason(attributionSafeShow, ds.crossings, ds.artistCrossings, crossingSourceMode);
        const isPinned = pins.has(ds.station.slug);
        return { ds, show: attributionSafeShow, rz, effectiveDjName, isPinned };
      })
      .sort((a, b) => {
        // 1. Live crossing (rung 1) floats to the very top
        const ac = a.rz.r === 1 ? 0 : 1;
        const bc = b.rz.r === 1 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        // 2. Attribution band: DJ rows (effectiveDjName != null) always above
        //    stream rows regardless of overlap count. A DJ with 10 lifetime
        //    crossings outranks an automated stream with 500.
        const at = a.effectiveDjName != null ? 0 : 1;
        const bt = b.effectiveDjName != null ? 0 : 1;
        if (at !== bt) return at - bt;
        // 3. Within each band, overlap desc.
        //    DJ band: pickerId-first overlap (name bridge fallback).
        //    Stream band: lifetime station crossings (all-time, same scale).
        const aOv = a.effectiveDjName != null ? pickerOv(a.show?.pickerId ?? null, a.effectiveDjName) : a.ds.lifetimeCrossings;
        const bOv = b.effectiveDjName != null ? pickerOv(b.show?.pickerId ?? null, b.effectiveDjName) : b.ds.lifetimeCrossings;
        if (aOv !== bOv) return bOv - aOv;
        // 4. Rung asc as final tiebreaker; r=0 ("no data") sorts last of all.
        const sortR = (r: number) => r === 0 ? 99 : r;
        return sortR(a.rz.r) - sortR(b.rz.r);
      });
  }, [stations, overlapByPickerId, pickerNameToId, crossingSourceMode]);

  // Three zones (spec §6)
  // Zone 1: r=1..4 (show-level evidence) + r=6/r=7 (24h station-level crossings).
  //   r=6/r=7 belong here because the station HAS played the listener's music in
  //   the last 24h — that IS a reason, even without a current attributed show.
  // Zone 3: r=0 (no now-playing data at all) or r=5 (DJ on air, no library overlap).
  const withReason = useMemo(() => sortedRows.filter((row) => (row.rz.r >= 1 && row.rz.r <= 4) || row.rz.r === 6 || row.rz.r === 7), [sortedRows]);
  const alsoOnAir = useMemo(() => sortedRows.filter((row) => row.rz.r === 0 || row.rz.r === 5), [sortedRows]);

  // Community presence — poll all live station IDs every 60 s.
  // Only needed when Listening Party is active; still safe to call in personal
  // mode since the hook respects staleTime and the UI gates rendering on count.
  const liveStationIds = useMemo(
    () => sortedRows.map((row) => row.ds.station.id),
    [sortedRows],
  );
  const presenceMap = useStationPresence(liveStationIds);

  // Zone 3 band split (replaces slot-0 promotion from Task #1017):
  //   djBand  — r=5 rows (attributed show on air, no crossing yet).
  //             Always fully shown. Sorted by picker overlap desc.
  //             Styled with picker accent ("DJs on air" sub-label).
  //   restBand — r=0/6/7 rows (unattributed / dark).
  //             Subject to ZONE3_VISIBLE cap + expand toggle.
  //             Pinned stations float above non-pinned within restBand.
  const djBand = useMemo(() =>
    alsoOnAir
      .filter((row) => row.rz.r === 5)
      .sort((a, b) => {
        const aOv = pickerOv(a.show?.pickerId ?? null, a.effectiveDjName);
        const bOv = pickerOv(b.show?.pickerId ?? null, b.effectiveDjName);
        return bOv - aOv;
      }),
  // pickerOv closure reads overlapByPickerId/pickerNameToId from outer scope
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [alsoOnAir, overlapByPickerId, pickerNameToId]);

  const restBand = useMemo(() =>
    alsoOnAir
      .filter((row) => row.rz.r !== 5)
      .sort((a, b) => {
        // Pinned stations float above non-pinned regardless of crossing count.
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.ds.lifetimeCrossings - a.ds.lifetimeCrossings;
      }),
  [alsoOnAir]);
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

  // Helper: does a station's most recent non-future show have a usable DJ or show name?
  const hasAttribution = (ds: DialStation): boolean => {
    const lastShow = [...ds.shows].reverse().find((sh) => sh.state !== "future") ?? null;
    if (!lastShow) return false;
    const djName = lastShow.djName ?? null;
    const showName = lastShow.showName && lastShow.showName.toLowerCase() !== "unknown show"
      ? lastShow.showName : null;
    return !!(djName || showName);
  };

  // Offline stations (recently aired):
  //   1. Combined crossings desc — library matches first
  //   2. Stations with a named DJ or show above stations with no attribution
  //   3. Stations with any show history above stations with no data ever
  //   4. Stable within each tier
  const offlineStations = useMemo(() =>
    [...stations]
      .filter((ds) => !ds.isLive)
      .sort((a, b) => {
        const aCrossings = a.crossings + a.artistCrossings;
        const bCrossings = b.crossings + b.artistCrossings;
        if (bCrossings !== aCrossings) return bCrossings - aCrossings;
        const aAttr = hasAttribution(a) ? 1 : 0;
        const bAttr = hasAttribution(b) ? 1 : 0;
        if (bAttr !== aAttr) return bAttr - aAttr;
        const aHas = a.shows.length > 0 ? 1 : 0;
        const bHas = b.shows.length > 0 ? 1 : 0;
        return bHas - aHas;
      }),
    [stations, crossingSourceMode],
  );

  // Two-state visibility gate for the offline section:
  //   Default: only stations with provenance (crossings, artist crossings, named DJ, or show).
  //   Expanded: all offline stations (dark stations included).
  const [showAllOffline, setShowAllOffline] = useState(false);
  const offlineWithProvenance = useMemo(
    () => offlineStations.filter((ds) =>
      ds.crossings > 0 || ds.artistCrossings > 0 || hasAttribution(ds)
    ),
    [offlineStations],
  );
  const visibleOffline = showAllOffline ? offlineStations : offlineWithProvenance;

  // --- per-zone truncation (spec §16) ---
  // Zone 1: rung-1 rows are never hidden — expand the budget to cover them all.
  const rung1Count = useMemo(() => withReason.filter((r) => r.rz.r === 1).length, [withReason]);
  const zone1Visible = Math.max(Math.min(ZONE1_VISIBLE, 7), rung1Count);

  const [zone1Expanded, setZone1Expanded] = useState(false);
  const [zone2Expanded, setZone2Expanded] = useState(false);
  const [zone3Expanded, setZone3Expanded] = useState(false);

  // Active tab — resets to primary on each page load (not persisted).
  const [activeTab, setActiveTab] = useState<"library" | "also-on-air" | "recently-aired">("library");

  // Collapsed state — persisted to localStorage so the layout survives a reload.
  // A collapsed zone shows only the ZoneLabel header (no rows, no see-more
  // button).  Distinct from expanded: collapsed=true hides even the default
  // N-row truncated view.
  const [zone1Collapsed, setZone1CollapsedState] = useState(() => readLSBool(LS_ZONE1_COLLAPSED));
  const [zone2Collapsed, setZone2CollapsedState] = useState(() => readLSBool(LS_ZONE2_COLLAPSED));
  const [zone3Collapsed, setZone3CollapsedState] = useState(() => readLSBool(LS_ZONE3_COLLAPSED));

  const setZone1Collapsed = useCallback((v: boolean) => { writeLSBool(LS_ZONE1_COLLAPSED, v); setZone1CollapsedState(v); }, []);
  const setZone2Collapsed = useCallback((v: boolean) => { writeLSBool(LS_ZONE2_COLLAPSED, v); setZone2CollapsedState(v); }, []);
  const setZone3Collapsed = useCallback((v: boolean) => { writeLSBool(LS_ZONE3_COLLAPSED, v); setZone3CollapsedState(v); }, []);

  // Slug-key strings — order-insensitive (sorted) so a live reorder of the same
  // stations does NOT reset expansion; only a real membership change does.
  const zone1SlugKey = useMemo(() => withReason.map((r) => r.ds.station.slug).sort().join(","), [withReason]);
  const zone2SlugKey = useMemo(() => ghost.map((g) => g.slug).sort().join(","), [ghost]);
  const zone3SlugKey = useMemo(() => alsoOnAir.map((r) => r.ds.station.slug).sort().join(","), [alsoOnAir]);

  // Track previous slug keys so the reset effect only fires on genuine membership
  // changes and NOT on the initial mount.  Without this guard, the effect would
  // run after first render and overwrite the localStorage-read collapsed state.
  const prevZone1SlugKey = useRef<string | null>(null);
  const prevZone2SlugKey = useRef<string | null>(null);
  const prevZone3SlugKey = useRef<string | null>(null);

  // Expand-time anchor — the slug key that was current when the user last clicked
  // "See all". If the zone's membership temporarily shrinks and then recovers to
  // exactly this key, the zone silently re-expands rather than staying collapsed.
  const zone1ExpandAnchor = useRef<string | null>(null);
  const zone2ExpandAnchor = useRef<string | null>(null);
  const zone3ExpandAnchor = useRef<string | null>(null);

  // Reset expansion AND collapse when zone membership genuinely changes.
  // If the new key matches the expand-time anchor the user set, re-expand
  // silently instead of collapsing (transient-shrink recovery).
  useEffect(() => {
    if (prevZone1SlugKey.current === null) { prevZone1SlugKey.current = zone1SlugKey; return; }
    if (prevZone1SlugKey.current === zone1SlugKey) return;
    prevZone1SlugKey.current = zone1SlugKey;
    if (zone1ExpandAnchor.current === zone1SlugKey) { setZone1Expanded(true); return; }
    setZone1Expanded(false); setZone1Collapsed(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone1SlugKey]);
  useEffect(() => {
    if (prevZone2SlugKey.current === null) { prevZone2SlugKey.current = zone2SlugKey; return; }
    if (prevZone2SlugKey.current === zone2SlugKey) return;
    prevZone2SlugKey.current = zone2SlugKey;
    if (zone2ExpandAnchor.current === zone2SlugKey) { setZone2Expanded(true); return; }
    setZone2Expanded(false); setZone2Collapsed(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone2SlugKey]);
  useEffect(() => {
    if (prevZone3SlugKey.current === null) { prevZone3SlugKey.current = zone3SlugKey; return; }
    if (prevZone3SlugKey.current === zone3SlugKey) return;
    prevZone3SlugKey.current = zone3SlugKey;
    if (zone3ExpandAnchor.current === zone3SlugKey) { setZone3Expanded(true); return; }
    setZone3Expanded(false); setZone3Collapsed(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone3SlugKey]);

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
  // is safe.  Also un-collapse so the scanning station is never hidden — this
  // applies even when samplingIdx is within the default budget, because a
  // collapsed zone hides rows independently of the truncation budget.
  useEffect(() => {
    if (scan.samplingIdx != null) {
      setZone1Collapsed(false);
      if (scan.samplingIdx >= zone1Visible) {
        setZone1Expanded(true);
      }
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
          <Link
            href="/weekly-recap"
            className="dial-topbar__crumb"
            style={{ marginLeft: 8 }}
          >
            Weekly Recap
          </Link>
          <button
            type="button"
            className="dial-topbar__search"
            onClick={() => setSearchOpen(true)}
            aria-label="Search stations, selectors, shows"
            title="Search"
          >
            <Search size={14} />
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
                    <div className="dial-actpair">
            <button type="button" className="dial-act dial-act--listen" onClick={tuneTop} disabled={!topRow}>
              ▶ Listen{topLabel && <span className="dial-act__suffix"> · {topLabel}</span>}
            </button>
            <button
              type="button"
              className={`dial-act dial-act--scan${scan.scanning ? " dial-act--on" : ""}`}
              onClick={scan.toggle}
              disabled={withReason.length === 0}
            >
              {scan.scanning ? "■ Stop" : <><span className="dial-act__icon">↢</span> Scan<span className="dial-act__suffix"> · {withReason.length}</span></>}
            </button>
          </div>
           <div className="dial-mode" role="group" aria-label="Listening mode">
             <button
               type="button"
               className={`dial-mode__button${crossingSourceMode === "personal" ? " dial-mode__button--active" : ""}`}
               aria-pressed={crossingSourceMode === "personal"}
               aria-label="Solo mode"
               onClick={() => setSocialEnabled(false)}
             >
               Solo
             </button>
             <button
               type="button"
               className={`dial-mode__button${crossingSourceMode === "blended" ? " dial-mode__button--active" : ""}`}
               aria-pressed={crossingSourceMode === "blended"}
               aria-label="Listening Party"
               onClick={() => setSocialEnabled(true)}
             >
               Listening Party
             </button>
           </div>
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
        <AlbumAvatarPicker compact />
        {/* DIAL view — three-zone front door (spec §6) */}
        {level === "all" && (
          <>
            {/* While crossing scores are in-flight, render only the Zone 1 heading
                and its context-sensitive placeholder.  Zones 2/3 and "Recently
                aired" are intentionally suppressed until Zone 1 has settled so
                they never appear above the live crossing rows. */}
            {!isCoreLoading && showSkeleton && (
              <>
                {/* Zone 1 heading + context-sensitive placeholder.
                    No estimated count shown: the pre-load withReason count can
                    differ from the post-score count, producing a visible number
                    jump. Omitting it here means the count appears for the first
                    time only once crossing scores have fully resolved. */}
                <ZoneLabel
                  label="On the Air × Your Music Library"
                  accent="library"
                />
                <Zone1Placeholder
                  isSpotifyConnected={isSpotifyConnected}
                  hasLibrary={hasLibrary}
                  hasSeeds={hasSeeds || visibleSeeds.length > 0}
                  seeds={visibleSeeds}
                  liveLoading={liveLoading}
                  onAddSeed={addSeed}
                  onRemoveSeed={removeSeed}
                />
              </>
            )}

            {/* Tab strip — appears once Zone 1 has settled (crossings + live resolved).
                Tabs replace the vertical-scroll three-zone layout. */}
            {zone1Settled && (
              <div className="dial-tabs" role="tablist" aria-label="Radio sections">
                <button
                  type="button"
                  role="tab"
                  className={`dial-tab${activeTab === "library" ? " dial-tab--active" : ""}`}
                  aria-selected={activeTab === "library"}
                  onClick={() => setActiveTab("library")}
                >
                  ON AIR × YOUR ARTISTS
                  {withReason.length > 0 && <span className="dial-tab__n">{withReason.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`dial-tab${activeTab === "also-on-air" ? " dial-tab--active" : ""}`}
                  aria-selected={activeTab === "also-on-air"}
                  onClick={() => setActiveTab("also-on-air")}
                >
                  Also On Air
                  {alsoOnAir.length > 0 && <span className="dial-tab__n">{alsoOnAir.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`dial-tab${activeTab === "recently-aired" ? " dial-tab--active" : ""}`}
                  aria-selected={activeTab === "recently-aired"}
                  onClick={() => setActiveTab("recently-aired")}
                >
                  Recent
                  {offlineStations.length > 0 && <span className="dial-tab__n">{offlineStations.length}</span>}
                </button>
              </div>
            )}

            {/* ── Primary tab: "On the Air × Your Music Library" ─────────────────
                Contains Zone 1 crossing rows + Zone 2 ghost stations as a
                subsection below. */}
            {zone1Settled && activeTab === "library" && (
              <>
                {/* Zone 1: crossing rows */}
                {withReason.length > 0 && (
                  <>
                    <div className="fdzone-lbl-row">
                      <ZoneLabel
                        label="On the Air × Your Music Library"
                        n={withReason.length}
                        hint="best first · scan walks this list"
                        accent="library"
                        collapsed={zone1Collapsed}
                        onCollapse={() => { setZone1Collapsed(!zone1Collapsed); if (!zone1Collapsed) setZone1Expanded(false); }}
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
                        {(hasSeeds || visibleSeeds.length > 0) && (
                          <SeedBar
                            seeds={visibleSeeds}
                            onAddSeed={addSeed}
                            onRemoveSeed={removeSeed}
                          />
                        )}
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
                                displayMode={crossingSourceMode}
                                presence={presenceMap.get(row.ds.station.id)}
                              />
                            )
                          )}
                        </div>
                        {/* Always-visible "Add artists" CTA — compact secondary link
                            shown below the rows so listeners can expand their taste
                            even when crossings are already showing. */}
                        <button
                          type="button"
                          className="dial-ctabtn--ghost"
                          onClick={() => window.dispatchEvent(new CustomEvent("lore:open-import-modal", { detail: { mode: "artist-seeds" } }))}
                        >
                          ＋ Add artists you love →
                        </button>
                        {withReason.length > zone1Visible && (
                          <button
                            className="dial-show-more"
                            aria-expanded={zone1Expanded}
                            aria-controls="zone1-rows"
                            onClick={() => { if (!zone1Expanded) zone1ExpandAnchor.current = zone1SlugKey; else zone1ExpandAnchor.current = null; setZone1Expanded((e) => !e); }}
                          >
                            {zone1Expanded ? "See less" : `See all ${withReason.length}`}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* Library/seeds exist but nothing has crossed today — helpful nudge. */}
                {withReason.length === 0 && (hasLibrary || hasSeeds || visibleSeeds.length > 0) && (
                  <>
                    <ZoneLabel label="On the Air × Your Music Library" accent="library" />
                    <div className="z1-placeholder z1-placeholder--no-cross">
                      <div className="z1-placeholder__body">
                        <p className="z1-placeholder__pitch">
                          None of your artists have played on a live station today. Tune into a station or check back later.
                        </p>
                      </div>
                    </div>
                    {/* Always-visible CTA even in the no-cross state */}
                    <button
                      type="button"
                      className="dial-ctabtn--ghost"
                      onClick={() => window.dispatchEvent(new CustomEvent("lore:open-import-modal", { detail: { mode: "artist-seeds" } }))}
                    >
                      ＋ Add artists you love →
                    </button>
                  </>
                )}

                {/* No crossing rows, no library or seeds — full onboarding placeholder.
                    The prominent CTA lives inside Zone1Placeholder for this state. */}
                {withReason.length === 0 &&
                  !hasLibrary &&
                  !hasSeeds &&
                  visibleSeeds.length === 0 &&
                  !isSpotifyConnected && (
                  <>
                    <ZoneLabel label="On the Air × Your Music Library" accent="library" />
                    <Zone1Placeholder
                      isSpotifyConnected={isSpotifyConnected}
                      hasLibrary={hasLibrary}
                      hasSeeds={hasSeeds || visibleSeeds.length > 0}
                      seeds={visibleSeeds}
                      liveLoading={liveLoading}
                      onAddSeed={addSeed}
                      onRemoveSeed={removeSeed}
                    />
                  </>
                )}

                {/* Zone 2: Ghost stations — subsection within the primary tab.
                    Rendered after Zone 1 content as "Missed while you were away". */}
                {ghost.length > 0 && (
                  <>
                    <div className="fdzone-lbl-row">
                      <ZoneLabel
                        label="Missed while you were away"
                        n={ghost.length}
                        accent="picker"
                        collapsed={zone2Collapsed}
                        onCollapse={() => { setZone2Collapsed(!zone2Collapsed); if (!zone2Collapsed) setZone2Expanded(false); }}
                      />
                      {zone2Expanded && !zone2Collapsed && ghost.length > ZONE2_VISIBLE && (
                        <button
                          className="dial-show-more-inline"
                          aria-expanded={true}
                          aria-controls="zone2-rows"
                          onClick={() => setZone2Expanded(false)}
                        >
                          See less
                        </button>
                      )}
                    </div>
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
                            onClick={() => { if (!zone2Expanded) zone2ExpandAnchor.current = zone2SlugKey; else zone2ExpandAnchor.current = null; setZone2Expanded((e) => !e); }}
                          >
                            {zone2Expanded ? "See less" : `See all ${ghost.length}`}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* Live-zone skeleton — shown after crossings resolve but while the
                    first live pulse is still in-flight and no stations have appeared. */}
                {liveLoading && sortedRows.length === 0 && (
                  <>
                    <DialRowSkeleton delay={0} />
                    <DialRowSkeleton delay={1} />
                    <DialRowSkeleton delay={2} />
                  </>
                )}
              </>
            )}

            {/* ── "Also on air" tab ────────────────────────────────────────────
                Zone 3 content: DJ band (r=5) + rest band (r=0). */}
            {zone1Settled && activeTab === "also-on-air" && (
              <>
                {alsoOnAir.length > 0 ? (
                  <>
                    <div className="fdzone-lbl-row">
                      <ZoneLabel
                        label="Also on air"
                        n={alsoOnAir.length}
                        hint="nothing Lore can point to yet"
                        accent="live"
                        collapsed={zone3Collapsed}
                        onCollapse={() => { setZone3Collapsed(!zone3Collapsed); if (!zone3Collapsed) setZone3Expanded(false); }}
                      />
                      {zone3Expanded && !zone3Collapsed && restBand.length > ZONE3_VISIBLE && (
                        <button
                          className="dial-show-more-inline"
                          aria-expanded={true}
                          aria-controls="zone3-rows"
                          onClick={() => setZone3Expanded(false)}
                        >
                          See less
                        </button>
                      )}
                    </div>
                    {!zone3Collapsed && (
                      <>
                        {/* DJ band — attributed shows with no crossing yet.
                            Always fully shown; no ZONE3_VISIBLE cap. */}
                        {djBand.length > 0 && (
                          <>
                            <ZoneLabel label="DJs on air" accent="picker" />
                            {djBand.map((row) => (
                              <FrontDoorRow
                                key={row.ds.station.slug}
                                ds={row.ds}
                                show={row.show}
                                ov={pickerOv(row.show?.pickerId ?? null, row.effectiveDjName)}
                                isActive={row.ds.station.slug === radio.station?.slug}
                                isSampling={false}
                                onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                                onEarlier={() => goStation(row.ds.station.slug)}
                                displayMode={crossingSourceMode}
                                presence={presenceMap.get(row.ds.station.id)}
                              />
                            ))}
                          </>
                        )}
                        {/* Rest band — unattributed / dark rows.
                            Pinned stations float to the top of this band.
                            Subject to ZONE3_VISIBLE cap + expand toggle. */}
                        {restBand.length > 0 && (
                          <>
                            <div id="zone3-rows">
                              {restBand.slice(0, zone3Expanded ? restBand.length : ZONE3_VISIBLE).map((row) => (
                                <FrontDoorRow
                                  key={row.ds.station.slug}
                                  ds={row.ds}
                                  show={row.show}
                                  ov={row.ds.lifetimeCrossings}
                                  isActive={row.ds.station.slug === radio.station?.slug}
                                  isSampling={false}
                                  onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                                  onEarlier={() => goStation(row.ds.station.slug)}
                                  displayMode={crossingSourceMode}
                                  presence={presenceMap.get(row.ds.station.id)}
                                />
                              ))}
                            </div>
                            {restBand.length > ZONE3_VISIBLE && (
                              <button
                                className="dial-show-more"
                                aria-expanded={zone3Expanded}
                                aria-controls="zone3-rows"
                                onClick={() => { if (!zone3Expanded) zone3ExpandAnchor.current = zone3SlugKey; else zone3ExpandAnchor.current = null; setZone3Expanded((e) => !e); }}
                              >
                                {zone3Expanded ? "See less" : `See all ${restBand.length}`}
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div style={{ padding: "20px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 12 }}>
                    No additional stations on air right now
                  </div>
                )}
              </>
            )}

            {/* ── "Recently aired" tab ─────────────────────────────────────────
                Offline stations that aired recently.  Gated on the tab so it
                never renders while live zones are still loading.
                Default view shows only stations with provenance; "See all"
                expands to include dark stations. */}
            {zone1Settled && activeTab === "recently-aired" && (
              <>
                {offlineStations.length > 0 ? (
                  <>
                    <ZoneLabel label="While you were away" n={offlineStations.length} />
                    {visibleOffline.map((ds) => (
                      <OfflineRow
                        key={ds.station.slug}
                        dialStation={ds}
                        isActive={ds.station.slug === radio.station?.slug}
                        onStationClick={() => goStation(ds.station.slug)}
                        onPlay={() => void radio.toggle(ds.station)}
                        displayMode={crossingSourceMode}
                      />
                    ))}
                    {!showAllOffline && offlineStations.length > offlineWithProvenance.length && (
                      <button
                        className="dial-show-more"
                        onClick={() => setShowAllOffline(true)}
                      >
                        See all {offlineStations.length} stations
                      </button>
                    )}
                    {showAllOffline && offlineStations.length > offlineWithProvenance.length && (
                      <button
                        className="dial-show-more"
                        onClick={() => setShowAllOffline(false)}
                      >
                        See less
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ padding: "20px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 12 }}>
                    No recent station data
                  </div>
                )}
              </>
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

// ---------------------------------------------------------------------------
// Seed prompt sub-components
// SeedInput is shared (./SeedInput.tsx). SeedBar is local — it wraps the chips
// and the shared SeedInput and appends the Dial-specific "Import library →" link.
// ---------------------------------------------------------------------------

function SeedBar({
  seeds,
  onAddSeed,
  onRemoveSeed,
}: {
  seeds: string[];
  onAddSeed: (artist: string) => void;
  onRemoveSeed: (artist: string) => void;
}) {
  return (
    <div className="seed-bar">
      <span className="seed-bar__label">Tuned for</span>
      <div className="seed-bar__chips">
        {seeds.map((s) => (
          <span key={s} className="seed-chip seed-chip--sm">
            {s}
            <button
              type="button"
              className="seed-chip__remove"
              aria-label={`Remove ${s}`}
              onClick={() => onRemoveSeed(s)}
            >×</button>
          </span>
        ))}
        {seeds.length < 10 && (
          <SeedInput seeds={seeds} onAdd={onAddSeed} placeholder="+ artist" />
        )}
      </div>
      <a className="seed-bar__upgrade" href="/lore/library">
        Import library →
      </a>
    </div>
  );
}

function Zone1Placeholder({
  isSpotifyConnected,
  hasLibrary,
  hasSeeds,
  seeds,
  liveLoading,
  onAddSeed,
  onRemoveSeed,
}: {
  isSpotifyConnected: boolean;
  hasLibrary: boolean;
  hasSeeds: boolean;
  seeds: string[];
  liveLoading: boolean;
  onAddSeed: (artist: string) => void;
  onRemoveSeed: (artist: string) => void;
}) {
  if (hasLibrary || isSpotifyConnected) {
    // Library imported or Spotify connected — crossings are being computed.
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

  if (hasSeeds) {
    return (
      <div className="z1-placeholder z1-placeholder--seeded">
        <div className="seed-bar-row">
          <SeedBar
            seeds={seeds}
            onAddSeed={onAddSeed}
            onRemoveSeed={onRemoveSeed}
          />
          <button
            type="button"
            className="seed-bar__edit-link"
            onClick={() => window.dispatchEvent(new CustomEvent("lore:open-import-modal", { detail: { mode: "artist-seeds" } }))}
          >
            Edit artists →
          </button>
        </div>
        <div className="z1-placeholder__status">
          <span className="dial-live-skeleton__pip" />
          <span className="z1-placeholder__lbl">Finding live matches for your artists…</span>
        </div>
        <DialRowSkeleton delay={0} />
      </div>
    );
  }

  // New user — open the import modal to seed their taste.
  return (
    <div className="z1-placeholder z1-placeholder--seed">
      <div className="z1-placeholder__body">
        <p className="z1-placeholder__pitch">
          Pick the artists you love — Lore will show you when they're playing live.
        </p>
        <div className="z1-placeholder__secondary">
          <button
            type="button"
            className="dial-ctabtn"
            onClick={() => window.dispatchEvent(new Event("lore:open-import-modal"))}
          >
            Pick artists you love →
          </button>
        </div>
      </div>
    </div>
  );
}

export function LiveArtistPicker({
  suggestions,
  artists,
  loading,
  seeds,
  onAddSeed,
  mattStarterAvailable = false,
  mattStarterCopying = false,
  mattStarterError = null,
  onStartMattLibrary,
}: {
  suggestions?: LiveArtistSuggestion[];
  /** Unified historical + live list. Optional for callers that only show live data. */
  artists?: OnboardingArtistSuggestion[];
  loading: boolean;
  seeds: string[];
  onAddSeed: (artist: string) => void;
  mattStarterAvailable?: boolean;
  mattStarterCopying?: boolean;
  mattStarterError?: string | null;
  onStartMattLibrary?: () => void;
}) {
  const liveSuggestions = suggestions ?? [];
  const selected = new Set(seeds.map((seed) => liveIdentityKey(seed)));
  const rows: OnboardingArtistSuggestion[] = artists?.length
    ? artists
    : liveSuggestions.map((suggestion) => ({
        ...suggestion,
        live: true,
        playCount: suggestion.playCount ?? null,
      }));
  return (
    <section className="live-artist-picker" aria-labelledby="live-artist-picker-label">
      <div className="live-artist-picker__heading">
        <span className="live-artist-picker__pip" aria-hidden="true" />
        <div>
          <h2 id="live-artist-picker-label">Artists to start with</h2>
          <p>Choose one of Lore’s most-played artists, or jump into what is live now.</p>
        </div>
      </div>
      {mattStarterAvailable && onStartMattLibrary && (
        <div className="live-artist-picker__starter">
          <button
            type="button"
            className="live-artist-picker__option live-artist-picker__option--starter"
            onClick={onStartMattLibrary}
            disabled={mattStarterCopying}
            aria-label="Start with Matt’s library"
          >
            <span className="live-artist-picker__artist">Start with Matt’s library</span>
            <span className="live-artist-picker__context">A resolved starter library, ready for Lore crossings</span>
            <span className="live-artist-picker__action">{mattStarterCopying ? "Adding…" : "Start here"}</span>
          </button>
          {mattStarterError && (
            <div className="live-artist-picker__state" role="alert">
              {mattStarterError.includes("not available")
                ? mattStarterError
                : "We couldn’t add Matt’s library. Try again or choose an artist below."}
            </div>
          )}
        </div>
      )}
      {loading && rows.length === 0 ? (
        <div className="live-artist-picker__state" role="status">Listening for artists on air…</div>
      ) : rows.length > 0 ? (
        <>
          <div className="live-artist-picker__options">
            {rows.map((suggestion) => {
            const isSelected = selected.has(liveIdentityKey(suggestion.artist));
            const isAtLimit = seeds.length >= 10 && !isSelected;
            return (
              <button
                key={suggestion.artist.toLocaleLowerCase()}
                type="button"
                className={`live-artist-picker__option${isSelected ? " live-artist-picker__option--selected" : ""}${suggestion.live ? " live-artist-picker__option--live" : ""}`}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Selected" : "Choose"} ${suggestion.artist}`}
                disabled={isAtLimit}
                onClick={() => onAddSeed(suggestion.artist)}
              >
                <span className="live-artist-picker__artist">{suggestion.artist}</span>
                <span className="live-artist-picker__context">
                  {suggestion.live
                    ? [
                        suggestion.djName,
                        suggestion.showName,
                        suggestion.stationName,
                        "live now",
                      ].filter(Boolean).join(" · ")
                    : suggestion.playCount != null
                      ? `${suggestion.playCount} plays in Lore`
                      : "Lore history"}
                </span>
                <span className="live-artist-picker__action">
                  {suggestion.live ? "live now · " : ""}
                  {isSelected ? "Selected" : "Choose"}
                </span>
              </button>
            );
            })}
          </div>
          {seeds.length >= 10 && (
            <div className="live-artist-picker__limit" role="status">
              Ten artists selected — remove one below to choose another.
            </div>
          )}
        </>
      ) : (
        <div className="live-artist-picker__state">No artist names are available right now. You can add one below.</div>
      )}
    </section>
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
        <div className="ghost-row__reason">
          <b className="fdrow__artist">{station.artistName}</b>
          {" on "}
          <span className="fdrow__station">{station.name}</span>
        </div>
      </div>
    </div>
  );
}
