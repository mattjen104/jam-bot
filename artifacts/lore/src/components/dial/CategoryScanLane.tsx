/**
 * CategoryScanLane — the Dial's Scan lens: one now-playing button per
 * station category (Campus Radio, Anchor Stations, Public & Community,
 * Specialist, Ambient & Sleep, Independent DJ, Discovery).
 *
 * Every category collapses to a single large button that rotates through the
 * category's live stations, so the listener can spot a familiar artist
 * across all seven categories on one screen and tap to tune in.
 *
 * Scan is a parallel discovery surface: it is driven by the UNFILTERED
 * curated station list, so category-filter selections never change what it
 * shows. Only curated stations appear — listener-added (Radio Browser)
 * stations have no server-supplied `stationCategories` and are skipped.
 * Categories with zero curated stations are omitted.
 *
 * Pure presentational: all data arrives via props (no fetches here).
 */
import { useMemo } from "react";
import type { Station } from "@workspace/api-client-react";
import type { DialSpin } from "../../hooks/useDialData";
import { STATION_CATEGORY_DEFINITIONS, type StationCategory } from "../../lib/dialCategories";
import { CategoryScanButton } from "./CategoryScanButton";

export interface CategoryScanLaneProps {
  /** Raw curated station list, unfiltered by the category filter. */
  stations: Station[];
  /** Live now-playing track per station slug (REST poll + SSE overrides). */
  nowPlayingBySlug: Map<string, DialSpin>;
  /** Slug of the station the listener is currently tuned to, if any. */
  activeSlug: string | null;
  onTuneIn: (slug: string) => void;
}

export function CategoryScanLane({
  stations,
  nowPlayingBySlug,
  activeSlug,
  onTuneIn,
}: CategoryScanLaneProps) {
  const byCategory = useMemo(() => {
    const groups = new Map<StationCategory, Station[]>();
    for (const station of stations) {
      // Each curated station has exactly one primary category, assigned
      // server-side; stationCategories[0] is that category.
      const cat = station.stationCategories?.[0] as StationCategory | undefined;
      if (!cat) continue;
      const list = groups.get(cat);
      if (list) list.push(station);
      else groups.set(cat, [station]);
    }
    return groups;
  }, [stations]);

  const rendered = STATION_CATEGORY_DEFINITIONS.filter(
    (def) => (byCategory.get(def.cat)?.length ?? 0) > 0,
  );
  if (rendered.length === 0) return null;

  return (
    <div className="dial-scan" data-testid="dial-scan-lane">
      {rendered.map((def) => (
        <CategoryScanButton
          key={def.cat}
          category={def.cat}
          label={def.label}
          stations={byCategory.get(def.cat) ?? []}
          nowPlayingBySlug={nowPlayingBySlug}
          activeSlug={activeSlug}
          onTuneIn={onTuneIn}
        />
      ))}
    </div>
  );
}
