/**
 * SplitHome — the Lore front door as a fixed five-slot split view.
 *
 *   top edge  — RadioRemoteBar: the radio remote (/crossings /radio /lore
 *               plus the age-tier and station-category chips), pinned above
 *               the Dial band where the controls are most reachable.
 *   top ~50%  — CompactDial: five stations from the all-stations alphabetical
 *               sort (same order for every listener), windowed by the active
 *               scan (offset 0, 5, 10, … — the page count grows with the
 *               filtered list).
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
import { toggleAgeTier, toggleStationCategory, useDialSkipped } from "../lib/dialFilterState";
import { readRadioMode, writeRadioMode } from "../lib/dialRadioMode";
import { writeDialLens } from "../lib/dialLensState";
import { rowPassesAgeTierFilter, type AgeTier } from "../lib/dialAgeFilter";
import type { StationCategory } from "../components/dial/DialFilterBar";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { CompactDial } from "../components/CompactDial";
import { CompactStack } from "../components/CompactStack";
import { HomeCliStrip, type ScanMode } from "../components/HomeCliStrip";
import { RadioRemoteBar } from "../components/RadioRemoteBar";
import { StackPagerBar } from "../components/StackPagerBar";
import { useCompactStackShuffle } from "../hooks/useCompactStackShuffle";
import { useMyLibraryInfinite, useStartMattLibrary } from "../lib/meHooks";
import { buildAlbumGroups } from "./Library";
import type { MattCliStatus } from "../components/dial/DialCliBar";

export default function SplitHome() {
  const [, setLocation] = useLocation();

  // CLI filter state — same semantics as the full Dial (additive tiers,
  // additive categories). No category is selected initially, so the
  // front door starts unfiltered; unchecking every category reverts to the
  // all-stations state.
  const [activeTiers, setActiveTiers] = useState<Set<AgeTier>>(() => new Set());
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set<StationCategory>(),
  );
  const toggleTier = useCallback((tier: AgeTier) => {
    setActiveTiers((prev) => toggleAgeTier(prev, tier));
  }, []);
  const toggleCategory = useCallback((cat: StationCategory) => {
    setActiveCategories((prev) => toggleStationCategory(prev, cat));
  }, []);

  // Feed mode (persisted): false = /crossings (default), true = /radio.
  // Drives the pressed state of the remote's feed-mode toggles.
  const [radioMode, setRadioMode] = useState<boolean>(() => readRadioMode());

  // Per-station scan-skip preference (localStorage "lore:dialSkipped").
  // Skipped stations sort to the last scan pages and are excluded from
  // Scan / Scan all.
  const { skipped, toggleSkip } = useDialSkipped();

  const { stations } = useDialData("personal", {
    categories: activeCategories as ReadonlySet<DialStationCategory>,
    // The main view lists EVERY station (live or not) alphabetically; the
    // hook's default dial visibility filter (live / flagship / named show)
    // would silently drop off-air stations without schedule metadata.
    includeAllStations: true,
  });

  const { addSeed } = useSeedManager();
  const { radio } = usePlayer();

  // Scan window: which 5-station slice of the sorted feed is shown. Any
  // multiple of 5 is valid — the page count is dynamic (filtered rows / 5).
  const [scanOffset, setScanOffset] = useState<number>(0);

  // Compact scan remote state: null = not scanning, "page" = auto-advancing
  // through the selected five-row window, "all" = auto-advancing through
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

  // filteredRows ref to avoid stale closures inside the timer callback.
  const filteredRowsRef = useRef<typeof filteredRows>([]);
  const scanOffsetRef = useRef(0);
  const skippedRef = useRef<ReadonlySet<string>>(new Set());

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
    if (activeTiers.size === 0) return sortedRows;
    return sortedRows.filter((row) => {
      const track = row.ds.liveTrack ?? row.show?.currentTrack ?? null;
      if (!track) return true;
      return rowPassesAgeTierFilter(track.ageTier, activeTiers);
    });
  }, [sortedRows, activeTiers]);

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

  // Keep refs current so timer callbacks always see the latest values.
  // Synced in an effect (not during render) per the react-hooks/refs rule;
  // timers only fire after render + effects, so the mirror is never stale
  // when a hop callback reads it.
  useEffect(() => {
    filteredRowsRef.current = activeRows;
    scanOffsetRef.current = scanOffset;
    skippedRef.current = skipped;
  });

  // Clamp a requested page to the current page count at click/command time,
  // so an out-of-range /scanN (e.g. /scan10 on a 6-row list) lands on the
  // last valid page instead of an empty window. Also stops any running scan
  // since the scope is now incompatible (user navigated to a different page).
  const handleSelectPage = useCallback((offset: number) => {
    if (offset < 0 || offset % 5 !== 0) return;
    const maxOffset = Math.max(0, Math.floor((filteredRowsRef.current.length - 1) / 5) * 5);
    const clamped = Math.min(offset, maxOffset);
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
  // change, stations dropping off) so a stale offset never shows an empty
  // window. Render-time adjustment (React's supported pattern for deriving
  // state from a changing input; the lint rules forbid setState-in-effect).
  // The last valid page offset is floor((rows - 1) / 5) * 5.
  const [prevRowCount, setPrevRowCount] = useState(activeRows.length);
  if (prevRowCount !== activeRows.length) {
    setPrevRowCount(activeRows.length);
    if (activeRows.length === 0) {
      if (scanOffset !== 0) setScanOffset(0);
    } else if (scanOffset >= activeRows.length) {
      setScanOffset(Math.floor((activeRows.length - 1) / 5) * 5);
    }
  }

  const pageCount = Math.max(1, Math.ceil(activeRows.length / 5));

  // --- Compact scan hop logic ---
  // The scan auto-advances through a list of rows at SCAN_DWELL_MS per hop,
  // previewing each station's live stream via radio.preview(). The list is
  // either the current page's five rows ("page" mode) or all filtered rows
  // ("all" mode). scanRowIdx is a raw index into filteredRows (not page-local).
  const radioRef = useRef(radio);
  // eslint-disable-next-line react-hooks/refs
  radioRef.current = radio;

  // Build the scan candidate list.
  // filteredRowsRef now tracks activeRows (skipped stations are excluded at
  // the split point, so skippedRef is only used for stop-on-change detection).
  // "page" mode scans the current five-slot window into activeRows; "all"
  // mode scans the whole active list. No further skip filtering needed here —
  // activeRows already has skipped rows removed.
  const scanCandidates = useCallback((mode: "page" | "all"): number[] => {
    const rows = filteredRowsRef.current; // = activeRows via the effect
    const offset = scanOffsetRef.current;
    const start = mode === "page" ? offset : 0;
    const end = mode === "page" ? Math.min(offset + 5, rows.length) : rows.length;
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
        }
        // An all-scan drives the visible window along with it, so the sampled
        // station is always rendered and highlighted (CompactDial only shows
        // the current five-row active page).
        if (mode === "all") {
          setScanOffset(Math.floor(globalIdx / 5) * 5);
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
      setScanOffset(Math.floor(globalIdx / 5) * 5);
    }
    const row = rows[globalIdx];
    if (row && resolvePlaybackSource(row.ds.station) != null) {
      void radioRef.current.preview(row.ds.station);
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
    () => activeRows.slice(scanOffset, scanOffset + 5).map((row) => row.ds.station.id),
    [activeRows, scanOffset],
  );
  const presenceMap = useStationPresence(liveStationIds);

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
  const [stackOffset, setStackOffset] = useState<number>(0);

  const {
    shuffleMode,
    shuffleGroupKey,
    onShufflePage,
    onShuffleAll,
    stopShuffle,
  } = useCompactStackShuffle({
    groups: stackGroups,
    stackOffset,
    onSetStackOffset: setStackOffset,
  });

  // Clamp the stack window when the library shrinks (deselects/imports) so a
  // stale offset never shows an empty page. Render-time adjustment, same
  // derived-state pattern as the scan window clamp above.
  const [prevStackCount, setPrevStackCount] = useState(stackGroups.length);
  if (prevStackCount !== stackGroups.length) {
    setPrevStackCount(stackGroups.length);
    if (stackGroups.length === 0) {
      if (stackOffset !== 0) setStackOffset(0);
    } else if (stackOffset >= stackGroups.length) {
      setStackOffset(Math.floor((stackGroups.length - 1) / 5) * 5);
    }
  }

  const stackPageCount = Math.max(1, Math.ceil(stackGroups.length / 5));

  // Stack page selection clamps to the last valid page (same contract as the
  // dial's handleSelectPage) and stops any running shuffle — the listener
  // explicitly navigated, so the shuffle cursor is now incompatible.
  const handleSelectStackPage = useCallback((offset: number) => {
    if (offset < 0 || offset % 5 !== 0) return;
    const maxOffset = Math.max(0, Math.floor((stackGroups.length - 1) / 5) * 5);
    setStackOffset(Math.min(offset, maxOffset));
    stopShuffle();
  }, [stackGroups.length, stopShuffle]);

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
      />

      <section className="split-home__band split-home__band--dial" aria-label="Live stations">
        <CompactDial
          activeRows={activeRows.slice(scanOffset, scanOffset + 5)}
          skippedRows={skippedRows}
          samplingRowIdx={scanRowIdx != null ? scanRowIdx - scanOffset : null}
          activeSlug={radio.station?.slug ?? null}
          playerStatus={radio.status}
          presenceMap={presenceMap}
          onTuneIn={tuneRow}
          onPlay={playRow}
          onToggleSkip={toggleSkip}
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
      />

      <section className="split-home__band split-home__band--stack" aria-label="Recent keeps">
        <CompactStack offset={stackOffset} shuffleKey={shuffleGroupKey} />
      </section>

      <StackPagerBar
        stackOffset={stackOffset}
        stackPageCount={stackPageCount}
        totalGroups={stackGroups.length}
        shuffleMode={shuffleMode}
        onSelectStackPage={handleSelectStackPage}
        onShufflePage={onShufflePage}
        onShuffleAll={onShuffleAll}
      />
    </div>
  );
}
