/**
 * dialFilterState — pure set-toggle semantics for the Dial's filter menus.
 *
 * The two menus have different semantics:
 *   - Age tiers (First | Current | Catalog | Deep): additive multi-select;
 *     any subset, including empty (empty = no age filtering).
 *   - Station categories (Ambient & Sleep | Campus | …): radio-style
 *     single-select — at most one category is active. The dial starts with
 *     no category selected (unfiltered); once a category is picked, selecting
 *     a new one replaces it, and re-selecting the active one CLEARS it back
 *     to the empty (all-stations) state.
 *
 * Kept out of DialView so the rules are unit-testable without the component
 * tree. DialView owns the useState; these produce the next set (returning the
 * SAME reference when nothing changes, so React can skip the re-render).
 *
 * Per-station skip preference:
 *   useDialSkipped is a localStorage-backed hook that tracks which station
 *   slugs the listener has opted out of scanning. Skipped stations are sorted
 *   to the last scan page and excluded from Scan all / page scan. Stored
 *   under "lore:dialSkipped", parallel to "lore:dialPins".
 */
import { useState, useCallback } from "react";
import type { AgeTier } from "./dialAgeFilter";
import type { StationCategory } from "./dialCategories";

/** Toggle an age tier: plain additive toggle, empty set allowed. */
export function toggleAgeTier(prev: ReadonlySet<AgeTier>, tier: AgeTier): Set<AgeTier> {
  const next = new Set(prev);
  if (next.has(tier)) next.delete(tier);
  else next.add(tier);
  return next;
}

/**
 * Radio-style single-select for station categories: selecting a category
 * replaces whatever was active before (exactly one category active when
 * non-empty). Re-selecting the already-active category CLEARS it back to
 * the empty state so the listener can return to all-stations at any time.
 * Selecting a new category when one is already active replaces it.
 */
export function toggleStationCategory(
  prev: Set<StationCategory>,
  cat: StationCategory,
): Set<StationCategory> {
  // Re-select active → clear to empty (all stations)
  if (prev.has(cat) && prev.size === 1) return new Set();
  // Select new → replace
  return new Set([cat]);
}

// ---------------------------------------------------------------------------
// Per-station skip preference
// ---------------------------------------------------------------------------

const LS_SKIPPED_KEY = "lore:dialSkipped";

function readSkipped(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_SKIPPED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeSkipped(slugs: Set<string>): void {
  try {
    localStorage.setItem(LS_SKIPPED_KEY, JSON.stringify([...slugs]));
  } catch {
    // localStorage unavailable — preference won't survive a reload.
  }
}

/**
 * Hook: per-station scan-skip preference, backed by localStorage.
 *
 * Returns:
 *   skipped   — current set of skipped station slugs
 *   toggleSkip(slug) — add/remove a slug from the skipped set
 *   isSkipped(slug) — predicate helper
 */
export function useDialSkipped() {
  const [skipped, setSkipped] = useState<Set<string>>(() => readSkipped());

  const toggleSkip = useCallback((slug: string) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      writeSkipped(next);
      return next;
    });
  }, []);

  const isSkipped = useCallback(
    (slug: string) => skipped.has(slug),
    [skipped],
  );

  return { skipped, toggleSkip, isSkipped };
}
