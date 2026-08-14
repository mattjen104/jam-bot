/**
 * HomeCliStrip — the CLI seam of the SplitHome three-band layout.
 *
 * Structure (top → bottom):
 *   1. Dial-side scan buttons — `scan 1 /scan1` … `scan 3 /scan3`, hanging
 *      down from the Dial band. The active scan window renders filled.
 *   2. The DialCliBar (strip variant) — a single-line input with a `/lore`
 *      Signifier ghost placeholder. All slash commands work here.
 *   3. Stack-side buttons — `add artists /add` (focuses the input and inserts
 *      the `/add ` prefix) and `library /library` (navigates to the Stack),
 *      extending up from the Stack band.
 *
 * Every button is labeled with its CLI equivalent so the affordance is
 * self-documenting for power users.
 */

import { useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DialCliBar, type DialCliBarProps } from "./dial/DialCliBar";

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
}

export function HomeCliStrip({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  scanOffset,
  onScan,
  onAddArtists,
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
          inputRef={inputRef}
          prefill={prefill}
        />
      </div>

      {/* Stack-side: primary add-artists affordance extends up from the Stack */}
      <div className="home-cli-strip__row home-cli-strip__row--stack">
        <button
          type="button"
          className="home-cli-strip__btn home-cli-strip__btn--primary"
          aria-label="Add artists"
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
