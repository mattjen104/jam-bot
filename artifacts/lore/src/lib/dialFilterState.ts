/**
 * dialFilterState — pure set-toggle semantics for the Dial's filter menus.
 *
 * Both menus are additive multi-selects:
 *   - Age tiers (First | Current | Catalog | Deep): any subset, including
 *     empty (empty = no age filtering).
 *   - Station categories (Lore | Classics | Ambient): any subset EXCEPT
 *     empty — the last active category cannot be deselected, so the dial
 *     always has at least one station source.
 *
 * Kept out of DialView so the rules are unit-testable without the component
 * tree. DialView owns the useState; these produce the next set (returning the
 * SAME reference when nothing changes, so React can skip the re-render).
 */
import type { AgeTier } from "./dialAgeFilter";
import type { StationCategory } from "../components/dial/DialFilterBar";

/** Toggle an age tier: plain additive toggle, empty set allowed. */
export function toggleAgeTier(prev: ReadonlySet<AgeTier>, tier: AgeTier): Set<AgeTier> {
  const next = new Set(prev);
  if (next.has(tier)) next.delete(tier);
  else next.add(tier);
  return next;
}

/**
 * Toggle a station category with last-category protection: deselecting the
 * only active category is a no-op (returns `prev` unchanged, same reference).
 */
export function toggleStationCategory(
  prev: Set<StationCategory>,
  cat: StationCategory,
): Set<StationCategory> {
  if (prev.has(cat) && prev.size === 1) return prev;
  const next = new Set(prev);
  if (next.has(cat)) next.delete(cat);
  else next.add(cat);
  return next;
}
