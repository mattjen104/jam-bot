/**
 * railContent — pure emptiness test for the tuned context region.
 *
 * The tuned front door should be QUIET when everything the context region
 * would show is placeholder filler: no lens frame open, live edge, no recent
 * spins, no loaded sets, and a summary sentence that would collapse to the
 * bare "On air." with no usable show name. DialView uses this to suppress
 * the breadcrumb strip (leaving a minimal back affordance) and the rail's
 * reserved space; ContextRail applies the same rules internally.
 *
 * Kept OUT of ContextRail.tsx on purpose: that module is widely mocked in
 * tests, and DialView needs this helper even when the rail is mocked away.
 */
import type { ContextDescriptor } from "./dialContext";
import { radioSummarySentence, usableShowName } from "./grammar";
import type { DialShow, DialStation, DialDisplayMode } from "../hooks/useDialData";

export interface RailContentSet {
  stationSlug: string;
}

export function railHasRealContent({
  ctx,
  row,
  sets,
  displayMode = "personal",
}: {
  ctx: ContextDescriptor;
  row: { ds: DialStation; show: DialShow | null } | null;
  sets: readonly RailContentSet[];
  displayMode?: DialDisplayMode;
}): boolean {
  // A drilled lens frame or a scrubbed-past position is always real content.
  if (ctx.stack.length > 1) return true;
  if (ctx.temporal.kind === "past") return true;
  // Recent spins feed the station lens.
  if ((row?.show?.spins.length ?? 0) > 0) return true;
  // Loaded sets for this station feed the station lens fallback list.
  const slug = ctx.stack[0]?.kind === "station" ? ctx.stack[0].id : null;
  if (sets.some((set) => slug == null || set.stationSlug === slug)) return true;
  if (!row) return false;
  // A usable show name keeps the attribution line meaningful.
  if (usableShowName(row.show ?? null)) return true;
  // Finally: would the sentence carry any artist or DJ?
  const summary = radioSummarySentence({
    stationName: row.ds.station.name,
    show: row.show ?? null,
    displayMode,
  });
  return summary.artistsShown.length > 0 || summary.djShown != null;
}
