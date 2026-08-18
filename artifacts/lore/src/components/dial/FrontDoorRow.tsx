/**
 * FrontDoorRow and its direct rendering dependencies, extracted from
 * DialView.tsx. This module owns the presentational pieces shared by the
 * Dial's zone lanes:
 *
 *   FrontDoorRow    — a single live-station row (reason sentence, presence…)
 *   PopCrossingLine — the Also-On-Air inline setlist sentence
 *   SetQueueList    — the one renderer for broadcast/replay set queues
 *   agoLabel        — relative-time formatter shared by ghost/offline rows
 *
 * DialView re-exports FrontDoorRow / PopCrossingLine / SetQueueList so
 * existing imports and tests keep working.
 */
import React, { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { type PopularCrossingArtist } from "../../lib/meHooks";
import {
  cleanLiveValue,
  sameLiveValue,
  crossingSentence,
  liveProvenanceSummary,
  reason,
} from "../dialViewHelpers";
import { proxyArtUrl } from "../../lib/proxyArt";
import { resolvePlaybackSource } from "../../hooks/useRadioPlayer";
import { safeHttpUrl } from "../../lib/utils";
import {
  type DialStation,
  type DialShow,
  type DialDisplayMode,
} from "../../hooks/useDialData";
import {
  type CrossingScope,
  DEFAULT_CROSSING_SCOPE,
  crossingScopeDetail,
} from "../../lib/crossingScope";
import { type StationPresence } from "../../hooks/useStationPresence";
import { ListenerAvatarStack } from "../ListenerAvatarStack";

export function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * The front door is a tune-in affordance, so live context is deliberately one
 * sentence rather than a stack of independently clickable identities.  Prefer
 * the current DJ and exact now-playing values; never use a recently-ended DJ
 * as if they were currently on air.
 */
export function liveSentence(
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
export function PopCrossingLine({ artists, seedsLower, onAdd }: {
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

  // Link semantics: dotted underline is RESERVED for navigation. Add/seed is
  // an explicit small `+` affordance next to the name — the name itself never
  // adds. Yours (library/seeded) stays bright white with no underline.
  const span = (a: PopularCrossingArtist) =>
      inLib(a) ? (
      <b key={a.name} className="fdrow__artist fdrow__artist--lib dial-artist--complete">{a.name}</b>
    ) : (
      <span key={a.name} className="fdrow__artist-wrap">
        <span className="fdrow__artist fdrow__artist--other">{a.name}</span>
        <button
          type="button"
          className="fdrow__addplus dial-addplus"
          aria-label={`Add ${a.name} to your artists`}
          onClick={(e) => { e.stopPropagation(); onAdd(a.name); }}
        >+</button>
      </span>
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
          aria-expanded={expanded}
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

export interface QueueArtist {
  name: string;
  inLibrary: boolean;
  /** Track title for the phone-width one-line "artist — title" rendering.
   * Optional — crossing-derived artist lists have no per-spin title. */
  title?: string | null;
}

/**
 * The player queue intentionally has one renderer for broadcast and replay
 * sets. A click is a real toggle for taste seeds; hard library matches remain
 * visibly completed but are not removed from the listener's external library.
 */
export function SetQueueList({ artists, seedsLower, onAdd, onRemove, onOpenArtist, progress }: {
  artists: QueueArtist[];
  seedsLower: Set<string>;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  /** When provided, artist names become navigation targets that open the
   * artist tab (yours or not). Add/seed stays on the explicit `+`. */
  onOpenArtist?: (name: string) => void;
  progress: number;
}) {
  const completed = Math.max(0, Math.min(100, progress * 100));
  return (
    <div className="set-queue" aria-label="Set queue">
      <div className="set-queue__progress" style={{ width: `${completed}%` }} aria-hidden="true" />
      <div className="set-queue__artists">
        {artists.map((artist, index) => {
          // Link semantics: the name itself never adds — add/seed is the
          // explicit `+` affordance; seeded names carry an explicit remove
          // (×). Yours (library/seeded) renders white with no underline.
          const key = artist.name.trim().toLowerCase();
          const seeded = seedsLower.has(key);
          const inLibrary = artist.inLibrary || seeded;
          const nameCls = `set-queue__artist ${inLibrary ? "set-queue__artist--library dial-artist--complete" : "set-queue__artist--other"}`;
          const nameAria = inLibrary ? `${artist.name} is in your library` : undefined;
          return (
            <span key={`${key}-${index}`} className="set-queue__artist-wrap">
              {/* Leading `+` — the add affordance precedes the name in setlists. */}
              {!inLibrary && (
                <button
                  type="button"
                  className="set-queue__addplus dial-addplus"
                  aria-label={`Add ${artist.name} to your artists`}
                  onClick={(e) => { e.stopPropagation(); onAdd(artist.name); }}
                >+</button>
              )}
              {onOpenArtist ? (
                <button
                  type="button"
                  className={`${nameCls} gram-link--nav`}
                  aria-label={nameAria}
                  onClick={(e) => { e.stopPropagation(); onOpenArtist(artist.name); }}
                >{artist.name}</button>
              ) : (
                <span className={nameCls} aria-label={nameAria}>{artist.name}</span>
              )}
              {artist.title ? <span className="set-queue__title" aria-hidden="true"> — {artist.title}</span> : null}
              {seeded && (
                <button
                  type="button"
                  className="set-queue__removeseed dial-addplus"
                  aria-label={`Remove ${artist.name} from your artists`}
                  onClick={(e) => { e.stopPropagation(); onRemove(artist.name); }}
                >×</button>
              )}
            </span>
          );
        })}
      </div>
    </div>
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
  return (
    <SetQueueList
      artists={artists.map((artist) => ({ name: artist.name, inLibrary: artist.inLibrary }))}
      seedsLower={seedsLower}
      onAdd={onAdd}
      onRemove={() => undefined}
      progress={0}
    />
  );
}

export interface FrontDoorRowProps {
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
  /** Opens the persistent player queue for this station's complete set. */
  onSetExpand?: () => void;
  /** Keep the attribution-only homepage link out of tier 1 when the parent
   * renders it in a dedicated action slot beside the row. */
  siteLinkInTier1?: boolean;
  /**
   * Renders the compact left-to-right artist · station identity as tier 1.
   * Dial lanes pass this; without it the row falls back to the full
   * crossing/reason sentence machinery.
   *
   * When compactSentence is true, the row uses expand-then-keep interaction:
   * first tap expands and reveals the byline + Keep affordance; second tap
   * (or long-press on collapsed) tunes in.
   */
  compactSentence?: boolean;
  /**
   * When true, a ✳ superscript marker appears after the artist lead to
   * indicate that artist investigation sources are available.
   */
  hasInvestigationSources?: boolean;
  /** Called when the listener keeps the current track from the expanded byline. */
  onKeep?: () => void;
  /** Called when the ✳ marker is tapped — opens the Artist Investigation sheet. */
  onOpenArtistInvestigation?: () => void;
  /**
   * The /radio blank-radio mode: crossing evidence is withheld from the
   * compact identity, so the row leads with the plain live now-playing
   * sentence (artist · station) instead of a crossing lead.
   */
  suppressCrossings?: boolean;
  /**
   * True when the station has ≥1 crossing at the active scope — renders the
   * ⬤ dot after the station name (compact rows only). Computed by the caller
   * via hasAnyCrossing(ds, scope).
   */
  hasCrossing?: boolean;
  /** The active crossing scope — labels the inline ⬤ detail panel. */
  crossingScope?: CrossingScope;
  /** Called when the ⬤ dot is tapped (in addition to toggling the detail). */
  onCrossingDetail?: () => void;
}

export function FrontDoorRow({ ds, show, ov: _ov, isActive, isSampling, onTuneIn, displayMode = "personal", presence, artworkUrl, popLine, scrubSlug, setArtists, seedsLower, onAddArtist, onSetExpand, compactSentence, siteLinkInTier1 = true, hasInvestigationSources = false, onKeep, onOpenArtistInvestigation, suppressCrossings = false, hasCrossing = false, crossingScope = DEFAULT_CROSSING_SCOPE, onCrossingDetail }: FrontDoorRowProps) {
  const usableDjList = eligibleDjNames(
    { name: show?.showName ?? "", djName: show?.djName ?? undefined, djNames: show?.djNames },
    { artist: show?.currentTrack?.artist, title: show?.currentTrack?.title, showTitle: show?.showName, stationName: ds.station.name },
  );
  const usableDj = usableDjList.length === 1 ? usableDjList[0] : null;
  const safeShow = show && usableDj !== show.djName
    ? { ...show, djName: usableDj }
    : show;
  const rz = reason(safeShow, ds.crossings, ds.artistCrossings, displayMode, ds.topArtistNames);
  const compact = liveProvenanceSummary(
    ds.station.name,
    safeShow,
    ds.liveTrack?.artist,
  );

  // Expand-then-keep: first tap expands the row to show the byline + Keep
  // affordance; second tap (or long-press on collapsed) tunes in.
  // Only active in compact mode — legacy sentence rows still tune on first tap.
  const [expanded, setExpanded] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // Byline content — visible when expanded in compact mode.
  // Attribution: DJ name if available, else show name (with same filtering as
  // liveSentence so placeholder/echo values don't surface).
  const bylineAttribution: string | null = usableDj ?? (() => {
    const rawShow = cleanLiveValue(show?.showName);
    if (!rawShow || sameLiveValue(rawShow, ds.station.name)) return null;
    return rawShow;
  })();
  const bylineTrack = cleanLiveValue(show?.currentTrack?.title ?? null);
  const stationBlurb = ds.station.homepageBlurb?.trim() || null;

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
          ? onSetExpand
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
  const fallbackTier1Node = displayMode === "blended"
    ? rz.node
    : crossing?.node ?? (usePop ? popLine : null) ?? live?.node ?? rz.node;
  // The station set workspace is retired (Task #37): the compact provenance
  // prefix is inert text now — the whole row tunes, and the pinned sentence
  // The lane row carries the set inline. Always use the bright-foreground
  // class so the weight rung (w0/w5…) cannot dim the summary sentence.
  // Left-to-right sentence identity: the now-playing artist leads (never a
  // crossing artist name), then a low-weight centred dot, then the station as
  // secondary context. Crossing evidence is the ⬤ dot after the station name,
  // not words in the sentence.
  const hasArtistLead = compact?.artist != null;

  // Inline ⬤ detail: tapping the dot reveals a small disclosure below the
  // identity line (scope label, top crossing artists, total count); tapping
  // again — or tuning in — collapses it.
  const [inlineDetail, setInlineDetail] = useState(false);
  const showDot = compactSentence && hasCrossing && !suppressCrossings;
  const detail = showDot && inlineDetail ? crossingScopeDetail(ds, crossingScope) : null;

  // True while the live track arrived via the provisional spin-raw fast path
  // (MusicBrainz resolution still in flight). Drives fdrow--resolving on the
  // row and fdrow__compact-artist--resolving on the compact artist span.
  const isResolving = ds.liveTrack?.resolving === true;

  const tier1Node = compactSentence && compact ? (
    <span
      className="fdrow__compact-identity"
      aria-label={compact.text}
    >
      <span className="fdrow__compact-lead">
        {/* The now-playing artist always leads. The artist cell stays in the
            DOM (empty, aria-hidden) when there is no usable artist — never
            invented, never replaced by a crossing artist name. */}
        <span
          className={`fdrow__compact-artist${isResolving ? " fdrow__compact-artist--resolving" : ""}`}
          aria-hidden={compact.artist == null}
        >
          {compact.artist ?? ""}
        </span>
        {/* ✳ coverage marker — superscript after the artist lead when investigation
            sources are available. Tapping opens the Artist Investigation sheet.
            Never shown when there is no artist to anchor it to. */}
        {hasInvestigationSources && hasArtistLead && (
          <button
            type="button"
            className="fdrow__coverage-marker"
            title="Artist investigation sources available"
            aria-label="Open artist investigation"
            onClick={(e) => { e.stopPropagation(); onOpenArtistInvestigation?.(); }}
            onPointerDown={(e) => e.stopPropagation()}
          >✳</button>
        )}
        {hasArtistLead && (
          <span className="fdrow__compact-separator" aria-hidden="true">·</span>
        )}
        {/* Station only — DJ and show belong in the expanded byline. */}
        <span className="fdrow__compact-station">{compact.station}</span>
        {/* ⬤ crossing indicator — present iff the station has ≥1 crossing at
            the active scope. Tapping toggles the inline scope detail. */}
        {showDot && (
          <button
            type="button"
            className="fdrow__crossing-dot"
            aria-expanded={inlineDetail}
            aria-label={inlineDetail ? "Hide crossing detail" : "Show crossing detail"}
            title="Crossing at the current scope"
            onClick={(e) => {
              e.stopPropagation();
              setInlineDetail((v) => !v);
              onCrossingDetail?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >⬤</button>
        )}
      </span>
    </span>
  ) : fallbackTier1Node;
  const tier1Cls = compactSentence && compact
     ? "fdrow__live-sentence fdrow__compact-sentence"
    : displayMode === "blended"
    ? rz.cls
    : crossing ? rz.cls : usePop ? "fdrow__pop-sentence" : live ? "fdrow__live-sentence" : rz.cls;
  const rowCls = [
    "fdrow",
    rz.r === 1 ? "fdrow--t1" : "",
    rz.r >= 2 && rz.r <= 4 ? "fdrow--z1" : "",
    rz.r === 6 || rz.r === 7 ? "fdrow--hist" : "",
    rz.r === 0 || rz.r === 5 ? "fdrow--dim" : "",
    isSampling ? "fdrow--sampling" : "",
    isActive ? "fdrow--playing" : "",
    compactSentence && expanded ? "fdrow--expanded" : "",
    isResolving ? "fdrow--resolving" : "",
  ].filter(Boolean).join(" ");

  // Attribution-only stations (no direct stream, no relay) cannot be played
  // in-app: the row click must not reach radio.toggle (which would surface
  // the "no live stream configured" safety-net error). Instead the row shows
  // a "Listen on <site> ↗" affordance that opens the station's own website.
  const playable = resolvePlaybackSource(ds.station) != null;
  // Station homepage link: computed for every station (safeHttpUrl guards
  // against non-http(s) values). Attribution-only rows keep it in tier 1;
  // playable rows surface it inside the expanded byline instead.
  const siteHref = safeHttpUrl(ds.station.homepageUrl);

  // Expand-then-keep click handler:
  //   compact + collapsed → expand (reveal byline)
  //   compact + expanded  → tune in
  //   non-compact         → tune in immediately (legacy behaviour)
  const handleClick = () => {
    if (!playable) return;
    if (compactSentence) {
      if (longPressFired.current) {
        // Long-press already triggered tune-in; swallow the synthetic click.
        longPressFired.current = false;
        return;
      }
      if (expanded) {
        setExpanded(false);
        setInlineDetail(false);
        onTuneIn();
      } else {
        setExpanded(true);
      }
    } else {
      onTuneIn();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only activate on the row root itself — not on bubbled events from child
    // interactive elements (Keep button, coverage marker). On those elements
    // the browser handles Space/Enter natively; intercepting here would prevent
    // their default activation and trigger the row's expand/tune logic instead.
    if (e.target !== e.currentTarget) return;
    if (!playable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  // Long-press on a collapsed compact row: tune in directly without expanding.
  const handlePointerDown = (e: React.PointerEvent) => {
    // Child interactive elements (Keep button, coverage marker) stop propagation
    // so this handler only fires when the user presses on the row surface itself.
    if (!playable || !compactSentence || expanded) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setInlineDetail(false);
      onTuneIn();
    }, 600);
    // Prevent text selection during long-press on touch.
    e.preventDefault();
  };

  /** Cancel the long-press timer — shared by pointerup, pointerleave, pointercancel. */
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div
      className={rowCls}
      data-scrub-slug={scrubSlug}
      data-station-slug={ds.station.slug}
      role="button"
      aria-expanded={compactSentence ? expanded : undefined}
      aria-label={compactSentence ? compact?.text : compact?.plainText}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
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
          {/* Tier-1 site link is reserved for attribution-only stations —
              playable stations get the link in the expanded byline instead. */}
          {!playable && siteLinkInTier1 && siteHref && (
            <a
              className="fdrow__site-link"
              href={siteHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Listen on ${ds.station.name} site`}
              onClick={(e) => e.stopPropagation()}
            >
              ↗ Listen on site
            </a>
          )}
        </div>

        {/* Expanded byline — visible on compact rows after first tap.
            Shows: [DJ · Show]  ·  [now-playing title]     [+ Keep]
            Byline uses system-sans at small size; Keep is a soft bordered
            pill at the right edge. Click propagation stopped so the tune-in
            handler (on the row root) is not re-triggered by the Keep button. */}
        {compactSentence && compact && expanded && (
          <div className="fdrow__byline" onClick={(e) => e.stopPropagation()}>
            <span className="fdrow__byline-text">
              {bylineAttribution && (
                <span className="fdrow__byline-dj">{bylineAttribution}</span>
              )}
              {bylineAttribution && bylineTrack && (
                <span className="fdrow__byline-sep" aria-hidden="true"> · </span>
              )}
              {bylineTrack && (
                <span className="fdrow__byline-track">{bylineTrack}</span>
              )}
              {/* Station homepage link — shown for playable stations only
                  (attribution-only rows keep theirs in tier 1). Click
                  propagation stopped so the tune-in handler never fires. */}
              {playable && siteHref && (
                <a
                  className="fdrow__byline-station-link"
                  href={siteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Listen on ${ds.station.name} site`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  ↗ {ds.station.name}
                </a>
              )}
            </span>
            {onKeep && (
              <button
                type="button"
                className="fdrow__keep"
                aria-label="Keep this track"
                onClick={(e) => { e.stopPropagation(); onKeep(); }}
                onPointerDown={(e) => e.stopPropagation()}
              >+ Keep</button>
            )}
          </div>
        )}
        {compactSentence && compact && expanded && stationBlurb && (
          <p className="fdrow__station-description">{stationBlurb}</p>
        )}

        {/* Inline ⬤ crossing detail — scope label, top crossing artists at
            that scope, and the total count. Kept short: top 3 names. */}
        {detail && (
          <div className="fdrow__crossing-detail" onClick={(e) => e.stopPropagation()}>
            <span className="fdrow__crossing-detail-scope">{detail.scopeLabel}</span>
            {detail.artists.length > 0 && (
              <span className="fdrow__crossing-detail-artists">
                {detail.artists.map((name, i) => (
                  <span key={name}>
                    {i > 0 && " · "}
                    <b className="fdrow__crossing-detail-artist">{name}</b>
                  </span>
                ))}
              </span>
            )}
            <span className="fdrow__crossing-detail-count">
              {detail.count} crossing{detail.count === 1 ? "" : "s"}
            </span>
          </div>
        )}

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
