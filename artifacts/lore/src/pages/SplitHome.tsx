/**
 * SplitHome — the Lore front door as a fixed five-slot split view.
 *
 *   top edge  — RadioRemoteBar: the radio remote (/crossings /radio /lore
 *               plus the age-tier and station-category chips), pinned above
 *               the Dial band where the controls are most reachable.
 *   top ~50%  — CompactDial: five live stations from the attribution-ladder
 *               sort, windowed by the active scan (offset 0, 5, 10, … — the
 *               page count grows with the filtered list).
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
  readPins,
  normalizeDjName,
  type DialStationCategory,
} from "../hooks/useDialData";
import { useStationPresence } from "../hooks/useStationPresence";
import { useSeedManager } from "../hooks/useSeedManager";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { reason } from "../components/dialViewHelpers";
import { toggleAgeTier, toggleStationCategory } from "../lib/dialFilterState";
import { writeRadioMode } from "../lib/dialRadioMode";
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
  // single-select categories). No category is selected initially, so the
  // front door starts unfiltered; the first selection is permanent
  // (radio-style, no return to the empty state).
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

  const {
    stations,
    overlapByPickerId,
    pickerNameToId,
    crossingSourceMode,
  } = useDialData("personal", {
    categories: activeCategories as ReadonlySet<DialStationCategory>,
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

  // Attribution-ladder sort — same ordering as DialView's sortedRows:
  // live crossing first, then attributed DJs, then overlap desc, rung asc.
  const sortedRows = useMemo(() => {
    const pins = readPins();
    const pickerOv = (pickerId: number | null, djName: string | null): number => {
      if (pickerId != null) return overlapByPickerId.get(pickerId) ?? 0;
      if (djName != null) {
        const pid = pickerNameToId.get(normalizeDjName(djName));
        if (pid != null) return overlapByPickerId.get(pid) ?? 0;
      }
      return 0;
    };
    return [...stations]
      .filter((ds) => ds.isLive)
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
        const rz = reason(attributionSafeShow, ds.crossings, ds.artistCrossings, crossingSourceMode);
        const isPinned = pins.has(ds.station.slug);
        return { ds, show: attributionSafeShow, rz, effectiveDjName, isPinned };
      })
      .sort((a, b) => {
        const ac = a.rz.r === 1 ? 0 : 1;
        const bc = b.rz.r === 1 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        const at = a.effectiveDjName != null ? 0 : 1;
        const bt = b.effectiveDjName != null ? 0 : 1;
        if (at !== bt) return at - bt;
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const aOv = a.effectiveDjName != null ? pickerOv(a.show?.pickerId ?? null, a.effectiveDjName) : a.ds.lifetimeCrossings;
        const bOv = b.effectiveDjName != null ? pickerOv(b.show?.pickerId ?? null, b.effectiveDjName) : b.ds.lifetimeCrossings;
        if (aOv !== bOv) return bOv - aOv;
        const sortR = (r: number) => r === 0 ? 99 : r;
        return sortR(a.rz.r) - sortR(b.rz.r);
      });
  }, [stations, overlapByPickerId, pickerNameToId, crossingSourceMode]);

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

  // Keep refs current so timer callbacks always see the latest values.
  // Synced in an effect (not during render) per the react-hooks/refs rule;
  // timers only fire after render + effects, so the mirror is never stale
  // when a hop callback reads it.
  useEffect(() => {
    filteredRowsRef.current = filteredRows;
    scanOffsetRef.current = scanOffset;
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

  // Clamp the scan window when the filtered list shrinks (filter change or
  // stations dropping off) so a stale offset never shows an empty window.
  // Render-time adjustment (React's supported pattern for deriving state from
  // a changing input; the lint rules forbid setState-in-effect). The last
  // valid page offset is floor((rows - 1) / 5) * 5.
  const [prevRowCount, setPrevRowCount] = useState(filteredRows.length);
  if (prevRowCount !== filteredRows.length) {
    setPrevRowCount(filteredRows.length);
    if (filteredRows.length === 0) {
      if (scanOffset !== 0) setScanOffset(0);
    } else if (scanOffset >= filteredRows.length) {
      setScanOffset(Math.floor((filteredRows.length - 1) / 5) * 5);
    }
  }

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / 5));

  // --- Compact scan hop logic ---
  // The scan auto-advances through a list of rows at SCAN_DWELL_MS per hop,
  // previewing each station's live stream via radio.preview(). The list is
  // either the current page's five rows ("page" mode) or all filtered rows
  // ("all" mode). scanRowIdx is a raw index into filteredRows (not page-local).
  const radioRef = useRef(radio);
  // eslint-disable-next-line react-hooks/refs
  radioRef.current = radio;

  const scheduleNextHop = useCallback((currentRowIdx: number, mode: "page" | "all") => {
    // Inner named function so the recursive self-reference stays local (the
    // useCallback const can't reference itself under the compiler rules).
    function hop(fromIdx: number) {
      scanRt.current.timer = setTimeout(() => {
        if (!scanRt.current.active) return;
        const rows = filteredRowsRef.current;
        const offset = scanOffsetRef.current;
        const list = mode === "page" ? rows.slice(offset, offset + 5) : rows;
        const localIdx = fromIdx + 1;
        if (list.length === 0) { stopCompactScan(); return; }
        const wrappedLocalIdx = localIdx % list.length;
        const globalIdx = mode === "page" ? offset + wrappedLocalIdx : wrappedLocalIdx;
        const row = rows[globalIdx];
        if (row && resolvePlaybackSource(row.ds.station) != null) {
          void radioRef.current.preview(row.ds.station);
        }
        // An all-scan drives the visible window along with it, so the sampled
        // station is always rendered and highlighted (CompactDial only shows
        // the current five-row page).
        if (mode === "all") {
          setScanOffset(Math.floor(globalIdx / 5) * 5);
        }
        setScanRowIdx(globalIdx);
        hop(wrappedLocalIdx);
      }, SCAN_DWELL_MS);
    }
    hop(currentRowIdx);
  }, [stopCompactScan]);

  const startCompactScan = useCallback((mode: "page" | "all") => {
    const rows = filteredRowsRef.current;
    const offset = scanOffsetRef.current;
    const list = mode === "page" ? rows.slice(offset, offset + 5) : rows;
    if (list.length === 0) return;
    scanRt.current.active = true;
    scanRt.current.mode = mode;
    setScanMode(mode);
    // Start at the first row of the relevant list. An all-scan begins at the
    // top of the whole filtered list, so snap the visible window to page 1.
    const globalIdx = mode === "page" ? offset : 0;
    if (mode === "all") {
      setScanOffset(0);
      scanOffsetRef.current = 0;
    }
    const row = rows[globalIdx];
    if (row && resolvePlaybackSource(row.ds.station) != null) {
      void radioRef.current.preview(row.ds.station);
    }
    setScanRowIdx(globalIdx);
    scheduleNextHop(0, mode);
  }, [scheduleNextHop]);

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

  // Stop scan when filters change — the row list is incompatible with the
  // in-progress scan cursor.
  const prevTiersRef = useRef(activeTiers);
  const prevCatsRef = useRef(activeCategories);
  useEffect(() => {
    const tiersChanged = prevTiersRef.current !== activeTiers;
    const catsChanged = prevCatsRef.current !== activeCategories;
    prevTiersRef.current = activeTiers;
    prevCatsRef.current = activeCategories;
    if ((tiersChanged || catsChanged) && scanRt.current.active) {
      stopCompactScan();
    }
  }, [activeTiers, activeCategories, stopCompactScan]);

  // Clean up timers on unmount.
  useEffect(() => () => {
    if (scanRt.current.timer != null) clearTimeout(scanRt.current.timer);
  }, []);

  const liveStationIds = useMemo(
    () => filteredRows.slice(scanOffset, scanOffset + 5).map((row) => row.ds.station.id),
    [filteredRows, scanOffset],
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
      />

      <section className="split-home__band split-home__band--dial" aria-label="Live stations">
        <CompactDial
          rows={filteredRows}
          offset={scanOffset}
          samplingRowIdx={scanRowIdx}
          activeSlug={radio.station?.slug ?? null}
          playerStatus={radio.status}
          presenceMap={presenceMap}
          onTuneIn={tuneRow}
          onPlay={playRow}
        />
      </section>

      <HomeCliStrip
        activeTiers={activeTiers}
        activeCategories={activeCategories}
        onToggleTier={toggleTier}
        onToggleCategory={toggleCategory}
        scanOffset={scanOffset}
        pageCount={pageCount}
        totalRows={filteredRows.length}
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
