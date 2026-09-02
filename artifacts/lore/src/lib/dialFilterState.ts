/**
 * dialFilterState — pure toggle semantics for the Dial's filter dropdowns.
 *
 * All three filter families share the same additive shape:
 *   - Age tiers (First | Current | Catalog | Deep): additive multi-select;
 *     any subset, including empty (empty = no age filtering).
 *   - Station categories (Ambient | Campus | …): additive
 *     multi-select; checked categories are unioned. Empty = all stations.
 *   - Crossings: a single boolean (crossings mode on = crossing-ranked feed,
 *     off = blank radio mode). Callers keep it as the inverse of their
 *     radioMode state (see dialRadioMode.ts) — DialView and SplitHome wire
 *     the dropdown's "Crossings on" checkbox to setRadioMode(!on).
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

/** Initial browse scope shown by both the home remote and full Dial. */
export const DEFAULT_ACTIVE_AGE_TIERS: ReadonlySet<AgeTier> = new Set([
  "first",
  "current",
  "catalog",
  "deep",
]);

/** Normal radio defaults; Ambient stays an explicit opt-in category. */
export const DEFAULT_ACTIVE_STATION_CATEGORIES: ReadonlySet<StationCategory> = new Set([
  "anchor",
  "campus",
  "public",
]);

/** Toggle an age tier: plain additive toggle, empty set allowed. */
export function toggleAgeTier(prev: ReadonlySet<AgeTier>, tier: AgeTier): Set<AgeTier> {
  const next = new Set(prev);
  if (next.has(tier)) next.delete(tier);
  else next.add(tier);
  return next;
}

/**
 * Plain additive toggle for station categories: checking a category adds it
 * to the set, unchecking removes it. Any subset is valid — the empty set
 * means "all stations" (no category filtering), and multiple checked
 * categories are unioned by useDialData before display.
 */
export function toggleStationCategory(
  prev: ReadonlySet<StationCategory>,
  cat: StationCategory,
): Set<StationCategory> {
  const next = new Set(prev);
  if (next.has(cat)) next.delete(cat);
  else next.add(cat);
  return next;
}

/** Toggle the crossings-mode boolean (on = crossing-ranked feed). */
export function toggleCrossings(prev: boolean): boolean {
  return !prev;
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

// ---------------------------------------------------------------------------
// Per-album Stack skip preference (compact Stack on the front door)
// ---------------------------------------------------------------------------

const LS_STACK_SKIPPED_KEY = "lore:stackSkipped";

function readStackSkipped(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_STACK_SKIPPED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeStackSkipped(keys: Set<string>): void {
  try {
    localStorage.setItem(LS_STACK_SKIPPED_KEY, JSON.stringify([...keys]));
  } catch {
    // localStorage unavailable — preference won't survive a reload.
  }
}

/**
 * Hook: per-album Stack-skip preference, backed by localStorage. Keys are
 * AlbumGroup.key strings (`albumTitle\x1fartist`). Skipped albums drop out of
 * the compact Stack's five-slot active window into a below-fold overflow
 * region — the Stack-side counterpart of useDialSkipped.
 *
 * Returns:
 *   skipped   — current set of skipped album-group keys
 *   toggleSkip(key) — add/remove a key from the skipped set
 *   isSkipped(key) — predicate helper
 */
export function useStackSkipped() {
  const [skipped, setSkipped] = useState<Set<string>>(() => readStackSkipped());

  const toggleSkip = useCallback((key: string) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeStackSkipped(next);
      return next;
    });
  }, []);

  const isSkipped = useCallback(
    (key: string) => skipped.has(key),
    [skipped],
  );

  return { skipped, toggleSkip, isSkipped };
}
