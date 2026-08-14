/**
 * HomeCliStrip — the CLI seam of the SplitHome three-band layout.
 *
 * Structure (top → bottom):
 *   1. Three centered scan buttons.
 *   2. Four centered song-age buttons.
 *   3. A `/lore` home button beside the DialCliBar (strip variant), whose
 *      prompt is left-aligned so the field reads like a command line.
 *   4. Five centered station-category buttons (lore is the home control).
 *   5. The `/add artists` affordance, aligned to the left.
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
  /**
   * `/radio` / `/crossings` feed-mode commands. Optional — SplitHome leaves
   * this undefined because radioMode only applies to the full DialView feed
   * at /feed (the CompactDial keeps the crossing sort regardless).
   */
  onRadioMode?: (on: boolean) => void;
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
  onRadioMode,
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
      {/* The filter controls are a five-row remote: scan, age, home/CLI,
          station categories, then add. Each button row remains bounded and
          scrollable as a fallback for unusually narrow viewports. */}
      <div className="home-cli-strip__filter-stack" aria-label="Station and song filters">
        <div className="home-cli-strip__filter-rail">
          <div className="home-cli-strip__filter-row" role="group" aria-label="Scan commands">
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
          </div>
        </div>

        <div className="home-cli-strip__filter-rail">
          <div className="home-cli-strip__filter-row" role="group" aria-label="Age commands">
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
            onRadioMode={onRadioMode}
            mattPending={mattPending}
            mattStatus={mattStatus}
            inputRef={inputRef}
            prefill={prefill}
          />
        </div>
      </div>

      <div className="home-cli-strip__filter-rail">
        <div className="home-cli-strip__filter-row" role="group" aria-label="Station category commands">
          {STATION_CATEGORY_DEFINITIONS.filter(({ cat }) => cat !== "lore").map(({ cat, command, title }) => {
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
