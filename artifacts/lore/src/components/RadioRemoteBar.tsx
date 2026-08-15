/**
 * RadioRemoteBar — the thin radio-remote strip pinned to the TOP of the
 * SplitHome layout (above the Dial band, just under the app header).
 *
 * One horizontally scrollable bar carrying the controls that used to live in
 * the middle CLI seam:
 *   1. Feed-mode commands — /crossings, /radio, /lore.
 *   2. Four song-age chips (/first /current /catalog /deep).
 *   3. Seven station-category chips.
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

export interface RadioRemoteBarProps {
  activeTiers: ReadonlySet<AgeTier>;
  activeCategories: ReadonlySet<StationCategory>;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
  /** `/radio` / `/crossings` feed-mode commands (SplitHome routes to /feed). */
  onRadioMode?: (on: boolean) => void;
}

export function RadioRemoteBar({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  onRadioMode,
}: RadioRemoteBarProps) {
  const [, setLocation] = useLocation();
  const goHome = useCallback(() => setLocation("/"), [setLocation]);

  return (
    <div className="radio-remote-bar" role="toolbar" aria-label="Radio remote">
      <div className="radio-remote-bar__group" role="group" aria-label="Feed mode commands">
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__mode-btn"
          aria-label="crossings /crossings"
          onClick={() => onRadioMode?.(false)}
        >
          /crossings
        </button>
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__mode-btn"
          aria-label="radio /radio"
          onClick={() => onRadioMode?.(true)}
        >
          /radio
        </button>
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__home-btn"
          aria-label="homepage /lore"
          onClick={goHome}
        >
          /lore
        </button>
      </div>

      <div className="radio-remote-bar__group" role="group" aria-label="Age commands">
        {AGE_TIER_DEFINITIONS.map(({ tier, command, title }) => {
          const active = activeTiers.has(tier);
          return (
            <button
              key={tier}
              type="button"
              className={`home-cli-strip__filter-chip${active ? " home-cli-strip__filter-chip--active" : ""}`}
              aria-pressed={active}
              title={title}
              onClick={() => onToggleTier(tier)}
            >
              {command}
            </button>
          );
        })}
      </div>

      <div className="radio-remote-bar__group" role="group" aria-label="Station category commands">
        {STATION_CATEGORY_DEFINITIONS.map(({ cat, command, title }) => {
          const active = activeCategories.has(cat);
          return (
            <button
              key={cat}
              type="button"
              className={`home-cli-strip__filter-chip${active ? " home-cli-strip__filter-chip--active" : ""}`}
              aria-pressed={active}
              title={title}
              onClick={() => onToggleCategory(cat)}
            >
              {command}
            </button>
          );
        })}
      </div>
    </div>
  );
}
