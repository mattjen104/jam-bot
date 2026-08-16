/**
 * RadioRemoteBar — the thin radio-remote strip pinned to the TOP of the
 * SplitHome layout (above the Dial band, just under the app header).
 *
 * One horizontally scrollable bar carrying the controls that used to live in
 * the middle CLI seam:
 *   1. Feed-mode commands — /crossings (default, pressed), /radio.
 *      /lore is navigation-only and rendered as a nav link, not a toggle.
 *   2. Four song-age chips (/first /current /catalog /deep).
 *   3. Seven station-category chips.
 *
 * Feed-mode buttons are true exclusive toggles: /crossings starts pressed
 * (the default discovery mode). Pressing either one transfers aria-pressed.
 * /lore is a navigation affordance — it goes home rather than filtering, so
 * it carries no pressed state and is styled as a secondary nav button.
 *
 * Chips reuse the home-cli-strip key styling so the remote reads as the same
 * console surface, just relocated to the top edge. The middle seam keeps only
 * the Dial page selectors, Scan / Scan all, the CLI input, and /add.
 */

import { useCallback } from "react";
import { useLocation } from "wouter";
import { AGE_TIER_DEFINITIONS, type AgeTier } from "../lib/dialAgeFilter";
import { STATION_CATEGORY_DEFINITIONS } from "../lib/dialCategories";
import type { StationCategory } from "./dial/DialFilterBar";
import { FilterToggleGroup } from "./dial/FilterToggleGroup";

// The remote's chips are labeled by their CLI command (/first, /campus, …)
// so the surface stays self-documenting for the typed CLI.
const AGE_CHIP_OPTIONS = AGE_TIER_DEFINITIONS.map(({ tier, command, title }) => ({
  value: tier,
  label: command,
  title,
}));

const CATEGORY_CHIP_OPTIONS = STATION_CATEGORY_DEFINITIONS.map(({ cat, command, title }) => ({
  value: cat,
  label: command,
  title,
}));

export interface RadioRemoteBarProps {
  activeTiers: ReadonlySet<AgeTier>;
  activeCategories: ReadonlySet<StationCategory>;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
  /** `/radio` / `/crossings` feed-mode commands (SplitHome routes to /feed). */
  onRadioMode?: (on: boolean) => void;
  /** Whether blank-radio mode is currently on (drives aria-pressed). */
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
  const crossingsActive = !radioMode;
  const radioActive = radioMode;

  return (
    <div className="radio-remote-bar" role="toolbar" aria-label="Radio remote">
      {/* Feed mode: exclusive toggles. /crossings default-on, /radio off.
          Clicking /radio while it is active releases back to /crossings;
          clicking /crossings while active is a no-op (one mode always on). */}
      <div className="radio-remote-bar__group" role="group" aria-label="Feed mode">
        <button
          type="button"
          className={`home-cli-strip__btn home-cli-strip__mode-btn${crossingsActive ? " home-cli-strip__btn--active" : ""}`}
          aria-pressed={crossingsActive}
          aria-label="crossings /crossings"
          onClick={() => onRadioMode?.(false)}
        >
          /crossings
        </button>
        <button
          type="button"
          className={`home-cli-strip__btn home-cli-strip__mode-btn${radioActive ? " home-cli-strip__btn--active" : ""}`}
          aria-pressed={radioActive}
          aria-label="radio /radio"
          onClick={() => onRadioMode?.(!radioActive)}
        >
          /radio
        </button>
        {/* /lore is navigation, not a filter toggle — styled as a nav link */}
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__home-btn home-cli-strip__home-btn--nav"
          aria-label="homepage /lore"
          onClick={goHome}
        >
          /lore
        </button>
      </div>

      {/* Age filters: additive multi-select, empty = all ages */}
      <FilterToggleGroup
        ariaLabel="Age commands"
        options={AGE_CHIP_OPTIONS}
        active={activeTiers}
        onToggle={onToggleTier}
        variant="chips"
      />

      {/* Station categories: single-select, click active to clear */}
      <FilterToggleGroup
        ariaLabel="Station category commands"
        options={CATEGORY_CHIP_OPTIONS}
        active={activeCategories}
        onToggle={onToggleCategory}
        variant="chips"
      />
    </div>
  );
}
