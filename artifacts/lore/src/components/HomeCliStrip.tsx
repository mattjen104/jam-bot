/**
 * HomeCliStrip — the CLI seam of the SplitHome three-band layout.
 *
 * Structure (top → bottom):
 *   1. Compact scan remote — numeric page selectors, one Scan button for the
 *      selected five-row page, and one Scan all button for the full filtered
 *      list. Active scan turns the Scan/Scan all button into a Stop control.
 *   2. Four centered song-age buttons.
 *   3. Seven centered station-category buttons (lore is the home control).
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

export type ScanMode = "page" | "all" | null;

export interface HomeCliStripProps extends Pick<DialCliBarProps,
  "activeTiers" | "activeCategories" | "onToggleTier" | "onToggleCategory"> {
  /** Zero-based offset of the currently visible five-row page (multiple of 5). */
  scanOffset: number;
  /**
   * Number of scan pages in the active filtered list (rows / 5, min 1).
   * The strip renders exactly this many compact numeric page buttons.
   */
  pageCount: number;
  /** Total number of rows in the filtered list (drives Scan all disabled state). */
  totalRows: number;
  /**
   * Which scan is currently active: "page" = scanning the selected five-row
   * window, "all" = scanning the full filtered list, null = not scanning.
   */
  scanMode: ScanMode;
  /** Called when the user selects a page (offset = (page - 1) * 5). */
  onSelectPage: (offset: number) => void;
  /** Called when the Scan / Stop button is pressed (toggles page-scan). */
  onScanPage: () => void;
  /** Called when the Scan all / Stop button is pressed (toggles all-scan). */
  onScanAll: () => void;
  onAddArtists: (names: string[]) => void;
  onMatt?: () => void;
  mattPending?: boolean;
  mattStatus?: MattCliStatus | null;
  /**
   * `/radio` / `/crossings` feed-mode commands. Optional for callers that only
   * need the filter remote; SplitHome wires this to the full feed at /feed.
   */
  onRadioMode?: (on: boolean) => void;
  /**
   * Called when `/scanN` is typed in the CLI input — routes into page
   * selection without restoring per-page scan-command buttons.
   */
  onScan?: (offset: number) => void;
}

export function HomeCliStrip({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  scanOffset,
  pageCount,
  totalRows,
  scanMode,
  onSelectPage,
  onScanPage,
  onScanAll,
  onAddArtists,
  onMatt,
  mattPending,
  mattStatus,
  onRadioMode,
  onScan,
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

  const currentPage = scanOffset / 5; // 0-based page index

  return (
    <div className="home-cli-strip">
      {/* The filter controls are a five-row remote: scan remote, age, station
          categories, home/CLI, then add. Each button row remains bounded and
          scrollable as a fallback for unusually narrow viewports. */}
      <div className="home-cli-strip__filter-stack" aria-label="Station and song filters">
        <div className="home-cli-strip__filter-rail">
          <div className="home-cli-strip__filter-row home-cli-strip__scan-remote" role="group" aria-label="Scan commands">
            {/* Compact numeric page selectors */}
            <div className="home-cli-strip__page-selectors" role="group" aria-label="Page">
              {Array.from({ length: Math.max(1, pageCount) }, (_, i) => {
                const isCurrentPage = currentPage === i;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`home-cli-strip__page-btn${isCurrentPage ? " home-cli-strip__page-btn--active" : ""}`}
                    aria-pressed={isCurrentPage}
                    aria-label={`page ${i + 1} /scan${i + 1}`}
                    onClick={() => onSelectPage(i * 5)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            {/* Scan (page) button */}
            <button
              type="button"
              className={`home-cli-strip__filter-chip home-cli-strip__scan-btn${scanMode === "page" ? " home-cli-strip__scan-btn--active" : ""}`}
              aria-pressed={scanMode === "page"}
              aria-label={scanMode === "page" ? "stop page scan" : "scan this page"}
              disabled={totalRows === 0}
              onClick={onScanPage}
            >
              {scanMode === "page" ? "Stop" : "Scan"}
            </button>
            {/* Scan all button */}
            <button
              type="button"
              className={`home-cli-strip__filter-chip home-cli-strip__scan-btn home-cli-strip__scan-all-btn${scanMode === "all" ? " home-cli-strip__scan-btn--active" : ""}`}
              aria-pressed={scanMode === "all"}
              aria-label={scanMode === "all" ? "stop scan all" : "scan all stations"}
              disabled={totalRows === 0}
              onClick={onScanAll}
            >
              {scanMode === "all" ? "Stop" : "Scan all"}
            </button>
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
            onHome={goHome}
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
