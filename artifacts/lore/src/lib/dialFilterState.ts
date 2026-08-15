/**
 * dialFilterState — pure set-toggle semantics for the Dial's filter menus.
 *
 * The two menus have different semantics:
 *   - Age tiers (First | Current | Catalog | Deep): additive multi-select;
 *     any subset, including empty (empty = no age filtering).
 *   - Station categories (Ambient & Sleep | Campus | …): radio-style
 *     single-select — at most one category is active. The dial starts with
 *     no category selected (unfiltered); once a category is picked, selecting
 *     a new one replaces it and re-selecting the active one keeps it active,
 *     so a selection can never return to the empty state.
 *
 * Kept out of DialView so the rules are unit-testable without the component
 * tree. DialView owns the useState; these produce the next set (returning the
 * SAME reference when nothing changes, so React can skip the re-render).
 */
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
 * replaces whatever was active before, so exactly one category is ever
 * active. Re-selecting the already-active category is a no-op (returns
 * `prev` unchanged, same reference, so React can skip the re-render) — there
 * is no empty state.
 */
export function toggleStationCategory(
  prev: Set<StationCategory>,
  cat: StationCategory,
): Set<StationCategory> {
  if (prev.has(cat) && prev.size === 1) return prev;
  return new Set([cat]);
}
