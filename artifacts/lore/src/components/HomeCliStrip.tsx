/**
 * HomeCliStrip — the CLI seam of the SplitHome three-band layout.
 *
 * Structure (top → bottom):
 *   1. One horizontally scrollable, command-only filter rail — scan windows,
 *      song-age tiers, and station categories, directly under station rows.
 *   2. A `/lore` home button beside the DialCliBar (strip variant), whose
 *      prompt is left-aligned so the field reads like a command line.
 *   3. The `/add artists` affordance below the input, aligned to the left.
 *
 * Every button is labeled with its CLI equivalent so the affordance is
 * self-documenting for power users.
 */

import { useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DialCliBar, type DialCliBarProps, type MattCliStatus } from "./dial/DialCliBar";
import { AGE_TIER_DEFINITIONS } from "../lib/dialAgeFilter";
import { STATION_CATEGORY_DEFINITIONS } from "../lib/dialCategories";
export type ScanOffset = 0 | 5 | 10;

const SCANS: { command: string; offset: ScanOffset }[] = [
  { command: "/scan1", offset: 0 },
  { command: "/scan2", offset: 5 },
  { command: "/scan3", offset: 10 },
];

export interface HomeCliStripProps extends Pick<DialCliBarProps,
  "activeTiers" | "activeCategories" | "onToggleTier" | "onToggleCategory"> {
  scanOffset: ScanOffset;
  onScan: (offset: number) => void;
  onAddArtists: (names: string[]) => void;
  onMatt?: () => void;
  mattPending?: boolean;
  mattStatus?: MattCliStatus | null;
}

export function HomeCliStrip({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  scanOffset,
  onScan,
  onAddArtists,
  onMatt,
  mattPending,
  mattStatus,
}: HomeCliStripProps) {
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [prefill, setPrefill] = useState<{ token: number; text: string } | null>(null);
  const prefillToken = useRef(0);

  const goLibrary = useCallback(() => setLocation("/library"), [setLocation]);
  const goHome = useCallback(() => setLocation("/"), [setLocation]);

  const insertAddPrefix = useCallback(() => {
    prefillToken.current += 1;
    setPrefill({ token: prefillToken.current, text: "/add " });
  }, []);

  return (
    <div className="home-cli-strip">
      {/* All filter commands share one scrollable rail in the scan-button
          position. The active state remains specific to each filter type. */}
      <div className="home-cli-strip__filter-rail" aria-label="Station and song filters">
        <div className="home-cli-strip__filter-row" role="group" aria-label="Filter commands">
        {SCANS.map(({ command, offset }) => {
          const active = scanOffset === offset;
          return (
            <button
              key={command}
              type="button"
              className={`home-cli-strip__filter-chip${active ? " home-cli-strip__filter-chip--active" : ""}`}
              aria-pressed={active}
              aria-label={`scan ${offset / 5 + 1} ${command}`}
              onClick={() => onScan(offset)}
            >
              {command}
            </button>
          );
        })}
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

      {/* Home command + CLI field. The home command sits below /scan1 and
          keeps the entry prompt to its right, like one console line. */}
      <div className="home-cli-strip__command-row">
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__home-btn"
          aria-label="homepage /lore"
          onClick={goHome}
        >
          /lore
        </button>
        <div className="home-cli-strip__input-row">
          <DialCliBar
            variant="strip"
            activeTiers={activeTiers}
            activeCategories={activeCategories}
            onToggleTier={onToggleTier}
            onToggleCategory={onToggleCategory}
            onAddArtists={onAddArtists}
            onScan={onScan}
            onLibrary={goLibrary}
            onMatt={onMatt}
            mattPending={mattPending}
            mattStatus={mattStatus}
            inputRef={inputRef}
            prefill={prefill}
          />
        </div>
      </div>

      {/* Stack-side: primary add-artists affordance stays at the left edge. */}
      <div className="home-cli-strip__row home-cli-strip__row--stack">
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__btn--primary"
          aria-label="add artists /add"
          onClick={insertAddPrefix}
        >
          <span className="home-cli-strip__add-command">
            <span className="home-cli-strip__scan-slash" aria-hidden="true">/</span>
            <span>add</span>
            <span className="home-cli-strip__command-hint">artists</span>
          </span>
        </button>
      </div>
    </div>
  );
}
