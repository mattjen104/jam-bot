/**
 * HomeCliStrip — the CLI seam of the SplitHome three-band layout.
 *
 * Structure (top → bottom):
 *   1. Centered scan buttons — one per 5-station page of the filtered list
 *      (/scan1 … /scanN, driven by the pageCount prop).
 *   2. Four centered song-age buttons.
 *   3. Six centered station-category buttons (lore is the home control).
 *   4. `/crossings`, `/radio`, and `/lore` controls beside the DialCliBar
 *      (strip variant), whose prompt is left-aligned so the field reads like
 *      a command line.
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

export interface HomeCliStripProps extends Pick<DialCliBarProps,
  "activeTiers" | "activeCategories" | "onToggleTier" | "onToggleCategory"> {
  scanOffset: number;
  /**
   * Number of scan pages in the active filtered list (rows / 5, min 1).
   * The strip renders exactly this many scan buttons (/scan1 … /scanN).
   */
  pageCount: number;
  onScan: (offset: number) => void;
  onAddArtists: (names: string[]) => void;
  onMatt?: () => void;
  mattPending?: boolean;
  mattStatus?: MattCliStatus | null;
  /**
   * `/radio` / `/crossings` feed-mode commands. Optional for callers that only
   * need the filter remote; SplitHome wires this to the full feed at /feed.
   */
  onRadioMode?: (on: boolean) => void;
}

export function HomeCliStrip({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  scanOffset,
  pageCount,
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
      {/* The filter controls are a five-row remote: scan, age, station
          categories, home/CLI, then add. Each button row remains bounded and
          scrollable as a fallback for unusually narrow viewports. */}
      <div className="home-cli-strip__filter-stack" aria-label="Station and song filters">
        <div className="home-cli-strip__filter-rail">
          <div className="home-cli-strip__filter-row" role="group" aria-label="Scan commands">
        {Array.from({ length: Math.max(1, pageCount) }, (_, i) => {
          const offset = i * 5;
          const command = `/scan${i + 1}`;
          const active = scanOffset === offset;
          return (
            <button
              key={command}
              type="button"
              className={`home-cli-strip__filter-chip${active ? " home-cli-strip__filter-chip--active" : ""}`}
              aria-pressed={active}
              aria-label={`scan ${i + 1} ${command}`}
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
      </div>

      {/* Feed-mode commands + home command + CLI field. The mode commands sit
          immediately before /lore so the whole row reads like one console
          line, while the input remains the flexible final segment. */}
      <div className="home-cli-strip__command-row">
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
