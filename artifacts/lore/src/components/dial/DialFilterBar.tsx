/**
 * DialFilterBar — three filter dropdown menus above the Dial's live feed.
 *
 *   - Crossings    — one checkbox ("Crossings on"): checked = crossing-ranked
 *                    feed, unchecked = blank radio mode.
 *   - Track age    — First · Current · Catalog · Deep (additive; empty = no
 *                    age filtering).
 *   - Station type — the seven editorial categories (additive; checked
 *                    categories are unioned, empty = all stations).
 *
 * Each family is a FilterDropdownMenu: a trigger button with an active-count
 * badge opens a panel of labeled checkboxes. Rendering is shared with the
 * SplitHome remote so the two surfaces can never drift on labels or
 * interaction behavior.
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
import { FilterDropdownMenu } from "./FilterDropdownMenu";
import { CrossingScopePill } from "./CrossingScopePill";
import type { CrossingScope, StationSortMetric } from "../../lib/crossingScope";

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

/** The Crossings menu has exactly one member: the mode itself. */
const CROSSINGS_VALUE = "on";
const CROSSINGS_OPTIONS = [
  {
    value: CROSSINGS_VALUE,
    label: "Crossings on",
    title: "Rank the feed by stations crossing your artists; uncheck for plain radio",
  },
] as const;
const CROSSINGS_ACTIVE = new Set<string>([CROSSINGS_VALUE]);
const CROSSINGS_INACTIVE = new Set<string>();
const SORT_OPTIONS = [
  { value: "crossings", label: "Crossings", title: "Order stations by crossings in the selected time range" },
  { value: "firstPlays", label: "First plays", title: "Order stations by first-play crossings in the selected time range" },
] as const;

export interface DialFilterBarProps {
  activeTiers: Set<AgeTier>;
  activeCategories: Set<StationCategory>;
  /** Crossings mode state — the inverse of the caller's radioMode flag. */
  crossingsActive: boolean;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
  /** Fired when the "Crossings on" checkbox flips. */
  onToggleCrossings: () => void;
  /** Active crossing scope — renders the scope pill next to Crossings. */
  crossingScope?: CrossingScope;
  /** Cycles the scope: now → this set → 24h → 7d → lifetime. */
  onCycleCrossingScope?: () => void;
  /** Sort metric for the selected crossing scope. */
  sortMetric?: StationSortMetric;
  onSortMetric?: (metric: StationSortMetric) => void;
  className?: string;
}

export function DialFilterBar({
  activeTiers,
  activeCategories,
  crossingsActive,
  onToggleTier,
  onToggleCategory,
  onToggleCrossings,
  crossingScope,
  onCycleCrossingScope,
  sortMetric,
  onSortMetric,
  className,
}: DialFilterBarProps) {
  return (
    <div className={`dial-filter-bar${className ? ` ${className}` : ""}`} role="group" aria-label="Dial filters">
      <FilterDropdownMenu
        label="Crossings"
        ariaLabel="Crossings"
        options={CROSSINGS_OPTIONS}
        active={crossingsActive ? CROSSINGS_ACTIVE : CROSSINGS_INACTIVE}
        onToggle={onToggleCrossings}
        variant="bar"
      />
      {/* Scope pill — sits next to the crossings toggle; grayed when off. */}
      {crossingScope && onCycleCrossingScope && (
        <CrossingScopePill
          scope={crossingScope}
          enabled={crossingsActive}
          onCycle={onCycleCrossingScope}
        />
      )}
      {sortMetric && onSortMetric && (
        <FilterDropdownMenu
          label="Sort"
          ariaLabel="Sort stations"
          options={SORT_OPTIONS}
          active={new Set<string>([sortMetric])}
          onToggle={(value) => onSortMetric(value as StationSortMetric)}
          variant="bar"
        />
      )}
      <FilterDropdownMenu
        label="Track age"
        ariaLabel="Track age"
        options={AGE_OPTIONS}
        active={activeTiers}
        onToggle={onToggleTier}
        variant="bar"
      />
      <FilterDropdownMenu
        label="Station type"
        ariaLabel="Station type"
        options={CATEGORY_OPTIONS}
        active={activeCategories}
        onToggle={onToggleCategory}
        variant="bar"
        className="dial-filter-bar__group--right"
      />
    </div>
  );
}
