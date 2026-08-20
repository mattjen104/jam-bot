/**
 * SplitHome — the Lore front door as a fixed five-slot split view.
 *
 *   top edge  — RadioRemoteBar: the radio remote (/crossings /radio /lore
 *               plus the age-tier and station-category chips), pinned above
 *               the Dial band where the controls are most reachable.
 *   top ~50%  — CompactDial: concise category cards with honest now-playing
 *               metadata. Opening one reveals its individual station rows
 *               inline without losing the existing station controls.
 *   middle    — HomeCliStrip: the CLI seam. Only the Dial page selectors,
 *               Scan / Scan all, the slash-command input, and the /add
 *               affordance live here now — a true seam between the bands.
 *   bottom ~50% — CompactStack: kept album groups as cassette-spine rows,
 *               windowed five at a time by the stack pager (stackOffset).
 *   bottom edge — StackPagerBar: numeric stack page buttons plus Shuffle /
 *               Shuffle all, pinned above the player dock.
 *
 * The view never scrolls — it fills the viewport between the app header and
 * the bottom shell. The full scrollable Dial lives at /feed; the full Stack
 * at /library.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { eligibleDjNames } from "@workspace/lore-attribution";
import {
  useDialData,
  type DialStationCategory,
} from "../hooks/useDialData";
import { useStationPresence } from "../hooks/useStationPresence";
import { useSeedManager } from "../hooks/useSeedManager";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import {
  DEFAULT_ACTIVE_AGE_TIERS,
  DEFAULT_ACTIVE_STATION_CATEGORIES,
  toggleAgeTier,
  toggleStationCategory,
  useDialSkipped,
  useStackSkipped,
} from "../lib/dialFilterState";
import { readRadioMode, writeRadioMode } from "../lib/dialRadioMode";
import {
  hasAnyCrossing,
  nextCrossingScope,
  readCrossingScope,
  writeCrossingScope,
  type CrossingScope,
} from "../lib/crossingScope";
import { writeDialLens } from "../lib/dialLensState";
import {
  dialPageSize,
  nextDialDensity,
  readDialDensity,
  writeDialDensity,
  type DialDensity,
} from "../lib/dialDensityState";
import {
  nextStackDensity,
  readStackDensity,
  stackPageSize,
  writeStackDensity,
  type StackDensity,
} from "../lib/stackDensityState";
import { spineArtUrl } from "../components/CompactStack";
import { proxyArtUrl } from "../lib/proxyArt";
import { rowPassesAgeTierFilter, type AgeTier } from "../lib/dialAgeFilter";
import type { StationCategory } from "../components/dial/DialFilterBar";
import { STATION_CATEGORY_DEFINITIONS } from "../lib/dialCategories";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { CompactDial } from "../components/CompactDial";
import { LastSetScanner } from "../components/LastSetScanner";
import { HistoryScanner } from "../components/dial/HistoryScanner";
import { fetchLatestSetSummaries, type LastSetSummary } from "../lib/latestSet";
import {
  liveScanIdentity,
  recordLiveScan,
  useScanMemory,
} from "../lib/scanMemory";
import { CompactStack } from "../components/CompactStack";
import { HomeCliStrip, type ScanMode } from "../components/HomeCliStrip";
import { RadioRemoteBar } from "../components/RadioRemoteBar";
import { StationFinderSheet } from "../components/StationFinderSheet";
import { StackPagerBar } from "../components/StackPagerBar";
import { useCompactStackShuffle } from "../hooks/useCompactStackShuffle";
import { useMyLibraryInfinite, useStartMattLibrary } from "../lib/meHooks";
import { buildAlbumGroups } from "./Library";
import type { MattCliStatus } from "../components/dial/DialCliBar";

export default function SplitHome() {
  const [, setLocation] = useLocation();

  // CLI filter state — same semantics as the full Dial (additive tiers,
  // additive categories). Start with the normal radio browse scope visible;
  // unchecking every category still reverts to the all-stations state.
  const [activeTiers, setActiveTiers] = useState<Set<AgeTier>>(
    () => new Set(DEFAULT_ACTIVE_AGE_TIERS),
  );
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set(DEFAULT_ACTIVE_STATION_CATEGORIES),
  );
  const toggleTier = useCallback((tier: AgeTier) => {
    setActiveTiers((prev) => toggleAgeTier(prev, tier));
  }, []);
  const toggleCategory = useCallback((cat: StationCategory) => {
    setActiveCategories((prev) => toggleStationCategory(prev, cat));
  }, []);

  // Feed mode (persisted): true = /radio (default — crossings off),
  // false = /crossings (explicit opt-in). Drives the remote's toggles.
  const [radioMode, setRadioMode] = useState<boolean>(() => readRadioMode());

  // Crossing scope (persisted): what a ⬤ dot on a row means and which window
  // the crossing-positive filter uses. Only meaningful when crossings are on
  // (crossings on = !radioMode, same as the remote's toggle semantics).
  const [crossingScope, setCrossingScope] = useState<CrossingScope>(() => readCrossingScope());
  const crossingsOn = !radioMode;
  const cycleCrossingScope = useCallback(() => {
    setCrossingScope((prev) => {
      const next = nextCrossingScope(prev);
      writeCrossingScope(next);
      return next;
    });
  }, []);

  // Dial-band display density (persisted, localStorage "lore:dialDensity"):
  // normal = 5 full rows, compact = 10 name-only remote rows, micro = 15
  // numbered keypad buttons.
  const [density, setDensity] = useState<DialDensity>(() => readDialDensity());

  // Station Finder sheet (Radio Browser search → pin personal stations).
  const [finderOpen, setFinderOpen] = useState(false);
  const openFinder = useCallback(() => setFinderOpen(true), []);
  const closeFinder = useCallback(() => setFinderOpen(false), []);

  // Per-station scan-skip preference (localStorage "lore:dialSkipped").
  // Skipped stations sort to the last scan pages and are excluded from
  // Scan / Scan all.
  const { skipped, toggleSkip } = useDialSkipped();

  const { stations, crossingsLoading } = useDialData("personal", {
    categories: activeCategories as ReadonlySet<DialStationCategory>,
    // The main view lists EVERY station (live or not) alphabetically; the
    // hook's default dial visibility filter (live / flagship / named show)
    // would silently drop off-air stations without schedule metadata.
    includeAllStations: true,
  });

  const { addSeed } = useSeedManager();
  const { radio } = usePlayer();

  // Scan window: which slice of the sorted feed is shown. Any multiple of
  // the density page size is valid — the page count is dynamic (filtered
  // rows / page size).
  const [scanOffset, setScanOffset] = useState<number>(0);

  // Compact scan remote state: null = not scanning, "page" = auto-advancing
  // through the selected page window, "all" = auto-advancing through
  // the full filtered list.
  const [scanMode, setScanMode] = useState<ScanMode>(null);
  const [scanRowIdx, setScanRowIdx] = useState<number | null>(null);

  // Timer/RAF refs for the compact scan — same pattern as useFrontDoorScan.
  const scanRt = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    active: boolean;
    mode: "page" | "all" | null;
  }>({
    timer: null,
    active: false,
    mode: null,
  });
  const SCAN_DWELL_MS = 7000;

  const stopCompactScan = useCallback(() => {
    scanRt.current.active = false;
    scanRt.current.mode = null;
    if (scanRt.current.timer != null) {
      clearTimeout(scanRt.current.timer);
      scanRt.current.timer = null;
    }
    setScanMode(null);
    setScanRowIdx(null);
  }, []);

  // Density cycle key on the scan remote. Switching density changes the page
  // size, so any running scan stops — its cursor was computed for the old
  // window. The offset re-clamps/snaps via the render-time clamp below.
  const cycleDensity = useCallback(() => {
    if (scanRt.current.active) stopCompactScan();
    setDensity((prev) => {
      const next = nextDialDensity(prev);
      writeDialDensity(next);
      return next;
    });
  }, [stopCompactScan]);

  // filteredRows ref to avoid stale closures inside the timer callback.
  const filteredRowsRef = useRef<typeof filteredRows>([]);
  const scanOffsetRef = useRef(0);
  const skippedRef = useRef<ReadonlySet<string>>(new Set());
  const scanPageSizeRef = useRef(5);

  // All-stations deterministic sort — every station (live or not) in one
  // alphabetical order by station name, identical for every listener. The
  // explicit "en" locale + numeric collation keep the order stable regardless
  // of the visitor's browser locale ("KEXP 2" sorts after "KEXP 1", not
  // after "KEXP 10"). The only personal influence is the skip preference:
  // skipped stations sort after included ones so they land on the last scan
  // pages — within each group the alphabetical order still applies.
  const sortedRows = useMemo(() => {
    return [...stations]
      .map((ds) => {
        const show = ds.shows.find((sh) => sh.state === "live") ?? null;
        const djNameList = eligibleDjNames(
          { name: show?.showName ?? "", djName: show?.djName ?? undefined, djNames: show?.djNames },
          { artist: show?.currentTrack?.artist, title: show?.currentTrack?.title, showTitle: show?.showName, stationName: ds.station.name },
        );
        const effectiveDjName = djNameList.length === 1 ? djNameList[0] : null;
        const attributionSafeShow = show && effectiveDjName !== show.djName
          ? { ...show, djName: effectiveDjName }
          : show;
        return { ds, show: attributionSafeShow, effectiveDjName };
      })
      .sort((a, b) => {
        const aSkip = skipped.has(a.ds.station.slug) ? 1 : 0;
        const bSkip = skipped.has(b.ds.station.slug) ? 1 : 0;
        if (aSkip !== bSkip) return aSkip - bSkip;
        return (
          a.ds.station.name.localeCompare(b.ds.station.name, "en", {
            numeric: true,
            sensitivity: "base",
          }) ||
          a.ds.station.slug.localeCompare(b.ds.station.slug, "en")
        );
      });
  }, [stations, skipped]);

  // Age-tier CLI filter (/first /current /catalog /deep) — same semantics as
  // DialFeedLane: a row's age identity is its station's current track (live
  // pulse first, then the live show's last spin); rows with no current track
  // always pass — the filter is about what's PLAYING, not hiding quiet
  // stations. Applied BEFORE the scan windowing so each window is full of
  // matching rows.
  const filteredRows = useMemo(() => {
    let rows = sortedRows;
    if (activeTiers.size > 0) {
      rows = rows.filter((row) => {
        const track = row.ds.liveTrack ?? row.show?.currentTrack ?? null;
        if (!track) return true;
        return rowPassesAgeTierFilter(track.ageTier, activeTiers);
      });
    }
    // Crossing-positive filter: with crossings on, only stations with ≥1
    // crossing at the active scope remain — "show me only stations that have
    // played my music in the chosen window". Off (radio mode) = no filter.
    // Suspended while crossing scores are still loading: filtering on
    // unsettled (zero) counters would blank the feed until the compute
    // settles — same guard as DialView's scopeFilter.
    if (crossingsOn && !crossingsLoading) {
      rows = rows.filter((row) => hasAnyCrossing(row.ds, crossingScope));
    }
    return rows;
  }, [sortedRows, activeTiers, crossingsOn, crossingsLoading, crossingScope]);

  // Split into active (not skipped) and skipped after age-tier filtering.
  // Scan pagination and page count are based on activeRows only; skipped rows
  // are always rendered below the fold in a scrollable overflow region.
  const activeRows = useMemo(
    () => filteredRows.filter((r) => !skipped.has(r.ds.station.slug)),
    [filteredRows, skipped],
  );
  const skippedRows = useMemo(
    () => filteredRows.filter((r) => skipped.has(r.ds.station.slug)),
    [filteredRows, skipped],
  );
  // Category-first is only meaningful when at least one editorial category is
  // represented. A purely personal/unclassified list retains the established
  // normal/compact/micro pager rather than inventing a single "Other" card.
  const hasEditorialCategory = useMemo(
    () => activeRows.some((row) =>
      STATION_CATEGORY_DEFINITIONS.some(
        (definition) => definition.cat === row.ds.station.stationCategories?.[0],
      )),
    [activeRows],
  );

  // Rows per scan page at the current density: 5 (normal), 10 (compact), or
  // 15 (micro). Drives the window slice, the page count,
  // and the scan candidate window alike.
  const pageSize = dialPageSize(density);

  // Keep refs current so timer callbacks always see the latest values.
  // Synced in an effect (not during render) per the react-hooks/refs rule;
  // timers only fire after render + effects, so the mirror is never stale
  // when a hop callback reads it.
  useEffect(() => {
    filteredRowsRef.current = activeRows;
    scanOffsetRef.current = scanOffset;
    skippedRef.current = skipped;
    scanPageSizeRef.current = pageSize;
  });

  // Clamp a requested page to the current page count at click/command time,
  // so an out-of-range /scanN (e.g. /scan10 on a 6-row list) lands on the
  // last valid page instead of an empty window. The requested offset snaps
  // down to a page boundary at the active density's page size. Also stops
  // any running scan since the scope is now incompatible (user navigated to
  // a different page).
  const handleSelectPage = useCallback((offset: number) => {
    if (offset < 0) return;
    const size = scanPageSizeRef.current;
    const snapped = Math.floor(offset / size) * size;
    const maxOffset = Math.max(0, Math.floor((filteredRowsRef.current.length - 1) / size) * size);
    const clamped = Math.min(snapped, maxOffset);
    setScanOffset(clamped);
    // Stop an active scan when the user explicitly picks a different page —
    // the in-progress scan was for the previous window.
    if (scanRt.current.active) stopCompactScan();
  }, [stopCompactScan]);

  // CLI /scanN command: page selection with the same cancellation semantics
  // as clicking a page button — any active scan (page or all) stops, because
  // the user explicitly navigated and the scan cursor is now incompatible.
  const handleCliScan = handleSelectPage;

  // Clamp the scan window when the active list shrinks (skip toggle, filter
  // change, stations dropping off) or the density changes the page size, so
  // a stale offset never shows an empty or misaligned window. Render-time
  // adjustment (React's supported pattern for deriving state from a changing
  // input; the lint rules forbid setState-in-effect). The last valid page
  // offset is floor((rows - 1) / pageSize) * pageSize.
  const clampKey = `${activeRows.length}:${pageSize}`;
  const [prevClampKey, setPrevClampKey] = useState(clampKey);
  if (prevClampKey !== clampKey) {
    setPrevClampKey(clampKey);
    if (activeRows.length === 0) {
      if (scanOffset !== 0) setScanOffset(0);
    } else {
      const snapped = Math.floor(scanOffset / pageSize) * pageSize;
      const maxOffset = Math.floor((activeRows.length - 1) / pageSize) * pageSize;
      const clamped = Math.min(snapped, maxOffset);
      if (clamped !== scanOffset) setScanOffset(clamped);
    }
  }

  const pageCount = Math.max(1, Math.ceil(activeRows.length / pageSize));

  // --- Compact scan hop logic ---
  // The scan auto-advances through a list of rows at SCAN_DWELL_MS per hop,
  // previewing each station's live stream via radio.preview(). The list is
  // either the current page's rows ("page" mode) or all filtered rows
  // ("all" mode). scanRowIdx is a raw index into filteredRows (not page-local).
  const radioRef = useRef(radio);
  // eslint-disable-next-line react-hooks/refs
  radioRef.current = radio;

  // Build the scan candidate list.
  // filteredRowsRef now tracks activeRows (skipped stations are excluded at
  // the split point, so skippedRef is only used for stop-on-change detection).
  // "page" mode scans the current page window into activeRows; "all"
  // mode scans the whole active list. No further skip filtering needed here —
  // activeRows already has skipped rows removed.
  const scanCandidates = useCallback((mode: "page" | "all"): number[] => {
    const rows = filteredRowsRef.current; // = activeRows via the effect
    const offset = scanOffsetRef.current;
    const size = scanPageSizeRef.current;
    const start = mode === "page" ? offset : 0;
    const end = mode === "page" ? Math.min(offset + size, rows.length) : rows.length;
    const out: number[] = [];
    for (let i = start; i < end; i++) {
      if (rows[i]) out.push(i);
    }
    return out;
  }, []);

  const scheduleNextHop = useCallback((currentCandIdx: number, mode: "page" | "all") => {
    // Inner named function so the recursive self-reference stays local (the
    // useCallback const can't reference itself under the compiler rules).
    function hop(fromCandIdx: number) {
      scanRt.current.timer = setTimeout(() => {
        if (!scanRt.current.active) return;
        const rows = filteredRowsRef.current; // = activeRows
        const candidates = scanCandidates(mode);
        if (candidates.length === 0) { stopCompactScan(); return; }
        const wrappedCandIdx = (fromCandIdx + 1) % candidates.length;
        const globalIdx = candidates[wrappedCandIdx];
        const row = rows[globalIdx];
        if (row && resolvePlaybackSource(row.ds.station) != null) {
          void radioRef.current.preview(row.ds.station);
          // Scan memory: remember the song this hop sampled so a station
          // still on it shows the "unchanged since your last scan" cue.
          recordLiveScan(
            row.ds.station.slug,
            liveScanIdentity(row.ds.liveTrack ?? row.show?.currentTrack),
          );
        }
        // An all-scan drives the visible window along with it, so the sampled
        // station is always rendered and highlighted (CompactDial only shows
        // the current active page — 5 rows in normal, 10 in compact, 15 in
        // micro).
        if (mode === "all") {
          const size = scanPageSizeRef.current;
          setScanOffset(Math.floor(globalIdx / size) * size);
        }
        setScanRowIdx(globalIdx);
        hop(wrappedCandIdx);
      }, SCAN_DWELL_MS);
    }
    hop(currentCandIdx);
  }, [stopCompactScan, scanCandidates]);

  const startCompactScan = useCallback((mode: "page" | "all") => {
    // An all-scan begins at the top of the active list, so snap the visible
    // window to page 1 before computing candidates.
    if (mode === "all") {
      setScanOffset(0);
      scanOffsetRef.current = 0;
    }
    const candidates = scanCandidates(mode);
    if (candidates.length === 0) return;
    scanRt.current.active = true;
    scanRt.current.mode = mode;
    setScanMode(mode);
    const rows = filteredRowsRef.current; // = activeRows
    const globalIdx = candidates[0];
    if (mode === "all") {
      const size = scanPageSizeRef.current;
      setScanOffset(Math.floor(globalIdx / size) * size);
    }
    const row = rows[globalIdx];
    if (row && resolvePlaybackSource(row.ds.station) != null) {
      void radioRef.current.preview(row.ds.station);
      recordLiveScan(
        row.ds.station.slug,
        liveScanIdentity(row.ds.liveTrack ?? row.show?.currentTrack),
      );
    }
    setScanRowIdx(globalIdx);
    scheduleNextHop(0, mode);
  }, [scheduleNextHop, scanCandidates]);

  // Scan buttons: clicking the active mode's button stops the scan; clicking
  // the other mode's button switches to that mode (stop, then start) so the
  // labels always do what they say.
  const handleScanPage = useCallback(() => {
    const wasMode = scanRt.current.mode;
    if (scanRt.current.active) stopCompactScan();
    // Toggle off if a page scan was running; otherwise start (or switch to)
    // a page scan.
    if (wasMode === "page") return;
    startCompactScan("page");
  }, [stopCompactScan, startCompactScan]);

  const handleScanAll = useCallback(() => {
    const wasMode = scanRt.current.mode;
    if (scanRt.current.active) stopCompactScan();
    if (wasMode === "all") return;
    startCompactScan("all");
  }, [stopCompactScan, startCompactScan]);

  // Stop scan when filters or the skipped set change — the row list is
  // incompatible with the in-progress scan cursor.
  const prevTiersRef = useRef(activeTiers);
  const prevCatsRef = useRef(activeCategories);
  const prevSkippedRef = useRef(skipped);
  useEffect(() => {
    const tiersChanged = prevTiersRef.current !== activeTiers;
    const catsChanged = prevCatsRef.current !== activeCategories;
    const skippedChanged = prevSkippedRef.current !== skipped;
    prevTiersRef.current = activeTiers;
    prevCatsRef.current = activeCategories;
    prevSkippedRef.current = skipped;
    if ((tiersChanged || catsChanged || skippedChanged) && scanRt.current.active) {
      stopCompactScan();
    }
  }, [activeTiers, activeCategories, skipped, stopCompactScan]);

  // Clean up timers on unmount.
  useEffect(() => () => {
    if (scanRt.current.timer != null) clearTimeout(scanRt.current.timer);
  }, []);

  const liveStationIds = useMemo(
    () => [...activeRows, ...skippedRows]
      .map((row) => row.ds.station.id)
      // Personal (listener-pinned) stations carry negative synthetic ids and
      // have no server-side presence — leave them out of the presence query.
      .filter((id) => id > 0),
    [activeRows, skippedRows],
  );
  const presenceMap = useStationPresence(liveStationIds);

  // Editorial category cards deliberately remain all visible; the direct
  // ungrouped/personal fallback still respects the selected Feed page. This
  // keeps /scanN useful without making category discovery depend on pagination.
  const visibleUncategorizedSlugs = useMemo(
    () => new Set(
      activeRows
        .slice(scanOffset, scanOffset + pageSize)
        .map((row) => row.ds.station.slug),
    ),
    [activeRows, scanOffset, pageSize],
  );

  // ── Scan memory: live freshness cue + last-set scanner state ──────────
  const scanMemory = useScanMemory();

  // Stations still playing whatever the last scan sampled — drives the
  // "unchanged since your last scan" cue on rows and remote keys.
  const unchangedSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const row of activeRows) {
      const identity = liveScanIdentity(row.ds.liveTrack ?? row.show?.currentTrack);
      if (identity && scanMemory.live[row.ds.station.slug]?.id === identity) {
        set.add(row.ds.station.slug);
      }
    }
    return set;
  }, [activeRows, scanMemory]);

  // Latest-completed-set summaries for every reachable category station.
  // Category cards stay lightweight, while their expanded rows retain the
  // full Last set label and track count.
  const visibleSlugs = useMemo(
    () =>
      activeRows
        .map((r) => r.ds.station.slug),
    [activeRows],
  );
  const [lastSetSummaries, setLastSetSummaries] = useState<
    ReadonlyMap<string, LastSetSummary | null>
  >(new Map());
  useEffect(() => {
    if (density !== "normal" || visibleSlugs.length === 0) return;
    let cancelled = false;
    void fetchLatestSetSummaries(visibleSlugs).then((items) => {
      if (cancelled) return;
      setLastSetSummaries((prev) => {
        const next = new Map(prev);
        for (const [slug, summary] of Object.entries(items)) next.set(slug, summary);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [density, visibleSlugs]);

  // Last-set scanner sheet: the slug of the station being scanned, or null.
  const [lastSetSlug, setLastSetSlug] = useState<string | null>(null);
  const openLastSet = useCallback(
    (row: DialLaneRow) => {
      stopCompactScan();
      setLastSetSlug(row.ds.station.slug);
    },
    [stopCompactScan],
  );
  const lastSetRow = useMemo(
    () =>
      lastSetSlug
        ? ([...activeRows, ...skippedRows].find(
            (r) => r.ds.station.slug === lastSetSlug,
          ) ?? null)
        : null,
    [lastSetSlug, activeRows, skippedRows],
  );

  const tuneRow = useCallback((row: DialLaneRow) => {
    if (resolvePlaybackSource(row.ds.station) == null) return;
    stopCompactScan();
    if (radio.station?.slug !== row.ds.station.slug || radio.status !== "playing") {
      void radio.toggle(row.ds.station);
    }
  }, [radio, stopCompactScan]);
  const playRow = useCallback((row: DialLaneRow) => {
    if (resolvePlaybackSource(row.ds.station) == null) return;
    stopCompactScan();
    void radio.toggle(row.ds.station);
  }, [radio, stopCompactScan]);

  const handleAddArtists = useCallback((names: string[]) => {
    for (const name of names) addSeed(name);
  }, [addSeed]);
  const handleRadioMode = useCallback((on: boolean) => {
    setRadioMode(on);
    writeRadioMode(on);
    // /radio must force the Radio lens so a returning visitor on Press/Shows
    // lands on the Radio feed, matching DialView's own setRadioMode behavior.
    if (on) writeDialLens("radio");
    setLocation("/feed");
  }, [setLocation]);
  // --- Stack paging + shuffle ---
  // The Stack band windows the full library album-group list five rows at a
  // time (stackOffset, multiples of 5), paged by the StackPagerBar pinned at
  // the bottom edge. The page count grows with the library.
  const { data: stackData } = useMyLibraryInfinite({}, 100);
  const stackGroups = useMemo(
    () => buildAlbumGroups(stackData?.pages[0]?.items ?? []),
    [stackData],
  );

  // artist (lowercase) → artwork from the cached library page — the set
  // scanner paints this art behind crossing rows (Library header treatment).
  const libraryArtwork = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of stackData?.pages[0]?.items ?? []) {
      const artist = item.recording?.artist?.trim().toLowerCase();
      const art = item.recording?.artworkUrl;
      if (artist && art && !map.has(artist)) map.set(artist, art);
    }
    return map;
  }, [stackData]);

  // Per-album Stack-skip preference (localStorage "lore:stackSkipped").
  // Unchecked albums leave the five-slot active window for the below-fold
  // overflow region; the pager and the shuffle only see active albums —
  // the Stack-side mirror of the dial's skipped stations.
  const { skipped: stackSkipped, toggleSkip: toggleStackSkip } = useStackSkipped();
  const activeStackGroups = useMemo(
    () => stackGroups.filter((g) => !stackSkipped.has(g.key)),
    [stackGroups, stackSkipped],
  );

  // Stack-band display density (persisted, localStorage "lore:stackDensity"):
  // normal = 5 full rows, compact = 10 half-height rows, micro = 15
  // one-third-height rows. Mirrors the dial band's density cycle.
  const [stackDensity, setStackDensity] = useState<StackDensity>(() => readStackDensity());
  const stackRowsPerPage = stackPageSize(stackDensity);
  const [stackOffset, setStackOffset] = useState<number>(0);

  const {
    shuffleMode,
    shuffleGroupKey,
    onShufflePage,
    onShuffleAll,
    stopShuffle,
  } = useCompactStackShuffle({
    groups: activeStackGroups,
    stackOffset,
    pageSize: stackRowsPerPage,
    onSetStackOffset: setStackOffset,
  });

  // Density cycle key on the stack pager. Switching density changes the page
  // size, so any running shuffle stops — its cursor was computed for the old
  // window. The offset re-clamps/snaps via the render-time clamp below.
  const cycleStackDensity = useCallback(() => {
    stopShuffle();
    setStackDensity((prev) => {
      const next = nextStackDensity(prev);
      writeStackDensity(next);
      return next;
    });
  }, [stopShuffle]);

  // Clamp the stack window when the active list shrinks (deselects/imports/
  // skip toggles) or the density changes the page size, so a stale offset
  // never shows an empty or misaligned page. Render-time adjustment, same
  // derived-state pattern as the scan window clamp above.
  const stackClampKey = `${activeStackGroups.length}:${stackRowsPerPage}`;
  const [prevStackClampKey, setPrevStackClampKey] = useState(stackClampKey);
  if (prevStackClampKey !== stackClampKey) {
    setPrevStackClampKey(stackClampKey);
    if (activeStackGroups.length === 0) {
      if (stackOffset !== 0) setStackOffset(0);
    } else {
      const snapped = Math.floor(stackOffset / stackRowsPerPage) * stackRowsPerPage;
      const maxOffset = Math.floor((activeStackGroups.length - 1) / stackRowsPerPage) * stackRowsPerPage;
      const clamped = Math.min(snapped, maxOffset);
      if (clamped !== stackOffset) setStackOffset(clamped);
    }
  }

  const stackPageCount = Math.max(1, Math.ceil(activeStackGroups.length / stackRowsPerPage));

  // Cover art of the first album on the current Stack page — the pager
  // bar's decorative backdrop. Derived from the already-loaded groups (own
  // artwork or CAA release-group fallback), so no extra fetch is needed.
  const stackFirstArtUrl = useMemo(() => {
    const first = activeStackGroups[stackOffset];
    return first ? proxyArtUrl(spineArtUrl(first)) : null;
  }, [activeStackGroups, stackOffset]);

  // Pager labels: each stack page introduces itself by the first album in
  // its window ("Rumours", "Blue Lines"…) instead of a bare page number.
  // Windows follow the density's page size and are over ACTIVE groups only —
  // the same list the pager pages and the CompactStack band windows.
  const stackPageLabels = useMemo(
    () =>
      Array.from({ length: stackPageCount }, (_, i) =>
        activeStackGroups[i * stackRowsPerPage]?.albumTitle ?? null,
      ),
    [activeStackGroups, stackPageCount, stackRowsPerPage],
  );

  // Stack page selection clamps to the last valid page (same contract as the
  // dial's handleSelectPage) and stops any running shuffle — the listener
  // explicitly navigated, so the shuffle cursor is now incompatible.
  const handleSelectStackPage = useCallback((offset: number) => {
    if (offset < 0 || offset % stackRowsPerPage !== 0) return;
    const maxOffset = Math.max(0, Math.floor((activeStackGroups.length - 1) / stackRowsPerPage) * stackRowsPerPage);
    setStackOffset(Math.min(offset, maxOffset));
    stopShuffle();
  }, [activeStackGroups.length, stackRowsPerPage, stopShuffle]);

  const mattStarterMutation = useStartMattLibrary();
  const startMattLibrary = useCallback(() => {
    if (mattStarterMutation.isPending) return;
    mattStarterMutation.mutate();
  }, [mattStarterMutation]);
  const mattCliStatus: MattCliStatus | null = mattStarterMutation.isPending
    ? { kind: "pending", message: "Adding Matt's starter library…" }
    : mattStarterMutation.error
      ? {
          kind: "error",
          message: mattStarterMutation.error instanceof Error
            ? mattStarterMutation.error.message
            : "We couldn't add Matt's starter library. Try again.",
        }
      : mattStarterMutation.data
        ? mattStarterMutation.data.available
          ? {
              kind: "success",
              message: mattStarterMutation.data.addedCount > 0
                ? `Added ${mattStarterMutation.data.addedCount} album${mattStarterMutation.data.addedCount === 1 ? "" : "s"} from Matt's starter library.`
                : "Matt's starter library is already in your Stack.",
            }
          : {
              kind: "error",
              message: mattStarterMutation.data.error
                ?? "Matt's starter library is not available right now.",
            }
        : null;

  // All bands and both remotes stay mounted at all times — a Stack album
  // expands in place inside its own band, never by unmounting the dial or
  // the remotes.
  return (
    <div className="split-home">
      <RadioRemoteBar
        activeTiers={activeTiers}
        activeCategories={activeCategories}
        onToggleTier={toggleTier}
        onToggleCategory={toggleCategory}
        onRadioMode={handleRadioMode}
        radioMode={radioMode}
        onFindStations={openFinder}
      />

      {finderOpen && <StationFinderSheet onClose={closeFinder} />}

      {lastSetSlug && (
        <LastSetScanner
          slug={lastSetSlug}
          density={density}
          libraryArtwork={libraryArtwork}
          lifetimeCrossings={
            (lastSetRow?.ds.lifetimeCrossings ?? 0) +
            (lastSetRow?.ds.lifetimeArtistCrossings ?? 0)
          }
          onClose={() => setLastSetSlug(null)}
        />
      )}

      <section className="split-home__band split-home__band--dial" aria-label="Live stations">
        <HistoryScanner
          scope={crossingScope}
          categories={[...activeCategories]}
        />
        <CompactDial
          activeRows={hasEditorialCategory
            ? activeRows
            : activeRows.slice(scanOffset, scanOffset + pageSize)}
          skippedRows={skippedRows}
          samplingRowIdx={hasEditorialCategory
            ? scanRowIdx
            : scanRowIdx != null ? scanRowIdx - scanOffset : null}
          activeSlug={radio.station?.slug ?? null}
          playerStatus={radio.status}
          presenceMap={presenceMap}
          onTuneIn={tuneRow}
          onPlay={playRow}
          onToggleSkip={toggleSkip}
          crossingScope={crossingScope}
          suppressCrossings={!crossingsOn}
          displayMode="personal"
          onAddArtist={addSeed}
          density={density}
          firstOrdinal={hasEditorialCategory ? 1 : scanOffset + 1}
          onOpenLastSet={openLastSet}
          lastSetSummaries={lastSetSummaries}
          unchangedSlugs={unchangedSlugs}
          categoryFirst={hasEditorialCategory}
          visibleUncategorizedSlugs={visibleUncategorizedSlugs}
        />
      </section>

      <HomeCliStrip
        activeTiers={activeTiers}
        activeCategories={activeCategories}
        onToggleTier={toggleTier}
        onToggleCategory={toggleCategory}
        scanOffset={scanOffset}
        pageCount={pageCount}
        totalRows={activeRows.length}
        scanMode={scanMode}
        onSelectPage={handleSelectPage}
        onScanPage={handleScanPage}
        onScanAll={handleScanAll}
        onScan={handleCliScan}
        onAddArtists={handleAddArtists}
        onRadioMode={handleRadioMode}
        onMatt={startMattLibrary}
        mattPending={mattStarterMutation.isPending}
        mattStatus={mattCliStatus}
        crossingScope={crossingScope}
        crossingsOn={crossingsOn}
        onCycleCrossingScope={cycleCrossingScope}
        totalActiveCount={activeRows.length}
        density={density}
        onCycleDensity={cycleDensity}
      />

      <section className="split-home__band split-home__band--stack" aria-label="Recent keeps">
        <CompactStack
          offset={stackOffset}
          density={stackDensity}
          shuffleKey={shuffleGroupKey}
          skipped={stackSkipped}
          onToggleSkip={toggleStackSkip}
        />
      </section>

      <StackPagerBar
        stackOffset={stackOffset}
        stackPageCount={stackPageCount}
        totalGroups={activeStackGroups.length}
        stackDensity={stackDensity}
        onCycleStackDensity={cycleStackDensity}
        firstPageArtUrl={stackFirstArtUrl}
        pageLabels={stackPageLabels}
        shuffleMode={shuffleMode}
        onSelectStackPage={handleSelectStackPage}
        onShufflePage={onShufflePage}
        onShuffleAll={onShuffleAll}
      />
    </div>
  );
}
