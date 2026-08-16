/**
 * DialFilterBar — two filter menus above the Dial's live feed.
 *
 * Left menu: song-age filters (First | Current | Catalog | Deep) — additive.
 * Right menu: station categories (Ambient & Sleep | Campus Radio | …) —
 * radio-style single-select; re-clicking the active category clears it.
 *
 * Both menus use the same pipe-separated button style as the rest of the Dial
 * topbar. Active buttons get a solid 1px bottom underline. Rendering is
 * delegated to the shared FilterToggleGroup so the SplitHome remote and this
 * bar can never drift on labels or aria-pressed behavior.
 *
 * Pure presentational: filter state is managed by DialView.
 */

import {
  AGE_TIER_DEFINITIONS,
  type AgeTier,
} from "../../lib/dialAgeFilter";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../../lib/dialCategories";
import { FilterToggleGroup } from "./FilterToggleGroup";

export type { AgeTier };
export type { StationCategory };

const AGE_OPTIONS = AGE_TIER_DEFINITIONS.map(({ tier, label, title }) => ({
  value: tier,
  label,
  title,
}));

const CATEGORY_OPTIONS = STATION_CATEGORY_DEFINITIONS.map(({ cat, label, title }) => ({
  value: cat,
  label,
  title,
}));

export interface DialFilterBarProps {
  activeTiers: Set<AgeTier>;
  activeCategories: Set<StationCategory>;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
  className?: string;
}

export function DialFilterBar({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  className,
}: DialFilterBarProps) {
  return (
    <div className={`dial-filter-bar${className ? ` ${className}` : ""}`} role="group" aria-label="Dial filters">
      {/* Left: song-age filters */}
      <FilterToggleGroup
        ariaLabel="Song age"
        options={AGE_OPTIONS}
        active={activeTiers}
        onToggle={onToggleTier}
        variant="bar"
      />

      {/* Right: station-category filters */}
      <FilterToggleGroup
        ariaLabel="Station category"
        options={CATEGORY_OPTIONS}
        active={activeCategories}
        onToggle={onToggleCategory}
        variant="bar"
        className="dial-filter-bar__group--right"
      />
    </div>
  );
}
