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
