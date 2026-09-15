import type { Station } from "@workspace/api-client-react";
import {
  categoryForTags,
  stationCategoryShortLabel,
  type StationCategory,
} from "./dialCategories";
import {
  specialistSubcategoryForStation,
  specialistSubcategoryLabel,
} from "./specialistCategories";

const STATION_CATEGORIES = new Set<StationCategory>([
  "ambient",
  "campus",
  "specialist",
  "anchor",
  "public",
  "indie",
  "discovery",
]);

const CURATION_SENTENCES = new Map<string, string>([
  ["kexp", "Seattle tastemaker championing independent artists through adventurous programming and landmark live sessions."],
  ["nts-1", "London-born radio connecting experimental electronic music with underground sounds from around the world."],
  ["nts-2", "The second NTS channel, extending its global network of resident DJs and genre-defying selectors."],
  ["kcrw-eclectic24", "Los Angeles tastemaker mixing independent discoveries, alternative music, and emerging West Coast voices."],
  ["rinse-fm", "London authority on underground electronic music, grime, and the evolving UK club continuum."],
  ["amazing-radio", "Independent internet station devoted to new and emerging artists from the UK and beyond."],
  ["glacer-fm", "Global internet station giving unsigned artists a dedicated home across a wide range of genres."],
  ["the-lot-radio", "Independent Brooklyn station broadcasting a continuous schedule of underground guest DJs."],
  ["radio-k", "Student-run Minneapolis station bringing eclectic independent music to the Twin Cities campus scene."],
  ["fbi-radio", "Sydney non-profit station championing emerging local music, arts, and culture."],
  ["cjlo", "Volunteer-run Montréal campus station ranging across independent rock, hip-hop, metal, jazz, and global sounds."],
  ["cfuv", "Victoria campus and community station giving adventurous music and local voices room to be heard."],
  ["soho-radio", "Independent London station giving its hosts free rein across music, culture, and the city’s creative scenes."],
  ["voices-radio", "London community station combining wide-ranging music with discussion, politics, and activism."],
  ["kool-fm", "The foundational London channel going deep on jungle, drum and bass, and UK breakbeat culture."],
  ["balamii", "London-born platform spotlighting underground talent through DJ sets, rap cyphers, and live performances."],
  ["rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631", "Palestinian online station carrying community-curated music and talk from Bethlehem to a global audience."],
  ["wwoz", "Volunteer-powered New Orleans radio devoted to the city’s musical culture."],
  ["wfmu", "Listener-supported freeform radio built around independent programmer voices."],
  ["dublab", "A non-profit Los Angeles station supporting adventurous music and creative culture."],
  ["worldwide-fm", "Global music radio connecting scenes and selectors across borders."],
  ["xray-fm", "Portland community radio made by local hosts, musicians, and advocates."],
  ["wxyc", "Student-run freeform radio from the University of North Carolina."],
  ["wruw", "Student and community programmers broadcasting from Case Western Reserve University."],
  ["kuvo", "Denver community radio centered on jazz, culture, and local voices."],
]);

export function stationTypeLabel(station: Station): string {
  const supplied = station.stationCategories?.[0];
  const category = supplied && STATION_CATEGORIES.has(supplied as StationCategory)
    ? supplied as StationCategory
    : categoryForTags(station.tags ?? [])[0];

  if (category === "specialist") {
    return specialistSubcategoryLabel(specialistSubcategoryForStation(station));
  }
  return category ? stationCategoryShortLabel(category) : "Station";
}

export function stationLocationAndType(station: Station): string {
  const location = station.city?.trim() || "Location unavailable";
  return `${location} · ${stationTypeLabel(station)}`;
}

export function curatedStationTypeLabel(station: Station): string | null {
  const supplied = station.stationCategories?.[0];
  if (!supplied || !STATION_CATEGORIES.has(supplied as StationCategory)) return null;
  const category = supplied as StationCategory;
  return category === "specialist"
    ? specialistSubcategoryLabel(specialistSubcategoryForStation(station))
    : stationCategoryShortLabel(category);
}

export function stationCardMetadata(station: Station): string | null {
  const parts = [
    station.city?.trim() || null,
    curatedStationTypeLabel(station),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function stationCardSecondarySentence(station: Station): string | null {
  const city = station.city?.trim() || null;
  const region = station.region?.trim() || null;
  const country = station.country?.trim() || null;
  const location = city
    ? [city, region || country].filter(Boolean).join(", ")
    : region || country;
  const type = curatedStationTypeLabel(station);

  if (location && type) return `${type} radio from ${location}.`;
  if (location) return `Broadcasting from ${location}.`;
  if (type) return `${type} radio.`;
  return null;
}

export function stationCurationSentence(station: Station): string {
  const reviewedOrScrapedSummary = station.homepageBlurb?.trim();
  if (reviewedOrScrapedSummary) return reviewedOrScrapedSummary;

  const explicit = CURATION_SENTENCES.get(station.slug);
  if (explicit) return explicit;
  if (station.slug.startsWith("somafm-")) {
    return "Listener-supported internet radio going deep on a distinctive corner of independent music.";
  }

  const type = stationTypeLabel(station).toLocaleLowerCase();
  const descriptiveTags = (station.tags ?? [])
    .filter((tag) => !["anchor", "public", "indie", "campus", "specialist", "discovery"].includes(tag))
    .slice(0, 2);
  const focus = descriptiveTags.length > 0
    ? descriptiveTags.join(" and ")
    : "distinctive music";
  const location = station.city?.trim() || station.region?.trim() || station.country?.trim();
  return `A ${type} station selected for its ${focus} programming${location ? ` from ${location}` : ""}.`;
}