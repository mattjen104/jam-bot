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
  | "classical";

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
];

const RULES: readonly [SpecialistSubcategory, RegExp][] = [
  ["ambient", /ambient|chill\s?out|lounge|relax|meditat|sleep|downtempo|easy listening|drone/i],
  ["folk", /folk|country|celtic|americana|bluegrass|acoustic/i],
  ["rock", /metal|punk|hardcore|grunge|alternative|progressive rock|rock/i],
  ["jazz", /jazz|blues/i],
  ["era", /50s|50er|60s|60er|70s|70er|80s|80er|90s|90er|00s|2000s|oldies|retro|new wave|synthpop|disco|schlager|gold|kult/i],
  ["world", /reggae|ska|dancehall|soca|salsa|bachata|merengue|latin|world|afric|arab|balkan|asian|k-pop|kpop|bollywood|desi/i],
  ["electronic", /techno|house|trance|electro|edm|electronic|dance|club|rave|hardstyle|dubstep|goa|psytrance|drum.?n.?bass/i],
  ["groove", /groove|soul|funk|motown|r&b|rnb/i],
  ["classical", /classical|baroque|opera|orchestra|symphony/i],
];

export function specialistSubcategoryForStation(station: Station): SpecialistSubcategory {
  const haystack = `${station.name} ${(station.tags ?? []).join(" ")}`;
  for (const [id, rule] of RULES) {
    if (rule.test(haystack)) return id;
  }
  // The current specialist pool has no unknowns after the explicit FIP
  // channels are covered by their names, but this keeps future discoveries
  // visible without creating a tenth catch-all card.
  return "era";
}

export function specialistSubcategoryLabel(id: SpecialistSubcategory): string {
  return SPECIALIST_SUBCATEGORY_DEFINITIONS.find((definition) => definition.id === id)?.label ?? id;
}