/**
 * DialView — the Dial Radio timeline.
 *
 * Manages a level state machine (all → station → show → dj) and renders the
 * appropriate view at each level. The bottom pill-nav (Radio · Selectors ·
 * Library) lives in AppLayout; DialView renders the topbar/scanbar/subnav
 * chrome above the scroll body.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { SeedInput } from "./SeedInput";
import { Search } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useMyGhostMissed, useSpotifyLibraryConnected, startSpotifyLibraryConnect, useMyTasteSeeds, useSetTasteSeeds, useMattStarterLibrary, useStartMattLibrary, useMyWeeklyRecap, useMyAlbumAvatar, useMyPopularCrossings, useMyOverlapRunsFor, useMyOverlapRunsRecent, useMyRunCrossings, type GhostStation, type PopularCrossingArtist, type OverlapRun, type RunCrossingMoment } from "../lib/meHooks";
import { useGetStationNowPlaying, getGetStationNowPlayingQueryKey } from "@workspace/api-client-react";
import { useFrontDoorScan } from "../hooks/useFrontDoorScan";
import { StationLane } from "./StationLane";
import { ContextRail } from "./ContextRail";
import { SearchOverlay } from "./SearchOverlay";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { BottlePanel } from "./BottlePanel";
import { AlbumAvatarPicker } from "./AlbumAvatarPicker";
import { MoonPhaseGlyph } from "./MoonPhaseGlyph";
import { SlimSectionNav } from "./SlimSectionNav";
import { RUMOURS, onArtError } from "../lib/rumours";
import { useSocialMode, setSocialEnabled } from "../lib/social";
import { eligibleDjName, eligibleDjNames } from "@workspace/lore-attribution";
import {
  cleanLiveValue,
  sameLiveValue,
  nameNodes,
  crossingSentence,
  reason,
  intoSet,
  usableShowName,
  buildAttributedSentence,
  dialShowAsAttribution,
  type ReasonResult,
} from "./dialViewHelpers";
import { proxyArtUrl } from "../lib/proxyArt";
import { heroArtCandidates } from "../lib/artRes";
import { runDate, clockTime } from "../lib/format";

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
// ---------------------------------------------------------------------------
// Popular-crossing sentence — Also-On-Air "onboarding crossing sort"
// ---------------------------------------------------------------------------

/** Cap on setlist names shown before the "N more" expand affordance. */
const SETLIST_VISIBLE = 8;

/**
 * Full in-order setlist for Also-On-Air rows: every artist in the station's
 * recent set, in spin order. Two-tone scheme: bright white = in your library
 * (or seeded this session); gray = everything else. Non-library names carry a
 * dotted underline and are themselves the click target to add the artist —
 * once added they flip to white and stop being clickable.
 * Library artists are excluded (they surface in ON AIR), but artists seeded
 * this session stay visible in white until the next refresh so they don't
 * vanish under the click.
 * Long sets collapse behind an "N more" toggle to keep the dial legible.
 */
function PopCrossingLine({ artists, seedsLower, onAdd }: {
  artists: PopularCrossingArtist[];
  seedsLower: Set<string>;
  onAdd: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inLib = (a: PopularCrossingArtist) => a.inLibrary || seedsLower.has(a.name.trim().toLowerCase());
  // Library artists (server flag from load time) are excluded — they already
  // surface in the ON AIR section. Session-seeded artists remain (inLib()
  // styles them orange-red without a "+").
  const set = artists.filter((a) => !a.inLibrary);
  if (set.length === 0) return null;
  const visible = expanded ? set : set.slice(0, SETLIST_VISIBLE);
  const hidden = set.length - visible.length;

  const span = (a: PopularCrossingArtist) =>
    inLib(a) ? (
      <b key={a.name} className="fdrow__artist fdrow__artist--lib">{a.name}</b>
    ) : (
      <button
        key={a.name}
        type="button"
        className="fdrow__artist fdrow__artist--add"
        aria-label={`Add ${a.name} to your artists`}
        onClick={(e) => { e.stopPropagation(); onAdd(a.name); }}
      >{a.name}</button>
    );
  const nodes: ReactNode[] = [];
  visible.forEach((a, i) => {
    if (i > 0) nodes.push(" · ");
    nodes.push(span(a));
  });

  return (
    <>
      {nodes}
      {hidden > 0 && (
        <button
          type="button"
          className="fdrow__setmore"
          aria-expanded={false}
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        >{`${hidden} more`}</button>
      )}
      {expanded && set.length > SETLIST_VISIBLE && (
        <button
          type="button"
          className="fdrow__setmore"
          aria-expanded={true}
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
        >less</button>
      )}
    </>
  );
}

/**
 * Full setlist for the expanded "this set:" block.
 *
 * Renders artist names as a flex-wrap pill grid — every line starts at the
 * same left edge, no ragged wrap, each chip is a touch-friendly tap target.
 *
 * Two-tone rules (same as the inline sentence):
 *   - in library / seeded this session → bright white, inert.
 *   - everything else → gray with a dotted underline; clicking the name adds
 *     the artist and the chip immediately flips to white via seedsLower.
 */
function AlsoSentence({ artists, seedsLower, onAdd }: {
  artists: PopularCrossingArtist[];
  seedsLower: Set<string>;
  onAdd: (name: string) => void;
}) {
  const isSeeded = (a: PopularCrossingArtist) =>
    a.inLibrary || seedsLower.has(a.name.trim().toLowerCase());

  const pillCls = (a: PopularCrossingArtist): string =>
    isSeeded(a) ? "also-pill also-pill--lib" : "also-pill also-pill--add";

  return (
    <div className="also-pill-grid">
      {artists.map((a) => {
        const addable = !isSeeded(a);
        return (
          <button
            key={a.name}
            type="button"
            className={pillCls(a)}
            onClick={addable ? (e) => { e.stopPropagation(); onAdd(a.name); } : undefined}
            aria-label={addable ? `Add ${a.name}` : a.name}
          >
            <span className="also-pill__name">{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ScrubItem {
  slug: string;
  name: string;
  /** Popular-crossing weight (same stat as the triangle sort). */
  score: number;
  /** Set carries at least one new-to-Lore / new-to-you artist. */
  hasNew: boolean;
}

/**
 * Right-edge scrubber for the Also-On-Air list. One tick per station in the
 * current sort order — tick length tracks the station's popular-crossing
 * weight (so the lime gradient IS the sort, in either triangle direction),
 * canary ticks mark sets carrying new artists. Dragging scrubs the full
 * list; a bubble names the station under the finger.
 */
function PopScrubber({ items, onScrub }: {
  items: ScrubItem[];
  onScrub: (item: ScrubItem, index: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  // Active selection is tracked by slug so a live-data reorder mid-drag can't
  // silently retarget the bubble/ARIA state at a different station.
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const pointerId = useRef<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);
  const maxScore = Math.max(1, ...items.map((i) => i.score));
  const active = activeSlug != null ? items.findIndex((i) => i.slug === activeSlug) : -1;

  const select = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setActiveSlug(it.slug);
    onScrub(it, idx);
  };
  const pick = (clientY: number) => {
    const el = railRef.current;
    if (!el || items.length === 0) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    select(Math.min(items.length - 1, Math.floor(f * items.length)));
  };
  const release = () => {
    pointerId.current = null;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => { setActiveSlug(null); clearTimer.current = null; }, 700);
  };

  return (
    <div
      ref={railRef}
      className="popscrub"
      role="slider"
      tabIndex={0}
      aria-label="Scrub the station list"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      aria-valuenow={active >= 0 ? active : 0}
      aria-valuetext={active >= 0 ? items[active]?.name : undefined}
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientY);
      }}
      onPointerMove={(e) => { if (pointerId.current === e.pointerId) pick(e.clientY); }}
      onPointerUp={(e) => { if (pointerId.current === e.pointerId) release(); }}
      onPointerCancel={(e) => { if (pointerId.current === e.pointerId) release(); }}
      onKeyDown={(e) => {
        const cur = active >= 0 ? active : -1;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); select(Math.min(items.length - 1, cur + 1)); }
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); select(Math.max(0, cur - 1)); }
        else if (e.key === "Home") { e.preventDefault(); select(0); }
        else if (e.key === "End") { e.preventDefault(); select(items.length - 1); }
      }}
      onBlur={release}
    >
      {items.map((it, i) => (
        <div
          key={it.slug}
          className={[
            "popscrub__tick",
            it.hasNew ? "popscrub__tick--new" : "",
            i === active ? "popscrub__tick--active" : "",
          ].filter(Boolean).join(" ")}
          style={{ width: 4 + Math.round((it.score / maxScore) * 10) }}
        />
      ))}
      {active != null && items[active] && (
        <div
          className="popscrub__bubble"
          style={{ top: `${((active + 0.5) / items.length) * 100}%` }}
        >
          {items[active].name}
        </div>
      )}
    </div>
  );
}

interface FrontDoorRowProps {
  ds: DialStation;
  show: DialShow | null;
  ov: number;          // lifetime selector overlap (attributed) or 24h crossings (unattributed)
  isActive: boolean;
  isSampling: boolean;
  onTuneIn: () => void;
  displayMode?: DialDisplayMode;
  presence?: StationPresence;
  /** Artwork URL for the currently-playing track — renders a right-edge fade when active */
  artworkUrl?: string | null;
  /** Popular-crossing sentence (Also-On-Air): replaces the tier-1 reason line. */
  popLine?: ReactNode | null;
  /** When set, tags the row root so the Also-On-Air scrubber can scroll to it. */
  scrubSlug?: string;
  /** Full setlist for the station — powers the clickable-"and" expansion. */
  setArtists?: PopularCrossingArtist[] | null;
  seedsLower?: Set<string>;
  onAddArtist?: (name: string) => void;
  /** When provided, "this set" opens the reserved sidebar panel instead of
      expanding inline (the row never renders fdrow__also-block). */
  onSetExpand?: (artists: PopularCrossingArtist[]) => void;
}

export function FrontDoorRow({ ds, show, ov, isActive, isSampling, onTuneIn, displayMode = "personal", presence, artworkUrl, popLine, scrubSlug, setArtists, seedsLower, onAddArtist, onSetExpand }: FrontDoorRowProps) {
  const usableDjList = eligibleDjNames(
    { name: show?.showName ?? "", djName: show?.djName ?? undefined, djNames: show?.djNames },
    { artist: show?.currentTrack?.artist, title: show?.currentTrack?.title, showTitle: show?.showName, stationName: ds.station.name },
  );
  const usableDj = usableDjList.length === 1 ? usableDjList[0] : null;
  const safeShow = show && usableDj !== show.djName
    ? { ...show, djName: usableDj }
    : show;
  const rz = reason(safeShow, ds.crossings, ds.artistCrossings, displayMode, ds.topArtistNames);

  // Clickable-"and" expansion: probe the sentence first to learn which artist
  // names it already shows, derive the rest of the set (setlist order, library
  // artists excluded), then rebuild with the toggle wired only when there is
  // actually something to reveal. crossingSentence is pure, so the double call
  // is cheap.
  const [alsoExpanded, setAlsoExpanded] = useState(false);
  const probe = crossingSentence(ds.station.name, safeShow, displayMode);
  const remainingSet = useMemo(() => {
    if (!probe || !setArtists || !seedsLower || !onAddArtist) return [];
    return setArtists.filter((a) =>
      !a.inLibrary && !probe.artistsShown.some((s) => sameLiveValue(s, a.name)));
  // probe is rebuilt each render but its artistsShown is derived from show data
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeShow, displayMode, setArtists, seedsLower, onAddArtist]);
  const crossing = remainingSet.length > 0 && seedsLower && onAddArtist
    ? crossingSentence(ds.station.name, safeShow, displayMode, {
        expanded: onSetExpand ? false : alsoExpanded,
        onToggle: onSetExpand
          ? () => onSetExpand(remainingSet)
          : () => setAlsoExpanded((v) => !v),
        node: null, // expanded content rendered as fdrow__also-block below tier1
      })
    : probe;
  // In blended mode: live sentence is a secondary attribution line shown below rz.node
  // (the community count). It uses only public DJ/track metadata — no personal flags.
  // In personal mode: live sentence fills in when there is no crossing sentence.
  const live = displayMode === "blended"
    ? liveSentence(ds.station.name, safeShow)
    : crossing ? null : liveSentence(ds.station.name, safeShow);
  // Tier 1 always shows the community aggregate sentence in blended mode.
  // Popular-crossing sentence (Also-On-Air) outranks the dim fallback reason
  // but never a personal crossing sentence — your own library evidence wins.
  const usePop = displayMode !== "blended" && !crossing && popLine != null;
  const tier1Cls = displayMode === "blended"
    ? rz.cls
    : crossing ? rz.cls : usePop ? "fdrow__pop-sentence" : live ? "fdrow__live-sentence" : rz.cls;
  const tier1Node = displayMode === "blended"
    ? rz.node
    : crossing?.node ?? (usePop ? popLine : null) ?? live?.node ?? rz.node;
  const dj = usableDj;
  const stationLabel = cleanLiveValue(ds.station.name) ?? ds.station.name;

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
      data-scrub-slug={scrubSlug}
      role="button"
      tabIndex={0}
      onClick={onTuneIn}
      onKeyDown={(e) => e.key === "Enter" && onTuneIn()}
    >
      {isActive && artworkUrl && (
        <div
          className="fdrow__art-fade"
          style={{ backgroundImage: `url(${proxyArtUrl(artworkUrl) ?? artworkUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className="fdrow__c">
        {/* Tier 1: reason sentence — leads at full display weight */}
        <div className={`fdrow__t1 ${tier1Cls}`}>
          {tier1Node}
        </div>

        {/* "this set:" expanded block — shows the full station setlist below the
            crossing sentence when the listener clicks "this set".
            "this set:" label on the left is the collapse trigger. */}
        {!onSetExpand && alsoExpanded && remainingSet.length > 0 && seedsLower && onAddArtist && (
          <div className="fdrow__also-block" onClick={(e) => e.stopPropagation()}>
            <AlsoSentence artists={remainingSet} seedsLower={seedsLower} onAdd={onAddArtist} />
          </div>
        )}

        {/* Blended mode secondary: live DJ/track attribution shown below the
            community count. Uses only public DJ/track metadata, not personal
            crossing flags, so it is safe in an anonymised aggregate context. */}
        {displayMode === "blended" && live && (
          <div className="fdrow__live-secondary">
            {live.node}
          </div>
        )}

        <span className="sr-only">{ds.station.slug}</span>

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

      </div>

    </div>
  );
}

interface GhostRowProps {
  station: GhostStation;
  isActive: boolean;
  /** Called when the station has no qualifying run (runId === null). */
  onTuneIn: () => void;
}
function ZoneLabel({ label, hint, accent }: {
  label: string;
  hint?: string;
  accent?: "library" | "picker" | "live";
}) {
  return (
    <div className="fdzone-lbl">
      {accent && <span className={`fdzone-lbl__pip fdzone-lbl__pip--${accent}`} />}
      <span className="fdzone-lbl__text">{label}</span>
      {hint && <span className="fdzone-lbl__hint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DensitySpine — interactive crossing-density spine for coarse run navigation
// ---------------------------------------------------------------------------

/**
 * A horizontal row of clickable bins, one per crossing run, ordered oldest
 * (left) to newest (right).  Displays crossing density (owned count) as a
 * proportional bar height so dense regions are visually prominent.
 *
 * Interactions:
 * - Click a bin → onRunSelect(runIdx)
 * - Pointer-drag along the spine → continuously calls onRunSelect as the
 *   pointer moves, giving the "scan" feel of the coarse detent drag.
 *
 * Suppressed in Top Sets mode (caller controls visibility).
 */
export function DensitySpine({
  runs,
  activeIdx,
  onRunSelect,
}: {
  runs: OverlapRun[];
  activeIdx: number | null;
  onRunSelect: (idx: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  /** Map a clientX pixel to the nearest run index (newest=right, oldest=left). */
  const clientXToIdx = useCallback((clientX: number): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || runs.length === 0) return 0;
    // x=0 → oldest run (highest array index); x=1 → newest (idx 0)
    const ratio = (clientX - rect.left) / rect.width;
    const raw = (1 - Math.max(0, Math.min(1, ratio))) * (runs.length - 1);
    return Math.round(raw);
  }, [runs.length]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    onRunSelect(clientXToIdx(e.clientX));
  }, [clientXToIdx, onRunSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    onRunSelect(clientXToIdx(e.clientX));
  }, [clientXToIdx, onRunSelect]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  if (runs.length === 0) return null;

  const maxOwned = Math.max(...runs.map((r) => r.owned), 1);

  return (
    <div
      ref={containerRef}
      className={`dial-density-spine${runs.length > 60 ? " dial-density-spine--dense" : ""}`}
      role="slider"
      aria-label="Crossing run navigator — drag to scan"
      aria-valuemin={0}
      aria-valuemax={runs.length - 1}
      aria-valuenow={activeIdx ?? 0}
      data-spine="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Display oldest → newest (runs array is newest-first, so reverse) */}
      {[...runs].reverse().map((run, displayIdx, reversed) => {
        const runIdx = runs.length - 1 - displayIdx; // convert back to array index
        const isActive = runIdx === activeIdx;
        const heightPct = Math.max(10, Math.round((run.owned / maxOwned) * 100));
        // Mark the first run of each calendar day so wide ranges stay legible.
        const dayStart = displayIdx > 0 && reversed[displayIdx - 1]!.day !== run.day;
        return (
          <button
            key={run.runId}
            type="button"
            className={`dial-density-spine__bin${isActive ? " dial-density-spine__bin--active" : ""}${dayStart ? " dial-density-spine__bin--daystart" : ""}`}
            style={{ height: `${heightPct}%` }}
            data-run-idx={runIdx}
            data-day={run.day}
            aria-label={`${run.day} — ${run.owned} library tracks`}
            onClick={(e) => {
              e.stopPropagation();
              onRunSelect(runIdx);
            }}
          />
        );
      })}
    </div>
  );
}

export type TtMode = "live" | "past" | "top";

// Constants for the past-scan density spine.
// Synthetic timestamps assign each run a unique X-position (oldest run → smallest
// timestamp) so that multiple runs on the same calendar day get distinct spine bins.
// The spine maps hourMs back to a run index via:
//   binIdx = round((hourMs - PAST_SCAN_BIN_BASE_MS) / PAST_SCAN_BIN_STEP_MS)
//   runIdx = runs.length - 1 - binIdx   (reversal: pastScanBins is oldest-first)
export const PAST_SCAN_BIN_BASE_MS = new Date("2020-01-01T00:00:00Z").getTime();
export const PAST_SCAN_BIN_STEP_MS = 3_600_000; // 1 hour per bin slot

// ---------------------------------------------------------------------------
// RunRow — a historical crossing run row (day mode / top sets mode)
// ---------------------------------------------------------------------------

/**
 * A single run from /me/overlaps/runs, rendered in the style of a FrontDoorRow.
 * Clicking navigates to /archive/station-runs/{runId} — the station-run archive
 * page that shows the full tracklist and optionally starts a ride.
 *
 * NOTE: runId here is min(spin.id) for the run grouping, which is the same anchor
 * the station-run archive uses. It is NOT a replay manifest ID; routing to
 * /replay/{runId} would silently fail for runs without a manifest.
 */
function RunRow({ run, focused = false }: { run: OverlapRun; focused?: boolean }) {
  const [, navigate] = useLocation();
  const djName = run.show?.djName ?? null;
  const showName = run.show?.name ?? null;

  return (
    <div
      className={`fdrow fdrow--run${focused ? " fdrow--run-focused" : ""}`}
      role="button"
      tabIndex={0}
      data-run-id={run.runId}
      onClick={() => navigate(`/archive/station-runs/${run.runId}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/archive/station-runs/${run.runId}`);
        }
      }}
    >
      <div className="fdrow__run-main">
        <span className="fdrow__station">{run.station.name}</span>
        {djName && <b className="fdrow__dj"> · {djName}</b>}
        {showName && !djName && (
          <span className="fdrow__show"> · {showName}</span>
        )}
      </div>
      <div className="fdrow__run-sub">
        <span className="fdrow__owned">{run.owned} of yours</span>
        {run.discover > 0 && (
          <span className="fdrow__discover"> · {run.discover} new</span>
        )}
        <span className="fdrow__replay-badge"> · ▶ hear it</span>
        <span className="fdrow__run-day">{run.day}</span>
      </div>
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
/** Max taste seeds per user — must match MAX_SEEDS in api-server taste-seeds.ts. */
const MAX_TASTE_SEEDS = 50;

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
          {show.djName && <><b style={{ fontStyle: "normal", fontWeight: 400 }}>{show.djName}</b>{" · "}</>}
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
          <div style={{ padding: "20px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 14 }}>
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

/**
 * Find the index of the run in `runs` whose UTC broadcast day is nearest to
 * `hourMs` (epoch milliseconds). Returns 0 when the list is empty.
 *
 * Used by the density-spine tap/drag handlers to convert an hour position
 * into a coarse scan detent. Exported for unit testing in dialPastScan.test.tsx.
 */
export function findRunIndexByHour(hourMs: number, runs: OverlapRun[]): number {
  if (runs.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    // Use noon UTC for the run's day to produce a stable representative time.
    const runDayMs = new Date(run.day + "T12:00:00Z").getTime();
    const dist = Math.abs(runDayMs - hourMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
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
          {isFuture && <span style={{ color: "hsl(var(--faint))", fontSize: 9 }}>Soon</span>}
          {!isLive && !isFuture && warm && <span className="dial-sch-badge--cross">◆ {show.crossings}</span>}
          {show.isPickerShow && <span className="dial-sch-badge--sel">Selector</span>}
        </div>
      </div>
    );
  };

  return (
    <div>
      {pastAndLive.length === 0 && upcoming.length === 0 && (
        <div style={{ padding: "24px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 14 }}>
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

  // ── Attribution helpers ───────────────────────────────────────────────────
  const showCrossings = lastShow?.crossings ?? 0;
  const showArtistCrossings = lastShow?.artistCrossings ?? 0;

  // Resolve single eligible DJ name — null when unknown or multiple (ambiguous).
  const _djList = lastShow ? eligibleDjNames(dialShowAsAttribution(lastShow)) : [];
  const djName = _djList.length === 1 ? _djList[0] : null;
  // Sanitised show name — suppresses DJ-echo and placeholder values.
  const showName = usableShowName(lastShow);

  // Broadcast date + time for the row timing label.
  const timingSrc = lastShow?.startedAt ?? null;
  const timing = timingSrc
    ? `${runDate(timingSrc)} · ${clockTime(timingSrc)}`
    : "";

  // ── Tier 1: reason — via buildAttributedSentence ────────────────────────
  let t1Node: ReactNode;
  let t1Cls: string;
  if (showCrossings > 0) {
    const names = (displayMode === "blended" && stationTopArtistNames.length > 0)
      ? stationTopArtistNames
      : (lastShow?.topArtists ?? []);
    const nn = names.length > 0 ? nameNodes(names) : null;
    t1Node = buildAttributedSentence(nn, showCrossings, "of yours", djName, showName, timing);
    t1Cls = "w3";
  } else if (showArtistCrossings > 0) {
    const names = (displayMode === "blended" && stationTopArtistNames.length > 0)
      ? stationTopArtistNames
      : (lastShow?.topArtistNames ?? []);
    const nn = names.length > 0 ? nameNodes(names) : null;
    t1Node = buildAttributedSentence(nn, showArtistCrossings, "artist matches", djName, showName, timing);
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
    t1Node = "—";
    t1Cls = "w0";
  }

  // ── Tier 3: station destination label — always station name ──────────────
  const t3Text = station.name;

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

        {/* Tier 3: station identity label */}
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
      if (current.some((s) => s.toLowerCase() === lower) || current.length >= MAX_TASTE_SEEDS) return current;
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

  // Popular crossings — Also-On-Air sentences + sort order.
  const { data: popCrossings = [] } = useMyPopularCrossings();
  const popMap = useMemo(
    () => new Map(popCrossings.map((i) => [i.stationSlug, i.artists])),
    [popCrossings],
  );
  const seedsLower = useMemo(
    () => new Set(visibleSeeds.map((s) => s.trim().toLowerCase())),
    [visibleSeeds],
  );
  /** Station sort weight: Lore-wide spins of its popular crossing artists. */
  const popScore = useCallback((slug: string) => {
    const artists = popMap.get(slug);
    if (!artists) return 0;
    // Library artists are excluded from the sentence, so they don't weigh
    // into the sort either — they already drive the ON AIR section.
    return artists.reduce((n, a) => n + (a.popular && !a.inLibrary ? a.spins : 0), 0);
  }, [popMap]);
  /**
   * Deep-cuts vector: the station's non-library spin counts sorted ascending.
   * The flipped sort reads each setlist from its rarest artist up — compare
   * lowest spin count first, then next-lowest, and so on. A set carrying a
   * one-spin-ever artist always surfaces, and between two such sets the one
   * with more rare depth wins. This is a transparent ledger stat (Lore-wide
   * spins), never a taste profile — nothing is hidden, only reordered.
   */
  const rareVector = useCallback((slug: string): number[] => {
    const artists = popMap.get(slug);
    if (!artists) return [];
    return artists
      .filter((a) => !a.inLibrary)
      .map((a) => a.spins)
      .sort((x, y) => x - y);
  }, [popMap]);
  // Triangle toggle: up (true) = popular-heavy sets first; down = deep-cuts
  // (rarest-artist-first) ordering. Pure client-side re-sort.
  const [popSortDesc, setPopSortDesc] = useState(true);
  /** Signed comparison for the active sort mode; 0 when tied (fallbacks apply). */
  const popCompare = useCallback((aSlug: string, bSlug: string) => {
    if (popSortDesc) return popScore(bSlug) - popScore(aSlug);
    // Lexicographic rarest-first: stations without setlist data sort last.
    const av = rareVector(aSlug);
    const bv = rareVector(bSlug);
    if (av.length === 0 || bv.length === 0) return bv.length - av.length;
    const n = Math.min(av.length, bv.length);
    for (let i = 0; i < n; i++) {
      if (av[i] !== bv[i]) return av[i] - bv[i]; // rarer artist wins
    }
    return bv.length - av.length; // equal prefix: deeper rare set wins
  }, [popSortDesc, popScore, rareVector]);
  /** Whether the setlist line would actually render content for this station. */
  const popHasContent = useCallback((slug: string) => {
    const artists = popMap.get(slug);
    if (!artists) return false;
    return artists.some((a) => !a.inLibrary);
  }, [popMap]);

  // Bridge: player-ticker artist clicks → addSeed (ticker lives in PlayerBar)
  useEffect(() => {
    const handler = (e: Event) => addSeed((e as CustomEvent<string>).detail);
    window.addEventListener("lore:add-ticker-artist", handler);
    return () => window.removeEventListener("lore:add-ticker-artist", handler);
  }, [addSeed]);

  // Delay skeleton visibility so fast loads (< 150 ms) never flash shimmer rows.
  // The delayed flag only flips true after crossingsLoading has been true for
  // 150 ms; it resets to false immediately when crossingsLoading clears so that
  // real content replaces skeletons without any extra lag.
  const showSkeleton = useDelayedBoolean(crossingsLoading, 150);
  // Zone 1 has settled when both crossing scores and the core station pulse have
  // resolved. At that point we know what's in Zone 1 and can show the tab strip.
  const zone1Settled = !crossingsLoading && !isCoreLoading;
  const isSpotifyConnected = useSpotifyLibraryConnected();
  const { radio, ride } = usePlayer();
  const { data: weeklyRecapData } = useMyWeeklyRecap();
  // Artwork for the now-playing row indicator
  const activeSlug = radio.station?.slug ?? "";
  const { data: activeNpData } = useGetStationNowPlaying(activeSlug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(activeSlug),
      enabled: !!radio.station,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });
  const activeArtworkUrl = activeNpData?.nowPlaying?.recording?.artworkUrl
    ?? activeNpData?.nowPlaying?.artworkUrl
    ?? null;
  const { data: avatarData } = useMyAlbumAvatar();
  // Rumours is the universal fallback — ensures the topbar gradient always renders
  // even for brand-new users who haven't connected a library yet.
  const avatarUrl = avatarData?.current?.artworkUrl ?? avatarData?.candidates?.[0]?.artworkUrl ?? RUMOURS;
  // Pre-verified hero art. The topbar wash is a CSS background (no onError),
  // so a dead avatar URL would silently render nothing. Start with the local
  // RUMOURS asset (always loads), then swap to the real avatar art only once
  // the browser has confirmed it actually loads. The fullscreen hero reuses
  // the same resolved URL, so it's always a cached, known-good image.
  // Dedicated hi-res pipeline for the hero cover: look the album up by
  // artist + title on sources that serve true 1200px masters (iTunes, then
  // Cover Art Archive by release-group), then fall back to the upscaled or
  // original library URL, then RUMOURS. Each candidate is probed offscreen,
  // so whichever wins is fully cached before it's ever displayed — the
  // moon-tap hero appears instantly at full quality.
  const avatarAlbum = avatarData?.current ?? avatarData?.candidates?.[0] ?? null;
  const [heroArt, setHeroArt] = useState<string>(RUMOURS);
  useEffect(() => {
    if (!avatarAlbum || !avatarUrl || avatarUrl === RUMOURS) { setHeroArt(RUMOURS); return; }
    let cancelled = false;
    void heroArtCandidates(avatarAlbum).then((urls) => {
      if (cancelled) return;
      const candidates = urls.map((u) => proxyArtUrl(u) ?? u);
      const tryLoad = (i: number) => {
        if (cancelled) return;
        if (i >= candidates.length) { setHeroArt(RUMOURS); return; }
        const probe = new Image();
        probe.onload = () => { if (!cancelled) setHeroArt(candidates[i]); };
        probe.onerror = () => tryLoad(i + 1);
        probe.src = candidates[i];
      };
      tryLoad(0);
    });
    return () => { cancelled = true; };
    // avatarUrl is derived from avatarAlbum; keying on it keeps deps simple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarAlbum?.recordingMbid, avatarUrl]);
  // "+ Artists" tab — inline add-artists input in the tab bar (replaces the
  // old bottom artist-add strip). Submits via the same custom event the
  // ticker listens to, so no shared state is needed.
  const [addArtistsOpen, setAddArtistsOpen] = useState(false);
  const [addArtistsText, setAddArtistsText] = useState("");
  const submitAddArtists = useCallback((raw: string) => {
    const names = raw.split(/[\n,;|•·]+/).map((s) => s.trim()).filter(Boolean);
    names.forEach((name) =>
      window.dispatchEvent(new CustomEvent("lore:add-ticker-artist", { detail: name })),
    );
    setAddArtistsText("");
    setAddArtistsOpen(false);
  }, []);

  // Fullscreen album-art overlay, opened by tapping the moon glyph in the topbar.
  const moonBtnRef = useRef<HTMLButtonElement>(null);
  const artCloseBtnRef = useRef<HTMLButtonElement>(null);
  // Whichever control opened the overlay (moon or hero art) gets focus back.
  const artOpenerRef = useRef<HTMLElement | null>(null);
  const [albumArtOpen, setAlbumArtOpen] = useState(false);
  useEffect(() => {
    if (!albumArtOpen) return;
    // Move focus into the overlay so keyboard users can reach the close button.
    artCloseBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAlbumArtOpen(false);
      }
      // Trap Tab/Shift+Tab — the only focusable element inside the overlay is
      // the close button, so both directions stay there.
      if (e.key === "Tab") {
        e.preventDefault();
        artCloseBtnRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Return focus to whichever control opened the overlay.
      (artOpenerRef.current ?? moonBtnRef.current)?.focus();
    };
  }, [albumArtOpen]);
  const hasWeeklyRecap = weeklyRecapData != null && (
    weeklyRecapData.stationsAttended.stations.length > 0 ||
    weeklyRecapData.firstEverHeards.items.length > 0 ||
    weeklyRecapData.ripenedCrossings.items.length > 0
  );

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
  // Merged-tab display order for the crossing rows: default (▲) keeps the
  // attribution-ladder order; flipped (▼) is its exact inverse, so the least-
  // crossed stations lead and the strongest crossings sink to the bottom.
  const zone1Display = useMemo(
    () => popSortDesc ? withReason : [...withReason].reverse(),
    [withReason, popSortDesc],
  );

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
        // Popular-crossing weight first (triangle up: popular-heavy first;
        // down: deep-cuts first), then picker overlap as the fallback.
        const cmp = popCompare(a.ds.station.slug, b.ds.station.slug);
        if (cmp !== 0) return cmp;
        const aOv = pickerOv(a.show?.pickerId ?? null, a.effectiveDjName);
        const bOv = pickerOv(b.show?.pickerId ?? null, b.effectiveDjName);
        return bOv - aOv;
      }),
  // pickerOv closure reads overlapByPickerId/pickerNameToId from outer scope
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [alsoOnAir, overlapByPickerId, pickerNameToId, popCompare]);

  const restBand = useMemo(() =>
    alsoOnAir
      .filter((row) => row.rz.r !== 5)
      .sort((a, b) => {
        // Pinned stations float above non-pinned regardless of crossing count.
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        // Popular-crossing weight (triangle up/down) …
        const cmp = popCompare(a.ds.station.slug, b.ds.station.slug);
        if (cmp !== 0) return cmp;
        // … then lifetime station crossings as the fallback.
        return b.ds.lifetimeCrossings - a.ds.lifetimeCrossings;
      }),
  [alsoOnAir, popCompare]);

  // ── Merged-list scrubber ─────────────────────────────────────────────
  // One entry per on-air station in the current display order. Tick weight is
  // normalized per band (crossings for ON AIR rows, popScore for the rest) so
  // both gradients read at full width; hasNew mirrors the canary highlight.
  const scrubItems = useMemo<ScrubItem[]>(() => {
    const hasNew = (slug: string) =>
      (popMap.get(slug) ?? []).some((a) => !a.popular && !a.inLibrary && (a.debut || !a.heard));
    const zone1Max = Math.max(1, ...withReason.map((r) => r.ds.crossings + r.ds.artistCrossings));
    const alsoRows = popSortDesc ? [...djBand, ...restBand] : [...restBand, ...djBand];
    const popMax = Math.max(1, ...alsoRows.map((r) => popScore(r.ds.station.slug)));
    const z1 = zone1Display.map((row) => ({
      slug: row.ds.station.slug,
      name: cleanLiveValue(row.ds.station.name) ?? row.ds.station.name,
      score: Math.round(((row.ds.crossings + row.ds.artistCrossings) / zone1Max) * 100),
      hasNew: hasNew(row.ds.station.slug),
    }));
    const also = alsoRows.map((row) => ({
      slug: row.ds.station.slug,
      name: cleanLiveValue(row.ds.station.name) ?? row.ds.station.name,
      score: Math.round((popScore(row.ds.station.slug) / popMax) * 100),
      hasNew: hasNew(row.ds.station.slug),
    }));
    return popSortDesc ? [...z1, ...also] : [...also, ...z1];
  }, [withReason, zone1Display, djBand, restBand, popMap, popScore, popSortDesc]);
  const [scrubTarget, setScrubTarget] = useState<string | null>(null);
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

  // Offline stations (recently aired): always sorted by all-time crossings.
  const offlineStations = useMemo(() => {
    const lifetimeScore = (ds: DialStation): number =>
      ds.lifetimeCrossings + ds.lifetimeArtistCrossings;
    return [...stations]
      .filter((ds) => !ds.isLive)
      .sort((a, b) => lifetimeScore(b) - lifetimeScore(a));
  }, [stations]);

  // Two-state visibility gate for the offline section:
  //   Default: only stations with any lifetime crossings or named attribution.
  //   Expanded: all offline stations (dark stations included).
  const [showAllOffline, setShowAllOffline] = useState(false);
  const offlineWithProvenance = useMemo(() => {
    return offlineStations.filter(
      (ds) => ds.lifetimeCrossings + ds.lifetimeArtistCrossings > 0 || hasAttribution(ds),
    );
  }, [offlineStations]);
  const visibleOffline = showAllOffline ? offlineStations : offlineWithProvenance;

  // --- per-zone truncation (spec §16) ---
  // Zone 1: rung-1 rows are never hidden — expand the budget to cover them all.
  const rung1Count = useMemo(() => withReason.filter((r) => r.rz.r === 1).length, [withReason]);
  const zone1Visible = Math.max(Math.min(ZONE1_VISIBLE, 7), rung1Count);

  const [zone1Expanded, setZone1Expanded] = useState(false);
  const [zone2Expanded, setZone2Expanded] = useState(false);
  const [zone3Expanded, setZone3Expanded] = useState(false);
  /** Scrub → expand whichever collapsed band hides the row, then scroll to it. */
  const handleScrub = useCallback((item: ScrubItem) => {
    // Band membership is looked up by slug (not scrub index) so the logic is
    // independent of the current display order / sort direction.
    const z1Idx = zone1Display.findIndex((r) => r.ds.station.slug === item.slug);
    if (z1Idx >= zone1Visible) setZone1Expanded(true);
    const restIdx = restBand.findIndex((r) => r.ds.station.slug === item.slug);
    if (restIdx >= ZONE3_VISIBLE) setZone3Expanded(true);
    setScrubTarget(item.slug);
  }, [zone1Display, restBand, zone1Visible]);
  useEffect(() => {
    if (!scrubTarget) return;
    const el = document.querySelector(`[data-scrub-slug="${CSS.escape(scrubTarget)}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [scrubTarget, zone1Expanded, zone3Expanded]);


  // ── Time-travel mode (top sets toggle) ─────────────────────────────────────
  const [ttMode, setTtMode] = useState<TtMode>("live");

  // Fetch all-time top runs (only when top mode is active).
  const { data: ttTopRuns = [], isLoading: ttTopLoading } = useMyOverlapRunsFor(
    null,
    { enabled: ttMode === "top" },
  );

  // Dial range — how far back the coarse scan (and its density spine) reaches.
  // 2 = today + yesterday (default), 7 = a week, 30 = a month.
  const [ttRangeDays, setTtRangeDays] = useState<number>(2);

  // Fetch the recent crossing runs (reverse-chrono) — coarse scan detents.
  // Always fetched so coarse navigation is immediately available on first ← tap.
  const { data: recentRuns = [] } = useMyOverlapRunsRecent({ days: ttRangeDays });

  // Two-level past-scan state machine (coarse = runs, fine = crossing moments).
  const pastScan = usePastScanState(recentRuns);
  // Shorthand used by JSX and some callbacks.
  const currentRun = pastScan.currentRun;

  // Fine crossing moments for the currently-landed run.
  const { data: fineCrossings = [] } = useMyRunCrossings(
    pastScan.currentRun?.runId ?? null,
    { enabled: !pastScan.isAtLiveEdge },
  );

  // Start (or restart) ghost-radio replay at the given fine-crossing index.
  //
  // Seeds are built with `links: []` — the same established pattern used by
  // LibraryRow, StationScrubTimeline, and all other startReplay call-sites.
  // The PlayerProvider resolves preview URLs and link-outs on demand for each
  // seed via `getRecordingPreview(mbid)` + `getRecording(mbid)` (PlayerProvider
  // line ~1810 — triggered by `currentNeedsLinks && currentPreview === undefined`).
  // Passing empty links is intentional: pre-fetching them here would duplicate
  // work the player already does and add latency before playback starts.
  const startPastReplay = useCallback(
    (atIdx: number) => {
      if (fineCrossings.length === 0 || !pastScan.currentRun) return;
      const seeds: RideSeed[] = fineCrossings
        .filter((m): m is RunCrossingMoment & { mbid: string } => m.mbid !== null)
        .map((m) => ({
          mbid: m.mbid,
          title: m.trackTitle ?? "",
          artist: m.artistName ?? "",
          artworkUrl: null,
          links: [],
          // Propagate broadcast spin duration so the Tier-4 cue sheet can time
          // its "Next: {artist} — {title}" affordance correctly.  Null when
          // absent (42.3% of all-time spins) — cue sheet shows immediately.
          spinDurationSeconds: m.spinDurationSeconds ?? null,
        }));
      if (seeds.length === 0) return;

      // Translate source index (position in fineCrossings, which may contain
      // null-MBID entries the API schema permits) to seed index (position in the
      // filtered seeds[]).  Count non-null entries up to and including atIdx:
      //   non-null crossing  → seedIdx = nonNullCount - 1
      //   null-MBID crossing → clamp to preceding seed (play the last playable track)
      const nonNullUpTo = fineCrossings
        .slice(0, atIdx + 1)
        .filter((m) => m.mbid !== null).length;
      const selectedIsNull = (fineCrossings[atIdx]?.mbid ?? null) === null;
      const seedIdx = selectedIsNull
        ? Math.max(0, nonNullUpTo - 1) // clamp backward to preceding non-null seed
        : nonNullUpTo - 1;

      const run = pastScan.currentRun;
      const label = run.show?.djName
        ? `${run.show.djName} · ${run.station.name}`
        : run.station.name;
      ride.startReplay(seeds, label, {
        timeOrientation: "past",
        startIndex: Math.max(0, Math.min(seedIdx, seeds.length - 1)),
        context: "dial-past-scan",
      });
    },
    [fineCrossings, pastScan.currentRun, ride],
  );

  // Swipe handlers — attached to the past-scan card wrapper.
  // Each handler computes the landing fine-index before updating state so
  // startPastReplay receives the correct index without waiting for React to
  // flush the state update.
  const swipeHandlers = useSwipeHandler(
    useCallback(() => {
      if (fineCrossings.length === 0) return;
      const cur = pastScan.fineIdx ?? -1;
      const nextIdx = cur >= fineCrossings.length - 1 ? Math.max(cur, 0) : cur + 1;
      pastScan.nextCrossing(fineCrossings.length);
      startPastReplay(nextIdx);
    }, [pastScan, fineCrossings, startPastReplay]),
    useCallback(() => {
      if (fineCrossings.length === 0) return;
      const prevIdx = pastScan.fineIdx === null
        ? fineCrossings.length - 1
        : Math.max(pastScan.fineIdx - 1, 0);
      pastScan.prevCrossing(fineCrossings.length);
      startPastReplay(prevIdx);
    }, [pastScan, fineCrossings, startPastReplay]),
  );

  // Coarse landing playback: start ghost-radio replay at crossing index 0 whenever
  // the user lands on a new run via ← / → buttons or the density-spine.  Guards:
  //   • fineIdx must be null (fine landings are handled by crossing-row click/swipe)
  //   • fineCrossings must be loaded for the new run
  //   • only fires once per new run (coarseLandRunRef tracks the last started run)
  const coarseLandRunRef = useRef<number | null>(null);
  const currentRunIdForEffect = pastScan.currentRun?.runId ?? null;
  const fineIdxForEffect = pastScan.fineIdx;
  useEffect(() => {
    if (currentRunIdForEffect === null) {
      coarseLandRunRef.current = null; // reset when returning to live edge
      return;
    }
    if (fineIdxForEffect !== null) return; // fine navigation — handled separately
    if (fineCrossings.length === 0) return; // wait for the crossing fetch
    if (coarseLandRunRef.current === currentRunIdForEffect) return; // already started
    coarseLandRunRef.current = currentRunIdForEffect;
    startPastReplay(0);
  }, [currentRunIdForEffect, fineIdxForEffect, fineCrossings.length, startPastReplay]);

  const handleTtModeChange = useCallback((m: TtMode) => {
    setTtMode(m);
    pastScan.reset(); // clear past-scan on any mode change
  }, [pastScan]);

  // Effective mode: "past" when the user has stepped back at least one run,
  // "top" when top-sets mode is active, otherwise "live".
  const effectiveTtMode: TtMode = ttMode === "top" ? "top" : (pastScan.isAtLiveEdge ? "live" : "past");

  // ── Reserved sidebar set panel — expanded "this set" artists render here
  // (bottom quarter of the hero art sidebar) instead of expanding inline.
  const [setPanel, setSetPanel] = useState<{ slug: string; name: string; artists: PopularCrossingArtist[] } | null>(null);
  const toggleSetPanel = useCallback((slug: string, name: string, artists: PopularCrossingArtist[]) => {
    setSetPanel((cur) => (cur?.slug === slug ? null : { slug, name, artists }));
  }, []);

  // ── Hero art time-travel swipe — horizontal drag on the art steps runs.
  const swipeStartX = useRef<number | null>(null);
  const swipedRef = useRef(false);
  const heroSwipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => { swipeStartX.current = e.clientX; },
    onPointerUp: (e: React.PointerEvent) => {
      if (swipeStartX.current != null) {
        const dx = e.clientX - swipeStartX.current;
        if (Math.abs(dx) > 48) {
          swipedRef.current = true;
          if (dx > 0) pastScan.prevRun();
          else if (!pastScan.isAtLiveEdge) pastScan.nextRun();
        }
      }
      swipeStartX.current = null;
    },
  };

  // ── Fine-landing effect — fire startPastReplay(fineIdx) on crossing step ──
  // Fires when the user steps to a specific crossing (swipe or row click).
  useEffect(() => {
    if (pastScan.fineIdx === null) return;
    startPastReplay(pastScan.fineIdx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastScan.fineIdx]);

  // Slug-key strings — order-insensitive (sorted) so a live reorder of the same
  // stations does NOT reset expansion; only a real membership change does.
  const zone1SlugKey = useMemo(() => withReason.map((r) => r.ds.station.slug).sort().join(","), [withReason]);
  const zone2SlugKey = useMemo(() => ghost.map((g) => g.slug).sort().join(","), [ghost]);
  const zone3SlugKey = useMemo(() => alsoOnAir.map((r) => r.ds.station.slug).sort().join(","), [alsoOnAir]);

  // Track previous slug keys so the reset effect only fires on genuine membership
  // changes and NOT on the initial mount.
  const prevZone1SlugKey = useRef<string | null>(null);
  const prevZone2SlugKey = useRef<string | null>(null);
  const prevZone3SlugKey = useRef<string | null>(null);

  // Expand-time anchor — the slug key that was current when the user last clicked
  // "See all". If the zone's membership temporarily shrinks and then recovers to
  // exactly this key, the zone silently re-expands rather than staying collapsed.
  const zone1ExpandAnchor = useRef<string | null>(null);
  const zone2ExpandAnchor = useRef<string | null>(null);
  const zone3ExpandAnchor = useRef<string | null>(null);

  // Reset expansion when zone membership genuinely changes.
  // If the new key matches the expand-time anchor the user set, re-expand
  // silently instead of resetting (transient-shrink recovery).
  useEffect(() => {
    if (prevZone1SlugKey.current === null) { prevZone1SlugKey.current = zone1SlugKey; return; }
    if (prevZone1SlugKey.current === zone1SlugKey) return;
    prevZone1SlugKey.current = zone1SlugKey;
    if (zone1ExpandAnchor.current === zone1SlugKey) { setZone1Expanded(true); return; }
    setZone1Expanded(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone1SlugKey]);
  useEffect(() => {
    if (prevZone2SlugKey.current === null) { prevZone2SlugKey.current = zone2SlugKey; return; }
    if (prevZone2SlugKey.current === zone2SlugKey) return;
    prevZone2SlugKey.current = zone2SlugKey;
    if (zone2ExpandAnchor.current === zone2SlugKey) { setZone2Expanded(true); return; }
    setZone2Expanded(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone2SlugKey]);
  useEffect(() => {
    if (prevZone3SlugKey.current === null) { prevZone3SlugKey.current = zone3SlugKey; return; }
    if (prevZone3SlugKey.current === zone3SlugKey) return;
    prevZone3SlugKey.current = zone3SlugKey;
    if (zone3ExpandAnchor.current === zone3SlugKey) { setZone3Expanded(true); return; }
    setZone3Expanded(false);
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
  // is safe.
  useEffect(() => {
    if (scan.samplingIdx == null) return;
    // scan indexes into withReason; convert to the displayed position, which is
    // reversed when the triangle sort is flipped.
    const displayIdx = popSortDesc ? scan.samplingIdx : withReason.length - 1 - scan.samplingIdx;
    if (displayIdx >= zone1Visible) setZone1Expanded(true);
  }, [scan.samplingIdx, zone1Visible, popSortDesc, withReason.length]);

  // Active row index: scan cursor → playing station → none (-1)
  const activeIdx = useMemo(() => {
    if (scan.samplingIdx != null) return scan.samplingIdx;
    if (radio.station) {
      const idx = withReason.findIndex((row) => row.ds.station.slug === radio.station!.slug);
      return idx >= 0 ? idx : -1;
    }
    return -1;
  }, [scan.samplingIdx, radio.station, withReason]);

  const activeRow = activeIdx >= 0 ? (withReason[activeIdx] ?? null) : null;

  // Top row for Listen button label (spec §10) — kept for potential reuse
  const topRow = sortedRows[0] ?? null;

  const handleScanLand = useCallback(() => {
    const idx = scan.samplingIdx;
    if (idx != null && withReason[idx]) {
      scan.land();
      void radio.toggle(withReason[idx].ds.station);
    } else {
      scan.land();
    }
  }, [scan, withReason, radio]);

  // --- topbar helpers ---

  const MATTS_LIBRARY: readonly string[] = [
    "Cocteau Twins", "Talk Talk", "Beach House", "Grouper",
    "Tim Hecker", "Mount Eerie", "Low", "Julianna Barwick",
    "William Basinski", "Stars of the Lid", "Broadcast",
    "Silver Apples", "Arthur Russell", "Harold Budd",
  ];

  // --- topbar ---
  function renderTopbar() {
    if (level === "all") {
      const isPlaying = radio.status === "playing";
      return (
        <div className="dial-topbar dial-topbar--all">
          {/* Wordmark — plain "Lore" text, left-justified like the list.
              The moon moved down to the time-travel strip, where its phase
              tracks the scrubbed date. (Solo/LP toggle machinery kept.) */}
          <span className="dial-topbar__wordmark" aria-label="Lore">
            <span className="dial-topbar__letter" aria-hidden="true">Lore</span>
          </span>

          {/* Moon phase — top right; tracks the scrubbed date in past mode. */}
          <span className="dial-topbar__moon-tr" aria-hidden="true">
            <MoonPhaseGlyph
              size={26}
              date={pastScan.currentRun && !pastScan.isAtLiveEdge
                ? new Date(`${pastScan.currentRun.day}T12:00:00`)
                : new Date()}
            />
          </span>

          {/* Global search hidden — SearchOverlay machinery kept for later. */}
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

  // ── Also-on-air section (former tab, now folded into ON AIR × YOUR ARTISTS).
  // Band order follows the triangle: ▲ renders DJ band then rest band below the
  // crossing rows; ▼ renders rest band (rarest-first) then DJ band above them.
  const djBandJsx = djBand.length > 0 && (
    <>
      <ZoneLabel label="DJs on air" accent="picker" />
      {djBand.map((row) => (
        <FrontDoorRow
          key={row.ds.station.slug}
          ds={row.ds}
          show={row.show}
          ov={pickerOv(row.show?.pickerId ?? null, row.effectiveDjName)}
          scrubSlug={row.ds.station.slug}
          isActive={row.ds.station.slug === radio.station?.slug}
          isSampling={false}
          onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
          displayMode={crossingSourceMode}
          presence={presenceMap.get(row.ds.station.id)}
          artworkUrl={activeArtworkUrl}
          popLine={popHasContent(row.ds.station.slug)
            ? <PopCrossingLine artists={popMap.get(row.ds.station.slug)!} seedsLower={seedsLower} onAdd={addSeed} />
            : null}
        />
      ))}
    </>
  );
  const restBandJsx = restBand.length > 0 && (
    <>
      <div id="zone3-rows">
        {restBand.slice(0, zone3Expanded ? restBand.length : ZONE3_VISIBLE).map((row) => (
          <FrontDoorRow
            key={row.ds.station.slug}
            ds={row.ds}
            show={row.show}
            ov={row.ds.lifetimeCrossings}
            scrubSlug={row.ds.station.slug}
            isActive={row.ds.station.slug === radio.station?.slug}
            isSampling={false}
            onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
            displayMode={crossingSourceMode}
            presence={presenceMap.get(row.ds.station.id)}
            artworkUrl={activeArtworkUrl}
            popLine={popHasContent(row.ds.station.slug)
              ? <PopCrossingLine artists={popMap.get(row.ds.station.slug)!} seedsLower={seedsLower} onAdd={addSeed} />
              : null}
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
  );
  const alsoSection = alsoOnAir.length > 0 && (
    <>
      <div className="fdzone-lbl-row">
        {zone3Expanded && restBand.length > ZONE3_VISIBLE && (
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
      {popSortDesc ? <>{djBandJsx}{restBandJsx}</> : <>{restBandJsx}{djBandJsx}</>}
    </>
  );

  return (
    <div className={`dial-root${albumArtOpen && avatarUrl ? " dial-root--art-open" : ""}${level === "all" ? " dial-root--front" : ""}`}>
      {/* Search overlay */}
      {searchOpen && (
        <SearchOverlay
          dialStations={stations}
          onClose={() => setSearchOpen(false)}
          onStationDrill={(slug) => { goStation(slug); setSearchOpen(false); }}
          onShowDrill={(show, station) => { goShow(show, station); setSearchOpen(false); }}
        />
      )}

      {/* Topbar + avatar album hero — the art IS the front-door content:
          full-width square in portrait, full-height left panel in landscape
          (see .dial-hero__art CSS). No section heading — the sort is already
          opinionated, and time-travel/scrub covers what Recent did. Tapping
          the art (or the moon) opens the fullscreen overlay. */}
      {level === "all" ? (
        <div className="dial-hero">
          {renderTopbar()}
          <div className="dial-hero__artwrap" {...heroSwipeHandlers}>
            <div
              className="dial-hero__art"
              style={{ backgroundImage: `url(${heroArt})` }}
              role="button"
              tabIndex={0}
              aria-label="Open album art fullscreen"
              onClick={(e) => {
                if (swipedRef.current) { swipedRef.current = false; return; }
                artOpenerRef.current = e.currentTarget; setAlbumArtOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  artOpenerRef.current = e.currentTarget;
                  setAlbumArtOpen(true);
                }
              }}
            />
            <SlimSectionNav overlay />
            {/* Time chevrons — click (or swipe the art) to step runs back/forward. */}
            <button
              type="button"
              className="dial-hero__chev dial-hero__chev--prev"
              aria-label="Back in time — previous run"
              onClick={(e) => { e.stopPropagation(); pastScan.prevRun(); }}
            >‹</button>
            <button
              type="button"
              className="dial-hero__chev dial-hero__chev--next"
              aria-label="Forward in time — next run"
              disabled={pastScan.isAtLiveEdge}
              aria-disabled={pastScan.isAtLiveEdge}
              onClick={(e) => { e.stopPropagation(); pastScan.nextRun(); }}
            >›</button>
            {/* Where-in-time label — only when stepped back from the live edge. */}
            {pastScan.currentRun && !pastScan.isAtLiveEdge && (
              <span className="dial-hero__timelabel">
                {pastScan.currentRun.station.name} · {runDate(pastScan.currentRun.day)}
              </span>
            )}
            {/* Reserved set panel — expanded "this set" artists, bottom quarter. */}
            {setPanel && (
              <div className="dial-hero__setpanel" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                <div className="dial-hero__setpanel-head">
                  <span className="dial-hero__setpanel-title">{setPanel.name} · this set</span>
                  <button
                    type="button"
                    className="dial-hero__setpanel-close"
                    aria-label="Close set panel"
                    onClick={() => setSetPanel(null)}
                  >✕</button>
                </div>
                <AlsoSentence artists={setPanel.artists} seedsLower={seedsLower} onAdd={addSeed} />
              </div>
            )}
          </div>
          {/* Sort toggle moved into the time-travel (filter) strip.
              ＋ Artists button hidden — addArtistsOpen machinery kept. */}
          {zone1Settled && addArtistsOpen && (
            <div className="dial-tabs-add-row">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                autoFocus
                type="text"
                className="topbar-paste-box dial-tabs-add-row__input"
                value={addArtistsText}
                placeholder="type or paste artist names or a screenshot…"
                aria-label="Add artists by typing or pasting names"
                onChange={(e) => setAddArtistsText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && addArtistsText.trim()) submitAddArtists(addArtistsText);
                  if (e.key === "Escape") { setAddArtistsOpen(false); setAddArtistsText(""); }
                }}
                onPaste={(e) => {
                  const t = e.clipboardData.getData("text");
                  if (t) { e.preventDefault(); submitAddArtists(t); }
                }}
              />
            </div>
          )}
        </div>
      ) : (
        renderTopbar()
      )}

      {/* Fullscreen album-art overlay — toggled by the moon glyph.
          The rest of the page fades to opacity 0 (see .dial-root--art-open);
          the same image already loaded behind the LORE logo is shown scaled
          to the window width. The moon stays visible as the toggle. */}
      {albumArtOpen && avatarUrl && (
        <div
          className="dial-art-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Album art"
          onClick={() => setAlbumArtOpen(false)}
        >
          <button
            ref={artCloseBtnRef}
            type="button"
            className="dial-art-fullscreen__close"
            aria-label="Close album art"
            onClick={() => setAlbumArtOpen(false)}
          >✕</button>
          <img src={heroArt} alt="" onError={onArtError} />
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
        {/* Time travel lives on the hero art sidebar (chevrons + swipe);
            the moon lives in the topbar. */}
        {/* DIAL view — three-zone front door (spec §6) */}
        {level === "all" && (
          <>
            {/* While crossing scores are in-flight, render only the Zone 1 heading
                and its context-sensitive placeholder.  Zones 2/3 and "Recently
                aired" are intentionally suppressed until Zone 1 has settled so
                they never appear above the live crossing rows. */}
            {!isCoreLoading && showSkeleton && (
              <>
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

            {/* Tab strip now renders inside .dial-hero above the scroll body so
                the album-art hero can bleed behind it. */}

            {/* ── Primary tab: "On the Air × Your Music Library" ─────────────────
                Contains Zone 1 crossing rows + Zone 2 ghost stations as a
                subsection below. */}
            {zone1Settled && (
              <>
                {/* PopScrubber only in live mode (day/top have no live sort). */}
                {effectiveTtMode === "live" && scrubItems.length > 6 && (
                  <PopScrubber items={scrubItems} onScrub={handleScrub} />
                )}

                {/* ── Past mode: landed crossing run + fine crossing moments ── */}
                
                {effectiveTtMode === "past" && (
                  <>
                    {currentRun ? (
                      <>
                        {/* Coarse detent: the run row (click → archive page) */}
                        <RunRow key={currentRun.runId} run={currentRun} />
                        {/* Fine detents: crossing moments within the run.
                            Swipe left/right to step ±1 crossing.
                            Click a row to jump directly to that crossing.
                            data-crossing-index allows tests to locate rows.
                            Note: the endpoint guarantees non-null mbid (only
                            library-hit spins are returned), so no disabled
                            guard is needed here. */}
                        {fineCrossings.length > 0 && (
                          <div
                            className="dial-past-crossings"
                            {...swipeHandlers}
                          >
                            {fineCrossings.map((m, i) => (
                              <button
                                key={m.spinId}
                                type="button"
                                className={`dial-past-crossing${pastScan.fineIdx === i ? " dial-past-crossing--active" : ""}`}
                                data-crossing-index={i}
                                onClick={() => {
                                  // jumpToFine sets fineIdx so the active highlight
                                  // moves to this row and subsequent swipes continue
                                  // from this position (not from the head of the run).
                                  pastScan.jumpToFine(i, fineCrossings.length);
                                }}
                              >
                                <span className="dial-past-crossing__title">{m.trackTitle ?? "Unknown track"}</span>
                                <span className="dial-past-crossing__artist">{m.artistName ?? "Unknown artist"}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Density spine — coarse run navigation.
                            Drag to scan runs; tap a bin to jump to that run.
                            Suppressed in Top Sets mode (caller controls render). */}
                        <DensitySpine
                          runs={recentRuns}
                          activeIdx={pastScan.coarseIdx}
                          onRunSelect={pastScan.jumpToRunByIndex}
                        />
                      </>
                    ) : (
                      <div className="z1-placeholder z1-placeholder--no-cross">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">No sets found.</p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Top sets mode: all-time crossing runs ranked by owned ── */}
                {ttMode === "top" && (
                  <>
                    {ttTopLoading && (
                      <>
                        <DialRowSkeleton delay={0} />
                        <DialRowSkeleton delay={1} />
                        <DialRowSkeleton delay={2} />
                      </>
                    )}
                    {!ttTopLoading && ttTopRuns.length === 0 && (
                      <div className="z1-placeholder z1-placeholder--no-cross">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">No sets found.</p>
                        </div>
                      </div>
                    )}
                    {ttTopRuns.map((run) => (
                      <RunRow key={run.runId} run={run} />
                    ))}
                  </>
                )}

                {/* ── Live mode: Zone 1 crossing rows ─────────────────────── */}
                {effectiveTtMode === "live" && (
                  <>
                    {/* Flipped sort (▼): the also-on-air bands (deep cuts) lead. */}
                    {!popSortDesc && alsoSection}
                    {/* Zone 1: crossing rows */}
                    {withReason.length > 0 && (
                      <>
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
                              {zone1Display.map((row, i) =>
                                !zone1Expanded && i >= zone1Visible ? null : (
                                  <div key={row.ds.station.slug}>
                                    <FrontDoorRow
                                      ds={row.ds}
                                      show={row.show}
                                      ov={row.show?.djName != null ? pickerOv(row.show?.pickerId ?? null, row.show.djName) : row.ds.lifetimeCrossings}
                                      scrubSlug={row.ds.station.slug}
                                      isActive={row.ds.station.slug === radio.station?.slug}
                                      isSampling={scan.samplingIdx != null && withReason[scan.samplingIdx]?.ds.station.slug === row.ds.station.slug}
                                      onTuneIn={() => { scan.stop(); void radio.toggle(row.ds.station); }}
                                      displayMode={crossingSourceMode}
                                      presence={presenceMap.get(row.ds.station.id)}
                                      setArtists={popMap.get(row.ds.station.slug) ?? null}
                                      seedsLower={seedsLower}
                                      onAddArtist={addSeed}
                                      onSetExpand={(artists) => toggleSetPanel(row.ds.station.slug, row.ds.station.name, artists)}
                                    />
                                  </div>
                                )
                              )}
                            </div>
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
                      </>
                    )}

                    {/* Library/seeds exist but nothing has crossed today — helpful nudge.
                        Suppressed while liveLoading is true: crossings depend on the
                        live-station list, so until that poll completes sortedRows is
                        empty and withReason is vacuously 0 even if crossings exist. */}
                    {withReason.length === 0 && (hasLibrary || hasSeeds || visibleSeeds.length > 0) && !liveLoading && (
                      <div className="z1-placeholder z1-placeholder--no-cross">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">
                            None of your artists have played on a live station today. Tune into a station or check back later.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* No crossing rows, no library or seeds — full onboarding placeholder.
                        The prominent CTA lives inside Zone1Placeholder for this state. */}
                    {withReason.length === 0 &&
                      !hasLibrary &&
                      !hasSeeds &&
                      visibleSeeds.length === 0 &&
                      !isSpotifyConnected && (
                      <>
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
                        Rendered after Zone 1 content as "Missed while you were away".
                        Shown in live mode and day mode, hidden in top sets mode. */}
                    {ghost.length > 0 && (
                      <>
                        <div className="fdzone-lbl-row">
                          {zone2Expanded && ghost.length > ZONE2_VISIBLE && (
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

                    {/* Default sort (▲): also-on-air bands trail the crossing rows. */}
                    {popSortDesc && alsoSection}
                  </>
                )}

                {/* ── Past mode: Zone 2 ghost rows (Zone 3 suppressed) ────── */}
                {effectiveTtMode === "past" && ghost.length > 0 && (
                  <>
                    <div className="fdzone-lbl-row">
                      {zone2Expanded && ghost.length > ZONE2_VISIBLE && (
                        <button
                          className="dial-show-more-inline"
                          aria-expanded={true}
                          aria-controls="zone2-rows-day"
                          onClick={() => setZone2Expanded(false)}
                        >
                          See less
                        </button>
                      )}
                    </div>
                    <>
                      <div id="zone2-rows-day">
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
                          aria-controls="zone2-rows-day"
                          onClick={() => { if (!zone2Expanded) zone2ExpandAnchor.current = zone2SlugKey; else zone2ExpandAnchor.current = null; setZone2Expanded((e) => !e); }}
                        >
                          {zone2Expanded ? "See less" : `See all ${ghost.length}`}
                        </button>
                      )}
                    </>
                  </>
                )}
                {/* Zone 3 (also-on-air) is suppressed in day and top modes */}
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
            const isAtLimit = seeds.length >= MAX_TASTE_SEEDS && !isSelected;
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
          {seeds.length >= MAX_TASTE_SEEDS && (
            <div className="live-artist-picker__limit" role="status">
              Seed limit reached — remove one below to choose another.
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
  const [, navigate] = useLocation();
  const cls = ["ghost-row", isActive ? "ghost-row--playing" : ""].filter(Boolean).join(" ");

  const hasReplay = station.runId != null;

  function handleClick() {
    if (hasReplay) {
      navigate(`/replay/${station.runId}`);
    } else {
      onTuneIn();
    }
  }

  const displayName = station.showName ?? station.name;
  const timeLabel = station.playedAt ? agoLabel(station.playedAt) : null;

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
    >
      <div className="ghost-row__c">
        <div className="ghost-row__reason">
          {hasReplay ? (
            <>
              <span className="ghost-row__show">{displayName}</span>
              {" played "}
              <b className="fdrow__artist">{station.artistName}</b>
              {timeLabel && <> · <span className="ghost-row__time">{timeLabel}</span></>}
            </>
          ) : (
            <b className="fdrow__artist">{station.artistName}</b>
          )}
        </div>
      </div>
      <div className="fdrow__station-label" aria-hidden="true">{station.name}</div>
    </div>
  );
}

/**
 * Touch-swipe handler that fires onSwipeLeft / onSwipeRight.
 *
 * Guards:
 *   - Left-edge exclusion (20 px default): touches starting within that zone
 *     are ignored — iOS Safari uses it for back-navigation.
 *   - Axis guard: swipe fires only when |dx| > |dy|, so vertical scrolling
 *     in any parent container is never hijacked.
 *   - Min distance (40 px default): micro-movements are ignored.
 *
 * Attach via `<div {...swipeHandlers}>` on the now-playing card wrapper.
 */
export function useSwipeHandler(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  {
    leftEdgeExcludePx = 20,
    minDistPx = 40,
  }: { leftEdgeExcludePx?: number; minDistPx?: number } = {},
) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (touch.clientX < leftEdgeExcludePx) return; // iOS Safari back-nav zone
      startX.current = touch.clientX;
      startY.current = touch.clientY;
    },
    [leftEdgeExcludePx],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (startX.current === null || startY.current === null) return;
      const touch = e.changedTouches[0];
      if (!touch) {
        startX.current = null;
        startY.current = null;
        return;
      }
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;
      startX.current = null;
      startY.current = null;
      // Axis guard: ignore if primarily vertical or too short.
      if (Math.abs(dx) < minDistPx || Math.abs(dy) >= Math.abs(dx)) return;
      if (dx < 0) onSwipeLeft();
      else onSwipeRight();
    },
    [minDistPx, onSwipeLeft, onSwipeRight],
  );

  return { onTouchStart, onTouchEnd };
}

/**
 * Two-level scan state for the dial's past-mode navigation.
 *
 * Coarse level: crossing runs (reverse-chronological, from useMyOverlapRunsRecent).
 *   Index 0 = most recent run, index N-1 = oldest.
 * Fine level:   crossing moments within the landed run.
 *
 * Window constants (from measured density):
 *   COARSE_WINDOW_SIZE = 60 runs — at 135 crossings/24h → ~39 runs/day for a
 *   heavy user; 60 provides ~1.5 days of comfortable coarse-detent coverage.
 *   N (fine) is bounded by the run size; typically 2–10 moments per run.
 *
 * Navigation contract:
 *   prevRun()               → older run (idx++); at live edge → idx 0
 *   nextRun()               → newer run (idx--); resists at live edge (null)
 *   jumpToRunByIndex(idx)   → absolute coarse position (spine drag)
 *   jumpToRunByHour(hourMs) → nearest run by day (spine bin tap)
 *   prevCrossing(n)         → earlier crossing (swipe right)
 *   nextCrossing(n)         → later crossing (swipe left); resists at last stop
 *   reset()                 → return to live edge, clear fine state
 *
 * State machine does NOT fork: every coarse navigation call resets fineIdx.
 */
export function usePastScanState(coarseCands: OverlapRun[]) {
  const [coarseIdx, setCoarseIdx] = useState<number | null>(null);
  const [fineIdx, setFineIdx] = useState<number | null>(null);
  const coarseCount = coarseCands.length;

  // The candidate list can shrink under us (e.g. the dial range is narrowed
  // while stepped back). Clamp the coarse position so currentRun never reads
  // past the end of the array. Plain effect reads — no nested setters, which
  // are unsafe under Strict/Concurrent semantics.
  useEffect(() => {
    if (coarseIdx !== null && coarseIdx >= coarseCount) {
      setCoarseIdx(coarseCount > 0 ? coarseCount - 1 : null);
      setFineIdx(null);
    }
  }, [coarseCount, coarseIdx]);

  // Internal setter: updates coarse and resets fine whenever the index changes.
  const setCoarseWithFineReset = useCallback(
    (fn: (prev: number | null) => number | null) => {
      setCoarseIdx((prev) => {
        const next = fn(prev);
        if (next !== prev) setFineIdx(null);
        return next;
      });
    },
    [],
  );

  /** Step to the next older run (coarseIdx++). At live edge, enters most-recent run. */
  const prevRun = useCallback(() => {
    setCoarseWithFineReset((i) =>
      i === null ? (coarseCount > 0 ? 0 : null) : Math.min(i + 1, coarseCount - 1),
    );
  }, [coarseCount, setCoarseWithFineReset]);

  /** Step to the next newer run (coarseIdx--). Resists at live edge (stays null). */
  const nextRun = useCallback(() => {
    setCoarseWithFineReset((i) => (i === null || i === 0 ? null : i - 1));
  }, [setCoarseWithFineReset]);

  /** Jump to an absolute coarse index — used by density-spine drag. */
  const jumpToRunByIndex = useCallback(
    (idx: number) => {
      if (idx >= 0 && idx < coarseCount) {
        setCoarseWithFineReset(() => idx);
      }
    },
    [coarseCount, setCoarseWithFineReset],
  );

  /**
   * Jump to the run nearest to `hourMs` (epoch ms) by day — used by density-
   * spine tap. Delegates nearest-run lookup to findRunIndexByHour.
   */
  const jumpToRunByHour = useCallback(
    (hourMs: number) => {
      if (coarseCands.length === 0) return;
      setCoarseWithFineReset(() => findRunIndexByHour(hourMs, coarseCands));
    },
    [coarseCands, setCoarseWithFineReset],
  );

  /** Step to the earlier crossing within the run (swipe right). */
  const prevCrossing = useCallback((fineCount: number) => {
    if (fineCount === 0) return;
    setFineIdx((i) => (i === null ? fineCount - 1 : Math.max(i - 1, 0)));
  }, []);

  /**
   * Step to the later crossing within the run (swipe left).
   * Resists at the last fine stop — never silently advances past the run.
   */
  const nextCrossing = useCallback((fineCount: number) => {
    if (fineCount === 0) return;
    setFineIdx((i) => {
      const cur = i ?? -1;
      return cur >= fineCount - 1 ? Math.max(cur, 0) : cur + 1;
    });
  }, []);

  /** Return to live edge and clear fine state. */
  const reset = useCallback(() => {
    setCoarseIdx(null);
    setFineIdx(null);
  }, []);

  /**
   * Jump directly to a fine crossing by index — used by crossing row clicks
   * so the active class and subsequent swipes continue from the clicked position.
   */
  const jumpToFine = useCallback((idx: number, fineCount: number) => {
    if (idx >= 0 && idx < fineCount) {
      setFineIdx(idx);
    }
  }, []);

  const currentRun = coarseIdx !== null ? (coarseCands[coarseIdx] ?? null) : null;

  return {
    coarseIdx,
    fineIdx,
    currentRun,
    isAtLiveEdge: coarseIdx === null,
    prevRun,
    nextRun,
    jumpToRunByIndex,
    jumpToRunByHour,
    jumpToFine,
    prevCrossing,
    nextCrossing,
    reset,
  };
}
