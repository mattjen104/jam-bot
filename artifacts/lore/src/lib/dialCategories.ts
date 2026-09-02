/**
 * Station-category metadata shared by the filter bar, CLI, and SplitHome
 * command chips. Keep the command order here aligned with the listener-facing
 * category order.
 *
 * The seven categories form a mutually exclusive editorial taxonomy — each
 * curated station has exactly one primary category, assigned server-side by
 * `deriveStationCategories` with the precedence:
 *   Ambient > Campus > Specialist > Core > Public & Community >
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
  command: `/${string}`;
  label: string;
  /**
   * Short listener-facing label used by the home category tab strip and its
   * overview cards. The full `label` stays on the /feed filter surfaces.
   */
  shortLabel: string;
  title: string;
}[] = [
  { cat: "ambient",    command: "/ambient",    label: "Ambient",            shortLabel: "Ambient",    title: "Ambient, drone, and atmospheric music" },
  { cat: "campus",     command: "/campus",     label: "Campus Radio",       shortLabel: "Campus",     title: "College and university-operated stations" },
  { cat: "specialist", command: "/specialist", label: "Specialist Radio",   shortLabel: "Specialist", title: "Genre, era, and format-focused channels — FIP Jazz, FIP Electro, decade radio" },
  { cat: "anchor",     command: "/core",       label: "Core Stations",      shortLabel: "Core",       title: "Lore flagships — KEXP, WFMU, NTS, FIP, KCRW, WWOZ, KUTX, BBC 6 Music, Radio AlHara, and KCHUNG" },
  { cat: "public",     command: "/public",     label: "Public & Community", shortLabel: "Public",     title: "Non-campus terrestrial and nonprofit stations with local programming — KCRW, WBGO, WDIY" },
  { cat: "indie",      command: "/indie",      label: "Independent DJ",     shortLabel: "Indie",      title: "Web-native DJ and selector stations — Worldwide FM, Refuge Worldwide, Balamii, The Lot Radio" },
  { cat: "discovery",  command: "/discovery",  label: "Discovery",          shortLabel: "Discovery",  title: "Long-tail stations that don't fit a stronger editorial category" },
];

/**
 * The short tab/card label for an editorial category. Falls back to the raw
 * key so a future category can never render blank.
 */
export function stationCategoryShortLabel(cat: StationCategory): string {
  return STATION_CATEGORY_DEFINITIONS.find((definition) => definition.cat === cat)?.shortLabel
    ?? cat;
}

/**
 * Best-effort mapping from free-form Radio Browser tags to Lore's editorial
 * categories, used ONLY for listener-pinned personal stations (which have no
 * server-derived `stationCategories`). Follows the same precedence as the
 * server taxonomy — the first matching rule wins and a station gets at most
 * one category, keeping the taxonomy mutually exclusive.
 *
 * The internal "anchor" key is retained for saved-filter/API compatibility;
 * its listener-facing name is Core. It is intentionally never assigned
 * derivable from tags) and "discovery" is not used as a fallback: a personal
 * station whose tags match nothing gets [] and appears only when no category
 * filter is active.
 */
const TAG_CATEGORY_RULES: readonly (readonly [StationCategory, RegExp])[] = [
  ["ambient", /ambient|drone|downtempo|chill\s?out|lounge|new age/i],
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
