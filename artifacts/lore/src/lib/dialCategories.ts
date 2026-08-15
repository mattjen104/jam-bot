/**
 * Station-category metadata shared by the filter bar, CLI, and SplitHome
 * command chips. Keep the command order here aligned with the listener-facing
 * category order.
 */

export type StationCategory =
  | "lore"
  | "genre"
  | "ambient"
  | "spinitron"
  | "college"
  | "flagship"
  | "discovery";

export const STATION_CATEGORY_DEFINITIONS: {
  cat: StationCategory;
  command: `/${StationCategory}`;
  label: string;
  title: string;
}[] = [
  { cat: "lore",      command: "/lore",      label: "Lore",      title: "The normal curated Dial" },
  { cat: "genre",     command: "/genre",     label: "Genre",     title: "Era/genre stations — decade radio, oldies, genre channels" },
  { cat: "ambient",   command: "/ambient",   label: "Ambient",   title: "Sleep, nature, and ambient stations" },
  { cat: "spinitron", command: "/spinitron", label: "Spinitron", title: "Stations that use Spinitron for now-playing data" },
  { cat: "college",   command: "/college",   label: "College",   title: "Confirmed campus and college radio stations" },
  { cat: "flagship",  command: "/flagship",  label: "Flagship",  title: "The anchor stations — KEXP, NTS, BBC 6 Music, FIP, Dublab, Rinse FM, and friends" },
  { cat: "discovery", command: "/discovery", label: "Discovery", title: "Radio Browser and other long-tail community stations" },
];
