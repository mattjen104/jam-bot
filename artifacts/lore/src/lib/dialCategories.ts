/**
 * Station-category metadata shared by the filter bar, CLI, and SplitHome
 * command chips. Keep the command order here aligned with the listener-facing
 * category order.
 *
 * The seven categories form a mutually exclusive editorial taxonomy — each
 * curated station has exactly one primary category, assigned server-side by
 * `deriveStationCategories` with the precedence:
 *   Ambient > Campus > Specialist > Anchor > Public & Community >
 *   Independent DJ > Discovery
 *
 * The category filter is an additive multi-select: any subset of categories
 * may be checked, checked categories are unioned, and the empty set means
 * "all stations". The `/lore` home command is NOT a category — it stays
 * wired separately in DialCliBar and HomeCliStrip.
 */

export type StationCategory =
  | "ambient"
  | "campus"
  | "specialist"
  | "anchor"
  | "public"
  | "indie"
  | "discovery";

export const STATION_CATEGORY_DEFINITIONS: {
  cat: StationCategory;
  command: `/${StationCategory}`;
  label: string;
  title: string;
}[] = [
  { cat: "ambient",    command: "/ambient",    label: "Ambient & Sleep",    title: "Sleep, nature, drone, and white-noise utility channels" },
  { cat: "campus",     command: "/campus",     label: "Campus Radio",       title: "College and university-operated stations" },
  { cat: "specialist", command: "/specialist", label: "Specialist Radio",   title: "Genre, era, and format-focused channels — FIP Jazz, FIP Electro, decade radio" },
  { cat: "anchor",     command: "/anchor",     label: "Anchor Stations",    title: "Broadly-programmed flagship stations — KEXP, NTS, BBC 6 Music, FIP, Dublab, Rinse FM" },
  { cat: "public",     command: "/public",     label: "Public & Community", title: "Non-campus terrestrial and nonprofit stations with local programming — KCRW, WBGO, WDIY" },
  { cat: "indie",      command: "/indie",      label: "Independent DJ",     title: "Web-native DJ and selector stations — Worldwide FM, Refuge Worldwide, Balamii, The Lot Radio" },
  { cat: "discovery",  command: "/discovery",  label: "Discovery",          title: "Long-tail stations that don't fit a stronger editorial category" },
];

/**
 * Best-effort mapping from free-form Radio Browser tags to Lore's editorial
 * categories, used ONLY for listener-pinned personal stations (which have no
 * server-derived `stationCategories`). Follows the same precedence as the
 * server taxonomy — the first matching rule wins and a station gets at most
 * one category, keeping the taxonomy mutually exclusive.
 *
 * "anchor" is intentionally never assigned (anchor status is editorial, not
 * derivable from tags) and "discovery" is not used as a fallback: a personal
 * station whose tags match nothing gets [] and appears only when no category
 * filter is active.
 */
const TAG_CATEGORY_RULES: readonly (readonly [StationCategory, RegExp])[] = [
  ["ambient", /ambient|sleep|drone|nature|white[\s-]?noise|meditat|relax|downtempo|chill\s?out|lounge|new age/i],
  ["campus", /college|campus|universit|student|educational|school/i],
  ["specialist", /jazz|classical|opera|blues|country|bluegrass|folk|metal|reggae|soul|funk|disco|techno|house|trance|electronic|edm|dance|hip[\s-]?hop|\brap\b|punk|goth|industrial|gospel|latin|salsa|ska|\brock\b|\bpop\b|oldies|retro|decade|\b\d{2}'?s\b|soundtrack|swing|r\s*&\s*b|\brnb\b|world music|afrobeat|schlager/i],
  ["public", /public radio|community|non[\s-]?profit|\bnpr\b|\btalk\b|news|speech|spoken/i],
  ["indie", /\bdj\b|selector|underground|freeform|eclectic|webradio|web radio|internet radio|online radio|independent/i],
];

/**
 * Map Radio Browser tags to at most one editorial category. Tags are
 * normalized to lowercase and probed in taxonomy-precedence order.
 */
export function categoryForTags(tags: readonly string[]): StationCategory[] {
  if (tags.length === 0) return [];
  const haystack = tags.map((t) => t.toLowerCase()).join(" · ");
  for (const [cat, re] of TAG_CATEGORY_RULES) {
    if (re.test(haystack)) return [cat];
  }
  return [];
}
