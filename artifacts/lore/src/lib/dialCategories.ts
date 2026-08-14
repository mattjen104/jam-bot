/**
 * Station-category metadata shared by the filter bar, CLI, and SplitHome
 * command chips. Keep the command order here aligned with the listener-facing
 * category order.
 */

export type StationCategory =
  | "lore"
  | "classics"
  | "ambient"
  | "spinitron"
  | "college"
  | "longtail";

export const STATION_CATEGORY_DEFINITIONS: {
  cat: StationCategory;
  command: `/${StationCategory}`;
  label: string;
  title: string;
}[] = [
  { cat: "lore",      command: "/lore",      label: "Lore",      title: "The normal curated Dial" },
  { cat: "classics",  command: "/classics",  label: "Classics",  title: "Era/genre stations — decade radio, oldies, genre channels" },
  { cat: "ambient",   command: "/ambient",   label: "Ambient",   title: "Sleep, nature, and ambient stations" },
  { cat: "spinitron", command: "/spinitron", label: "Spinitron", title: "Stations that use Spinitron for now-playing data" },
  { cat: "college",   command: "/college",   label: "College",   title: "Confirmed campus and college radio stations" },
  { cat: "longtail",  command: "/longtail",  label: "Long-tail", title: "Radio Browser and other long-tail community stations" },
];