/**
 * RadioRemoteBar — the thin radio-remote strip pinned to the TOP of the
 * SplitHome layout (above the Dial band, just under the app header).
 *
 * One horizontally scrollable bar carrying the controls that used to live in
 * the middle CLI seam:
 *   1. Crossings dropdown — a single "Crossings on" checkbox that toggles
 *      between the crossing-ranked feed (default) and blank radio mode.
 *   2. Track age dropdown — the four age tiers (additive multi-select).
 *   3. Station type dropdown — the seven station categories (additive
 *      multi-select; checked categories are unioned, empty = all stations).
 *   4. /lore — navigation-only home button (not a filter).
 *
 * The dropdowns are the same FilterDropdownMenu components the full-Dial
 * DialFilterBar uses, with the compact "chips" trigger variant so the remote
 * reads as the same console surface. The middle seam keeps only the Dial
 * page selectors, Scan / Scan all, the CLI input, and /add.
 */

import { useCallback } from "react";
import { useLocation } from "wouter";
import { AGE_TIER_DEFINITIONS, type AgeTier } from "../lib/dialAgeFilter";
import { STATION_CATEGORY_DEFINITIONS } from "../lib/dialCategories";
import type { StationCategory } from "./dial/DialFilterBar";
import { FilterDropdownMenu } from "./dial/FilterDropdownMenu";

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

export interface RadioRemoteBarProps {
  activeTiers: ReadonlySet<AgeTier>;
  activeCategories: ReadonlySet<StationCategory>;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
  /** `/radio` / `/crossings` feed-mode commands (SplitHome routes to /feed). */
  onRadioMode?: (on: boolean) => void;
  /** Whether blank-radio mode is currently on (drives the Crossings checkbox). */
  radioMode?: boolean;
}

export function RadioRemoteBar({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  onRadioMode,
  radioMode = false,
}: RadioRemoteBarProps) {
  const [, setLocation] = useLocation();
  const goHome = useCallback(() => setLocation("/"), [setLocation]);

  // crossings is the default (radioMode=false); radio is the alt (radioMode=true).
  // Flipping the checkbox inverts the feed mode: radioMode := !crossingsActive…
  // i.e. the new radioMode equals the CURRENT crossingsActive.
  const crossingsActive = !radioMode;
  const toggleCrossings = useCallback(
    () => onRadioMode?.(crossingsActive),
    [onRadioMode, crossingsActive],
  );

  return (
    <div className="radio-remote-bar" role="toolbar" aria-label="Radio remote">
      {/* Feed mode: the Crossings checkbox. Checked = crossing-ranked feed
          (the default); unchecked = blank radio mode. */}
      <FilterDropdownMenu
        label="Crossings"
        ariaLabel="Crossings"
        options={CROSSINGS_OPTIONS}
        active={crossingsActive ? CROSSINGS_ACTIVE : CROSSINGS_INACTIVE}
        onToggle={toggleCrossings}
        variant="chips"
      />

      {/* Track age: additive multi-select, empty = all ages */}
      <FilterDropdownMenu
        label="Track age"
        ariaLabel="Track age"
        options={AGE_OPTIONS}
        active={activeTiers}
        onToggle={onToggleTier}
        variant="chips"
      />

      {/* Station type: additive multi-select, empty = all stations */}
      <FilterDropdownMenu
        label="Station type"
        ariaLabel="Station type"
        options={CATEGORY_OPTIONS}
        active={activeCategories}
        onToggle={onToggleCategory}
        variant="chips"
      />

      {/* /lore is navigation, not a filter toggle — styled as a nav link */}
      <div className="radio-remote-bar__group" role="group" aria-label="Navigation">
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__home-btn home-cli-strip__home-btn--nav"
          aria-label="homepage /lore"
          onClick={goHome}
        >
          /lore
        </button>
      </div>
    </div>
  );
}
