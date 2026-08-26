/**
 * SplitHome — the Lore front door as a minimal two-tree view.
 *
 *   top         — CompactDial: concise category cards with honest now-playing
 *                 metadata. Opening one reveals its individual station rows
 *                 inline as a category → station tree.
 *   below       — CompactStack: kept album groups as an artist → album tree.
 *
 * The view never scrolls — it fills the viewport between the app header and
 * the bottom shell. The full scrollable Dial lives at /feed; the full Stack
 * at /library.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import {
  useDialData,
  type DialStationCategory,
} from "../hooks/useDialData";
import { useStationPresence } from "../hooks/useStationPresence";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import {
  DEFAULT_ACTIVE_AGE_TIERS,
  useDialSkipped,
  useStackSkipped,
  toggleStationCategory,
} from "../lib/dialFilterState";
import { readCrossingScope } from "../lib/crossingScope";
import { rowPassesAgeTierFilter, type AgeTier } from "../lib/dialAgeFilter";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../lib/dialCategories";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { CompactDial } from "../components/CompactDial";
import { CompactStack } from "../components/CompactStack";
import { useMattStarterLibrary, useStartMattLibrary } from "../lib/meHooks";

const HOME_CATEGORY_SOURCES: ReadonlySet<DialStationCategory> = new Set(
  STATION_CATEGORY_DEFINITIONS.map((definition) => definition.cat as DialStationCategory),
);
const HOME_ACTIVE_CATEGORIES: ReadonlySet<StationCategory> = new Set([
  "anchor",
  "campus",
  "specialist",
  "public",
  "indie",
]);

export default function SplitHome() {
  // The front door intentionally fixes the full Feed's advanced filters and
  // display modes. Those controls remain available on /feed and /library.
  const activeTiers: ReadonlySet<AgeTier> = DEFAULT_ACTIVE_AGE_TIERS;
  // The compact home is an inventory, not a filter result: retain the
  // listener's normal category defaults for /feed, but fetch every category
  // here so an unchecked category remains visible and can be opened.
  const crossingScope = readCrossingScope();

  // Per-station selection remains in the tree without exposing the old scan
  // remote on the front door.
  const { skipped, toggleSkip } = useDialSkipped();
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set(HOME_ACTIVE_CATEGORIES),
  );
  const [remoteOpen, setRemoteOpen] = useState(false);
  const toggleCategory = useCallback((category: StationCategory) => {
    setActiveCategories((current) => toggleStationCategory(current, category));
  }, []);

  const { stations } = useDialData("personal", {
    categories: HOME_CATEGORY_SOURCES,
    // The main view lists EVERY station (live or not) alphabetically; the
    // hook's default dial visibility filter (live / flagship / named show)
    // would silently drop off-air stations without schedule metadata.
    includeAllStations: true,
    scanActive: true,
    crossingsEnabled: false,
    deferEnrichment: true,
  });
  const { data: mattStarter, isLoading: mattStarterLoading } = useMattStarterLibrary();
  const startMattLibrary = useStartMattLibrary();
  const mattBootstrapAttempted = useRef(false);
  const mattBootstrapPending =
    mattStarterLoading ||
    (mattStarter?.available === true &&
      (startMattLibrary.isIdle || startMattLibrary.isPending));

  // The tree-only home has no command strip, but /matt remains the chosen
  // listener identity for this front door. Copy the configured starter library
  // exactly once, then let the mutation's cache invalidation refresh library
  // and crossing data behind the visible station tree.
  useEffect(() => {
    if (
      mattBootstrapAttempted.current ||
      !mattStarter?.available ||
      startMattLibrary.isPending
    ) {
      return;
    }
    mattBootstrapAttempted.current = true;
    startMattLibrary.mutate();
  }, [mattStarter?.available, startMattLibrary]);

  const { radio } = usePlayer();

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
    // Match the full Dial's age semantics: filter by the station's current
    // track (live pulse first, then the live show's last spin), while keeping
    // quiet/trackless and unknown-age stations visible.
    if (activeTiers.size > 0) {
      rows = rows.filter((row) => {
        const track = row.ds.liveTrack ?? row.show?.currentTrack ?? null;
        return !track || rowPassesAgeTierFilter(track.ageTier, activeTiers);
      });
    }
    return rows;
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

  const liveStationIds = useMemo(
    () => [...activeRows, ...skippedRows]
      .map((row) => row.ds.station.id)
      // Personal (listener-pinned) stations carry negative synthetic ids and
      // have no server-side presence — leave them out of the presence query.
      .filter((id) => id > 0),
    [activeRows, skippedRows],
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

  // Tree row selection remains independent from disclosure, but the Stack's
  // paging, density, and shuffle controls stay on the full /library route.
  const { skipped: stackSkipped, toggleSkip: toggleStackSkip } = useStackSkipped();
  return (
    <main className="split-home">
      <div className="split-home__trees">
        <section className="split-home__band split-home__band--dial" aria-label="Live stations">
          <button
            type="button"
            className="split-home__remote-trigger"
            aria-label="Open radio remote and filter settings"
            aria-expanded={remoteOpen}
            aria-controls="compact-category-remote"
            onClick={() => setRemoteOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
          </button>
          <CompactDial
            activeRows={activeRows}
            skippedRows={skippedRows}
            activeSlug={radio.station?.slug ?? null}
            playerStatus={radio.status}
            presenceMap={presenceMap}
            onTuneIn={tuneRow}
            onPlay={playRow}
            onToggleSkip={toggleSkip}
            onToggleCategory={toggleCategory}
            activeCategories={activeCategories}
            crossingScope={crossingScope}
            suppressCrossings={false}
            displayMode="personal"
            categoryFirst={hasEditorialCategory}
            hideCategoryFilters
            remoteOpen={remoteOpen}
            onCloseRemote={() => setRemoteOpen(false)}
          />
        </section>

        <section className="split-home__band split-home__band--stack" aria-label="Recent keeps">
          <CompactStack
            skipped={stackSkipped}
            onToggleSkip={toggleStackSkip}
            homeCarousel
            homeBootstrapPending={mattBootstrapPending}
          />
        </section>

      </div>
    </main>
  );
}
