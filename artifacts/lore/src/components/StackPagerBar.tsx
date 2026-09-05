/**
 * StackPagerBar — the pinned footer strip of the SplitHome layout, sitting
 * below the Stack band (and above the player dock / bottom shell).
 *
 * Mirrors the Dial's compact scan remote in the middle seam, but pages the
 * Stack: a live album count, a density cycle key (5 / 10 / 15 rows per
 * page), page selectors labeled by each window's first album (numeric
 * fallback), a Shuffle button that samples random albums from the current
 * page, and a Shuffle all button that random-walks the whole library. An
 * active shuffle turns its button into a Stop control.
 *
 * Behind the controls sits a thin decorative backdrop: the cover art of the
 * first album on the current page, darkened and blurred so the buttons stay
 * clearly readable. When the page changes the art crossfades to the next
 * album's cover (suppressed under prefers-reduced-motion).
 */

import type { ShuffleMode } from "../hooks/useCompactStackShuffle";
import {
  nextStackDensity,
  stackPageSize,
  type StackDensity,
} from "../lib/stackDensityState";

export interface StackPagerBarProps {
  /** Zero-based offset of the visible album page (multiple of the density's page size). */
  stackOffset: number;
  /** Number of stack pages (library album groups / page size, min 1). */
  stackPageCount: number;
  /** Total album groups in the library (drives the count label + Shuffle disabled state). */
  totalGroups: number;
  /**
   * Per-page primary label: the album title of the FIRST album in each
   * page-sized window (index i ↔ page i+1), so the pager reads as music
   * ("Rumours", "Blue Lines"…) instead of bare numbers. Null/absent entries
   * fall back to the numeric page label. The accessible label keeps the
   * page number and adds the window's album count ("…, +2 more").
   */
  pageLabels?: (string | null)[];
  /** Stack band display density: normal = 5 rows, compact = 10, micro = 15. */
  stackDensity: StackDensity;
  /** Cycles the density: normal → compact → micro → normal. */
  onCycleStackDensity: () => void;
  /**
   * Cover art of the first album on the current page — rendered as a
   * darkened, blurred decorative backdrop behind the bar's controls. Null =
   * no backdrop.
   */
  firstPageArtUrl?: string | null;
  /** Active shuffle: "page" = current page, "all" = whole library, null = off. */
  shuffleMode: ShuffleMode;
  /** Called when the user selects a page (offset = (page - 1) * page size). */
  onSelectStackPage: (offset: number) => void;
  /** Toggles the page shuffle. */
  onShufflePage: () => void;
  /** Toggles the library-wide shuffle. */
  onShuffleAll: () => void;
}

export function StackPagerBar({
  stackOffset,
  stackPageCount,
  totalGroups,
  pageLabels,
  stackDensity,
  onCycleStackDensity,
  firstPageArtUrl = null,
  shuffleMode,
  onSelectStackPage,
  onShufflePage,
  onShuffleAll,
}: StackPagerBarProps) {
  // Page math follows the density: 5-row pages in normal, 10 in compact,
  // 15 in micro.
  const pageSize = stackPageSize(stackDensity);
  const currentPage = Math.floor(stackOffset / pageSize); // 0-based page index
  const nextDensity = nextStackDensity(stackDensity);

  return (
    <div className="stack-pager-bar">
      {/* Decorative album-art backdrop: the first visible album's cover,
          darkened + blurred so the controls above it stay readable. */}
      {firstPageArtUrl && (
        <img
          key={firstPageArtUrl}
          className="stack-pager-bar__backdrop-art"
          src={firstPageArtUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      {/* Same bounded, horizontally scrollable rail as the CLI seam's filter
          rows — without it a long page list would overflow the viewport on
          narrow screens and strand the later stack pages. */}
      <div className="home-cli-strip__filter-rail stack-pager-bar__rail">
      <div className="home-cli-strip__filter-row home-cli-strip__scan-remote" role="group" aria-label="Library pages">
        {/* Always-visible count of albums in the Stack window's scope */}
        <span className="home-cli-strip__station-count">
          {totalGroups} {totalGroups === 1 ? "album" : "albums"}
        </span>
        {/* Density cycle key: 5 rows → 10 rows → 15 rows */}
        <button
          type="button"
          className="home-cli-strip__filter-chip home-cli-strip__density-btn"
          aria-label={`density ${stackPageSize(stackDensity)} rows — switch to ${stackPageSize(nextDensity)}`}
          title={`Showing ${stackPageSize(stackDensity)} rows — tap for ${stackPageSize(nextDensity)}`}
          onClick={onCycleStackDensity}
        >
          {stackPageSize(stackDensity)}
        </button>
        {/* Page selectors — always numeric like the Dial's page controls.
            Album labels remain available in the accessible name and tooltip
            so they add context without replacing the page number visually. */}
        <div className="home-cli-strip__page-selectors" role="group" aria-label="Library page">
          {Array.from({ length: Math.max(1, stackPageCount) }, (_, i) => {
            const isCurrentPage = currentPage === i;
            const album = pageLabels?.[i] ?? null;
            // Albums in this window (the last page may be short) — the
            // accessible label carries the "+N more" count so two pages
            // opening with the same album title stay unambiguous.
            const windowCount = Math.min(pageSize, Math.max(0, totalGroups - i * pageSize));
            const ariaLabel = album
              ? `library page ${i + 1}: ${album}${windowCount > 1 ? `, +${windowCount - 1} more` : ""}`
              : `library page ${i + 1}`;
            return (
              <button
                key={i}
                type="button"
                className={`home-cli-strip__page-btn${isCurrentPage ? " home-cli-strip__page-btn--active" : ""}`}
                aria-pressed={isCurrentPage}
                aria-label={ariaLabel}
                title={album ? ariaLabel : undefined}
                onClick={() => onSelectStackPage(i * pageSize)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        {/* Shuffle (page) button */}
        <button
          type="button"
          className={`home-cli-strip__filter-chip home-cli-strip__scan-btn${shuffleMode === "page" ? " home-cli-strip__scan-btn--active" : ""}`}
          aria-pressed={shuffleMode === "page"}
          aria-label={shuffleMode === "page" ? "stop shuffle" : "shuffle this page"}
          disabled={totalGroups === 0}
          onClick={onShufflePage}
        >
          {shuffleMode === "page" ? "Stop" : "Shuffle"}
        </button>
        {/* Shuffle all button */}
        <button
          type="button"
          className={`home-cli-strip__filter-chip home-cli-strip__scan-btn home-cli-strip__scan-all-btn${shuffleMode === "all" ? " home-cli-strip__scan-btn--active" : ""}`}
          aria-pressed={shuffleMode === "all"}
          aria-label={shuffleMode === "all" ? "stop shuffle all" : "shuffle all albums"}
          disabled={totalGroups === 0}
          onClick={onShuffleAll}
        >
          {shuffleMode === "all" ? "Stop" : "Shuffle all"}
        </button>
      </div>
      </div>
    </div>
  );
}
