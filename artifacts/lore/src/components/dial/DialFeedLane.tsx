/**
 * DialFeedLane — the Dial's unified live-station feed.
 *
 * Replaces the former Zone 1 / Zone 3 split: every live station renders in
 * ONE flat list. Ranking (not zoning) expresses taste relevance:
 *
 *   reasonRows — stations with a crossing reason (rungs 1–4, 6, 7). Lead the
 *                feed in ▲ order; sink to the bottom in ▼ order.
 *   djRows     — attributed shows on air with no crossing yet (rung 5).
 *   restRows   — unattributed / dark stations (rung 0); pinned float first
 *                (sorted upstream in DialView).
 *
 * With no taste data every live station simply lands in djRows/restRows and
 * the feed still shows all of them with their current plays — there is no
 * empty state as long as anything is on air.
 *
 * Long feeds grow via infinite scroll (IntersectionObserver sentinel) instead
 * of a See-all / See-less toggle. Environments without IntersectionObserver
 * (old browsers, jsdom) render the full list.
 *
 * Pure presentational: all sorting, popular-crossing data, and seeds stay in
 * DialView and arrive via typed props.
 */
import { useRef, useEffect, useState, useMemo, type ReactNode } from "react";
import { type PopularCrossingArtist } from "../../lib/meHooks";
import { type DialStation, type DialShow, type DialDisplayMode } from "../../hooks/useDialData";
import { type StationPresence } from "../../hooks/useStationPresence";
import { rowPassesAgeTierFilter, type AgeTier } from "../../lib/dialAgeFilter";
import { FrontDoorRow } from "./FrontDoorRow";
import { CompactPlayButton } from "../CompactPlayButton";
import { resolvePlaybackSource, type PlayerStatus } from "../../hooks/useRadioPlayer";
import { type CrossingScope, DEFAULT_CROSSING_SCOPE, hasAnyCrossing } from "../../lib/crossingScope";

/** The shape shared by all sorted dial rows (reason / dj / rest bands). */
export interface DialLaneRow {
  ds: DialStation;
  show: DialShow | null;
  effectiveDjName: string | null;
}

/** Ranking band a feed row belongs to (internal ordering only — no visual zones). */
export type DialFeedBand = "reason" | "dj" | "rest";

/** Initial page size — rows shown before the first infinite-scroll reveal. */
export const FEED_INITIAL = 12;

export interface DialFeedLaneProps {
  /** Crossing-reason rows already in display order (▲ ladder order / ▼ inverted). */
  reasonRows: DialLaneRow[];
  /** r=5 band — attributed DJs on air, sorted by DialView. */
  djRows: DialLaneRow[];
  /** r=0 band — unattributed rows, sorted by DialView (pinned first). */
  restRows: DialLaneRow[];
  /** Sort direction: ▲ (true) reason rows lead; ▼ (false) rest band leads. */
  popSortDesc: boolean;
  /** Slug of the currently playing station, if any. */
  activeSlug: string | null;
  /** Slug of the station currently being sampled by the front-door scan. */
  samplingSlug: string | null;
  /** Scrubber target — the feed reveals & scrolls this slug into view. */
  scrubTarget: string | null;
  displayMode: DialDisplayMode;
  presenceMap: Map<number, StationPresence>;
  /** Popular-crossing setlists keyed by station slug (reason rows). */
  popMap: Map<string, PopularCrossingArtist[]>;
  seedsLower: Set<string>;
  /** Artwork for the now-playing row indicator (dj/rest rows). */
  artworkUrl: string | null;
  /** Popular-crossing sentence for a station slug, or null when none (dj/rest rows). */
  popLineFor: (slug: string) => ReactNode | null;
  /** Per-row overlap figure, band-aware (picker overlap or lifetime crossings). */
  ovFor: (row: DialLaneRow, band: DialFeedBand) => number;
  onAddArtist: (name: string) => void;
  onTuneIn: (row: DialLaneRow) => void;
  onSetExpand: (row: DialLaneRow) => void;
  /**
   * Active song-age tiers (First | Current | Catalog | Deep). Rows whose
   * current track's ageTier misses every active tier are hidden BEFORE
   * pagination. Empty/omitted set = no age filtering. Rows with unknown age
   * (null tier) always pass.
   */
  activeAgeTiers?: ReadonlySet<AgeTier>;
  /**
   * The /radio blank-radio mode: every row (reason band included) renders
   * through the non-reason branch, so the live now-playing sentence fills
   * tier 1 and no crossing sentence or popular-crossing setlist appears.
   * Row membership and order are unchanged — the same flat feed.
   */
  suppressCrossings?: boolean;
  /** Active crossing scope — determines what the per-row ⬤ dot means. */
  crossingScope?: CrossingScope;
  /** Direct play — renders a CompactPlayButton on each playable row. */
  onPlay?: (row: DialLaneRow) => void;
  /** Player status for the active station (play-button spinner/pause state). */
  playerStatus?: PlayerStatus;
}

interface FeedEntry {
  row: DialLaneRow;
  band: DialFeedBand;
}

export function DialFeedLane({
  reasonRows,
  djRows,
  restRows,
  popSortDesc,
  activeSlug,
  samplingSlug,
  scrubTarget,
  displayMode,
  presenceMap,
  popMap,
  seedsLower,
  artworkUrl,
  popLineFor,
  ovFor,
  onAddArtist,
  onTuneIn,
  onSetExpand,
  activeAgeTiers,
  suppressCrossings = false,
  crossingScope = DEFAULT_CROSSING_SCOPE,
  onPlay,
  playerStatus,
}: DialFeedLaneProps) {
  // Flat display order mirrors the scrubber: ▲ reason → dj → rest;
  // ▼ rest → dj → reason (reason rows arrive pre-inverted from DialView).
  // The age-tier filter applies BEFORE pagination so the initial page is full
  // of matching rows (not a filtered-down fragment of the first 12).
  const entries = useMemo<FeedEntry[]>(() => {
    const reason = reasonRows.map((row): FeedEntry => ({ row, band: "reason" }));
    const dj = djRows.map((row): FeedEntry => ({ row, band: "dj" }));
    const rest = restRows.map((row): FeedEntry => ({ row, band: "rest" }));
    const ordered = popSortDesc ? [...reason, ...dj, ...rest] : [...rest, ...dj, ...reason];
    if (!activeAgeTiers || activeAgeTiers.size === 0) return ordered;
    return ordered.filter(({ row }) => {
      // The row's age identity is its station's current track (live pulse
      // first, falling back to the live show's last spin). Stations with no
      // current track (dark/attribution-only rows) pass through — the age
      // filter is about what's PLAYING, not about hiding quiet stations.
      const track = row.ds.liveTrack ?? row.show?.currentTrack ?? null;
      if (!track) return true;
      return rowPassesAgeTierFilter(track.ageTier, activeAgeTiers);
    });
  }, [reasonRows, djRows, restRows, popSortDesc, activeAgeTiers]);

  const [visible, setVisible] = useState(FEED_INITIAL);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset pagination when feed membership genuinely changes (order-insensitive
  // key so a live re-sort of the same stations does NOT collapse the feed).
  // Render-phase state adjustment — paints the reset list in a single pass.
  const slugKey = useMemo(
    () => entries.map((e) => e.row.ds.station.slug).sort().join(","),
    [entries],
  );
  const [prevSlugKey, setPrevSlugKey] = useState(slugKey);
  if (prevSlugKey !== slugKey) {
    setPrevSlugKey(slugKey);
    setVisible(FEED_INITIAL);
  }

  // Scrub target: reveal the row (expand pagination past it) during render so
  // the follow-up effect below only has to scroll it into view.
  const scrubIdx = scrubTarget
    ? entries.findIndex((e) => e.row.ds.station.slug === scrubTarget)
    : -1;
  if (scrubIdx >= 0 && scrubIdx >= visible) {
    setVisible(Math.min(scrubIdx + FEED_INITIAL, entries.length));
  }

  // Progressive enhancement: without IntersectionObserver (jsdom, very old
  // browsers) the feed renders in full — no toggle, no dead end.
  const hasObserver = typeof IntersectionObserver !== "undefined";

  // Infinite scroll: expand by a page whenever the sentinel enters viewport.
  useEffect(() => {
    if (!hasObserver) return;
    const el = sentinelRef.current;
    if (!el || visible >= entries.length) return;
    const observer = new IntersectionObserver(
      (obsEntries) => {
        if (obsEntries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + FEED_INITIAL, entries.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, visible, entries.length]);

  // Scrub target: the render-phase adjustment above already revealed the row;
  // here we only scroll it into view once it exists in the DOM.
  useEffect(() => {
    if (!scrubTarget) return;
    const el = document.querySelector(`[data-scrub-slug="${CSS.escape(scrubTarget)}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [scrubTarget, visible]);

  if (entries.length === 0) return null;

  const shown = hasObserver ? entries.slice(0, visible) : entries;

  return (
    <div id="dial-feed-rows">
      {shown.map(({ row, band }) => {
        // Blank-radio mode: reason rows render through the non-reason branch
        // so the live now-playing sentence leads instead of the crossing
        // sentence (and the popular-crossing setlist stays hidden).
        const asReason = band === "reason" && !suppressCrossings;
        const slug = row.ds.station.slug;
        const hasCrossing = !suppressCrossings && hasAnyCrossing(row.ds, crossingScope);
        // Direct play — same click isolation as CompactDial (the button owns
        // its own click handling; row tap still tunes/expands).
        const playButton = onPlay && resolvePlaybackSource(row.ds.station) != null ? (
          <CompactPlayButton
            title={row.ds.station.name}
            isPlaying={slug === activeSlug && playerStatus === "playing"}
            isLoading={slug === activeSlug && playerStatus === "loading"}
            onClick={() => onPlay(row)}
            testId={`dial-feed-play-${slug}`}
          />
        ) : null;
        return (
        <div
          key={slug}
          data-feed-band={band}
          className={playButton ? "dial-feed-row" : undefined}
        >
          {playButton}
          {asReason ? (
            <FrontDoorRow
              ds={row.ds}
              show={row.show}
              ov={ovFor(row, band)}
              scrubSlug={row.ds.station.slug}
              isActive={row.ds.station.slug === activeSlug}
              isSampling={samplingSlug != null && samplingSlug === row.ds.station.slug}
              onTuneIn={() => onTuneIn(row)}
              displayMode={displayMode}
              presence={presenceMap.get(row.ds.station.id)}
              setArtists={popMap.get(row.ds.station.slug) ?? null}
              seedsLower={seedsLower}
              onAddArtist={onAddArtist}
              onSetExpand={() => onSetExpand(row)}
              compactSentence
              crossingScope={crossingScope}
              hasCrossing={hasCrossing}
            />
          ) : (
            <FrontDoorRow
              ds={row.ds}
              show={row.show}
              ov={ovFor(row, band)}
              scrubSlug={row.ds.station.slug}
              isActive={row.ds.station.slug === activeSlug}
              isSampling={false}
              onTuneIn={() => onTuneIn(row)}
              displayMode={displayMode}
              presence={presenceMap.get(row.ds.station.id)}
              artworkUrl={artworkUrl}
              popLine={suppressCrossings ? null : popLineFor(row.ds.station.slug)}
              compactSentence
              suppressCrossings={suppressCrossings}
              crossingScope={crossingScope}
              hasCrossing={hasCrossing}
            />
          )}
        </div>
        );
      })}
      {/* Sentinel — triggers the next page load when scrolled into view. */}
      {hasObserver && visible < entries.length && (
        <div ref={sentinelRef} className="dial-feed-sentinel" aria-hidden="true" />
      )}
    </div>
  );
}
