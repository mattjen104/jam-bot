/**
 * StackPagerBar — the pinned footer strip of the SplitHome layout, sitting
 * below the Stack band (and above the player dock / bottom shell).
 *
 * Mirrors the Dial's compact scan remote in the middle seam, but pages the
 * Stack: numeric page selectors (one per five-album window of the library),
 * a Shuffle button that samples random albums from the current page, and a
 * Shuffle all button that random-walks the whole library. An active shuffle
 * turns its button into a Stop control.
 */

import type { ShuffleMode } from "../hooks/useCompactStackShuffle";

export interface StackPagerBarProps {
  /** Zero-based offset of the visible five-album page (multiple of 5). */
  stackOffset: number;
  /** Number of stack pages (library album groups / 5, min 1). */
  stackPageCount: number;
  /** Total album groups in the library (drives the Shuffle disabled state). */
  totalGroups: number;
  /**
   * Per-page primary label: the album title of the FIRST album in each
   * five-album window (index i ↔ page i+1), so the pager reads as music
   * ("Rumours", "Blue Lines"…) instead of bare numbers. Null/absent entries
   * fall back to the numeric page label. The accessible label keeps the
   * page number and adds the window's album count ("…, +2 more").
   */
  pageLabels?: (string | null)[];
  /** Active shuffle: "page" = current page, "all" = whole library, null = off. */
  shuffleMode: ShuffleMode;
  /** Called when the user selects a page (offset = (page - 1) * 5). */
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
  shuffleMode,
  onSelectStackPage,
  onShufflePage,
  onShuffleAll,
}: StackPagerBarProps) {
  const currentPage = Math.floor(stackOffset / 5); // 0-based page index

  return (
    <div className="stack-pager-bar">
      {/* Same bounded, horizontally scrollable rail as the CLI seam's filter
          rows — without it a long page list would overflow the viewport on
          narrow screens and strand the later stack pages. */}
      <div className="home-cli-strip__filter-rail stack-pager-bar__rail">
      <div className="home-cli-strip__filter-row home-cli-strip__scan-remote" role="group" aria-label="Stack pages">
        {/* Compact numeric page selectors — identical styling to the Dial's. */}
        <div className="home-cli-strip__page-selectors" role="group" aria-label="Stack page">
          {Array.from({ length: Math.max(1, stackPageCount) }, (_, i) => {
            const isCurrentPage = currentPage === i;
            const album = pageLabels?.[i] ?? null;
            // Albums in this window (the last page may be short) — the
            // accessible label carries the "+N more" count so two pages
            // opening with the same album title stay unambiguous.
            const windowCount = Math.min(5, Math.max(0, totalGroups - i * 5));
            const ariaLabel = album
              ? `stack page ${i + 1}: ${album}${windowCount > 1 ? `, +${windowCount - 1} more` : ""}`
              : `stack page ${i + 1}`;
            return (
              <button
                key={i}
                type="button"
                className={`home-cli-strip__page-btn${album ? " home-cli-strip__page-btn--album" : ""}${isCurrentPage ? " home-cli-strip__page-btn--active" : ""}`}
                aria-pressed={isCurrentPage}
                aria-label={ariaLabel}
                title={album ? ariaLabel : undefined}
                onClick={() => onSelectStackPage(i * 5)}
              >
                {album ?? i + 1}
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
