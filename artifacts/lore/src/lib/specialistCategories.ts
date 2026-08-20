import type { Station } from "@workspace/api-client-react";

export type SpecialistSubcategory =
  | "ambient"
  | "folk"
  | "rock"
  | "jazz"
  | "era"
  | "world"
  | "electronic"
  | "groove"
  | "classical"
  | "other";

export interface SpecialistSubcategoryDefinition {
  id: SpecialistSubcategory;
  label: string;
}

export const SPECIALIST_SUBCATEGORY_DEFINITIONS: readonly SpecialistSubcategoryDefinition[] = [
  { id: "ambient", label: "Ambient / Chillout / Lounge" },
  { id: "folk", label: "Folk / Country / Celtic" },
  { id: "rock", label: "Rock / Metal / Punk" },
  { id: "jazz", label: "Jazz / Blues" },
  { id: "era", label: "Era / Retro / Oldies" },
  { id: "world", label: "World / Latin / Reggae" },
  { id: "electronic", label: "Electronic / Dance" },
  { id: "groove", label: "Groove / Soul / Funk" },
  { id: "classical", label: "Classical" },
  { id: "other", label: "Other specialist sounds" },
];

// Matching priority intentionally differs from display order. Radio Browser
// tags overlap heavily: club stations frequently carry ambient/lounge tags,
// while decade stations frequently carry rock tags. More specific genre and
// era signals must therefore win before the broad ambient fallback.
const RULES: readonly [SpecialistSubcategory, RegExp][] = [
  ["classical", /classical|baroque|opera|orchestra|symphony/i],
  ["jazz", /jazz|blues/i],
  ["folk", /folk|country|celtic|americana|bluegrass|acoustic/i],
  ["era", /50s|50er|60s|60er|70s|70er|80s|80er|90s|90er|00s|2000s|oldies|retro|new wave|synthpop|disco|schlager|gold|kult/i],
  ["world", /reggae|ska|dancehall|soca|salsa|bachata|merengue|latin|world|afric|arab|balkan|asian|k-pop|kpop|bollywood|desi/i],
  ["groove", /groove|soul|funk|motown|r&b|rnb/i],
  ["electronic", /techno|house|trance|electro|edm|electronic|dance|club|rave|hardstyle|dubstep|goa|psytrance|drum.?n.?bass/i],
  ["rock", /metal|punk|hardcore|grunge|alternative|progressive rock|rock/i],
  ["ambient", /ambient|chill\s?out|lounge|relax|meditat|sleep|downtempo|easy listening|drone/i],
];

export function specialistSubcategoryForStation(station: Station): SpecialistSubcategory {
  const haystack = `${station.name} ${(station.tags ?? []).join(" ")}`;
  for (const [id, rule] of RULES) {
    if (rule.test(haystack)) return id;
  }
  // Unknown future stations remain visible rather than being silently coerced
  // into an unrelated genre. This card stays last and is normally absent.
  return "other";
}

export function specialistSubcategoryLabel(id: SpecialistSubcategory): string {
  return SPECIALIST_SUBCATEGORY_DEFINITIONS.find((definition) => definition.id === id)?.label ?? id;
}