/**
 * SplitHome — the Lore front door as a fixed three-band split view.
 *
 *   top ~50%  — CompactDial: five live stations from the attribution-ladder
 *               sort, windowed by the active scan (offset 0 / 5 / 10).
 *   middle    — HomeCliStrip: the CLI seam. Scan buttons hang down from the
 *               Dial band; add-artists/library buttons extend up from the
 *               Stack band; the slash-command input sits between them.
 *   bottom ~50% — CompactStack: the five newest kept album groups as
 *               cassette-spine rows.
 *
 * The view never scrolls — it fills the viewport between the app header and
 * the bottom shell. The full scrollable Dial lives at /feed; the full Stack
 * at /library.
 */

import { useCallback, useMemo, useState } from "react";
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
import { HomeCliStrip, type ScanOffset } from "../components/HomeCliStrip";
import { useStartMattLibrary } from "../lib/meHooks";
import type { MattCliStatus } from "../components/dial/DialCliBar";

export default function SplitHome() {
  const [, setLocation] = useLocation();

  // CLI filter state — same semantics as the full Dial (additive tiers,
  // last-category protection). Categories drive the station fetch.
  const [activeTiers, setActiveTiers] = useState<Set<AgeTier>>(() => new Set());
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set<StationCategory>(["lore"]),
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

  // While a Stack row is expanded into its album-art hero, the mini feed
  // and the CLI remote are hidden so the cover gets the whole viewport.
  const [stackExpanded, setStackExpanded] = useState(false);

  // Scan window: which 5-station slice of the sorted feed is shown.
  const [scanOffset, setScanOffset] = useState<ScanOffset>(0);
  const handleScan = useCallback((offset: number) => {
    if (offset === 0 || offset === 5 || offset === 10) setScanOffset(offset);
  }, []);

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

  const liveStationIds = useMemo(
    () => filteredRows.slice(scanOffset, scanOffset + 5).map((row) => row.ds.station.id),
    [filteredRows, scanOffset],
  );
  const presenceMap = useStationPresence(liveStationIds);

  const tuneRow = useCallback((row: DialLaneRow) => {
    if (resolvePlaybackSource(row.ds.station) == null) return;
    if (radio.station?.slug !== row.ds.station.slug || radio.status !== "playing") {
      void radio.toggle(row.ds.station);
    }
  }, [radio]);
  const playRow = useCallback((row: DialLaneRow) => {
    if (resolvePlaybackSource(row.ds.station) == null) return;
    void radio.toggle(row.ds.station);
  }, [radio]);

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
  const mattStarterMutation = useStartMattLibrary();
  const startMattLibrary = useCallback(() => {
    if (mattStarterMutation.isPending) return;
    mattStarterMutation.mutate();
  }, [mattStarterMutation]);
  const mattCliStatus: MattCliStatus | null = mattStarterMutation.isPending
    ? { kind: "pending", message: "Adding Matt’s starter library…" }
    : mattStarterMutation.error
      ? {
          kind: "error",
          message: mattStarterMutation.error instanceof Error
            ? mattStarterMutation.error.message
            : "We couldn’t add Matt’s starter library. Try again.",
        }
      : mattStarterMutation.data
        ? mattStarterMutation.data.available
          ? {
              kind: "success",
              message: mattStarterMutation.data.addedCount > 0
                ? `Added ${mattStarterMutation.data.addedCount} album${mattStarterMutation.data.addedCount === 1 ? "" : "s"} from Matt’s starter library.`
                : "Matt’s starter library is already in your Stack.",
            }
          : {
              kind: "error",
              message: mattStarterMutation.data.error
                ?? "Matt’s starter library is not available right now.",
            }
        : null;

  return (
    <div className={`split-home${stackExpanded ? " split-home--stack-expanded" : ""}`}>
      {/* While a Stack album is expanded into its art hero, the mini feed and
          the CLI remote unmount so the cover owns the whole viewport. */}
      {!stackExpanded && (
        <section className="split-home__band split-home__band--dial" aria-label="Live stations">
          <CompactDial
            rows={filteredRows}
            offset={scanOffset}
            activeSlug={radio.station?.slug ?? null}
            playerStatus={radio.status}
            presenceMap={presenceMap}
            onTuneIn={tuneRow}
            onPlay={playRow}
          />
        </section>
      )}

      {!stackExpanded && (
        <HomeCliStrip
          activeTiers={activeTiers}
          activeCategories={activeCategories}
          onToggleTier={toggleTier}
          onToggleCategory={toggleCategory}
          scanOffset={scanOffset}
          onScan={handleScan}
          onAddArtists={handleAddArtists}
          onRadioMode={handleRadioMode}
          onMatt={startMattLibrary}
          mattPending={mattStarterMutation.isPending}
          mattStatus={mattCliStatus}
        />
      )}

      <section className="split-home__band split-home__band--stack" aria-label="Recent keeps">
        <CompactStack onExpandedChange={setStackExpanded} />
      </section>
    </div>
  );
}
