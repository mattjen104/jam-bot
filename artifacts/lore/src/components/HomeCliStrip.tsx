/**
 * HomeCliStrip — the CLI seam of the SplitHome three-band layout.
 *
 * Structure (top → bottom):
 *   1. Three command-only filter rows — scan windows, song-age tiers, and
 *      station categories, directly under the station rows.
 *   2. The DialCliBar (strip variant) — a single-line input with a `/lore`
 *      Signifier ghost placeholder. All slash commands work here.
 *   3. The `/add artists` affordance below the input, extending up from Stack.
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

  const insertAddPrefix = useCallback(() => {
    prefillToken.current += 1;
    setPrefill({ token: prefillToken.current, text: "/add " });
  }, []);

  return (
    <div className="home-cli-strip">
      {/* Dial-side: scan buttons hang down toward the input */}
      <div className="home-cli-strip__row home-cli-strip__row--dial" role="group" aria-label="Dial scan windows">
        {SCANS.map(({ command, offset }) => {
          const active = scanOffset === offset;
          return (
            <button
              key={command}
              type="button"
              className={`home-cli-strip__btn${active ? " home-cli-strip__btn--active" : ""}`}
              aria-pressed={active}
              aria-label={`scan ${offset / 5 + 1} ${command}`}
              onClick={() => onScan(offset)}
            >
              <span className="home-cli-strip__scan-command">
                <span className="home-cli-strip__scan-slash" aria-hidden="true">/</span>
                <span>{command.slice(1)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Song-age filter commands sit directly under the station rows. */}
      <div className="home-cli-strip__tier-rail" aria-label="Song age filters">
        <div className="home-cli-strip__tier-row" role="group" aria-label="Song age">
          {AGE_TIER_DEFINITIONS.map(({ tier, command, title }) => {
            const active = activeTiers.has(tier);
            return (
              <button
                key={tier}
                type="button"
                className={`home-cli-strip__tier-chip${active ? " home-cli-strip__tier-chip--active" : ""}`}
                aria-pressed={active}
                title={title}
                onClick={() => onToggleTier(tier)}
              >
                <span className="home-cli-strip__tier-command">{command}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Station-category filter commands complete the three filter rows. */}
      <div className="home-cli-strip__category-rail" aria-label="Station category filters">
        <div className="home-cli-strip__category-row" role="group" aria-label="Station categories">
          {STATION_CATEGORY_DEFINITIONS.map(({ cat, command, title }) => {
            const active = activeCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                className={`home-cli-strip__category-chip${active ? " home-cli-strip__category-chip--active" : ""}`}
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

      {/* The CLI seam itself */}
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

      {/* Stack-side: primary add-artists affordance extends up from the Stack */}
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
