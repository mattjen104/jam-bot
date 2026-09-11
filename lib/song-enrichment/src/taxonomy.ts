/** The deliberately bounded vocabulary exposed to listeners. */
export const CANONICAL_GENRES = [
  "ambient", "blues", "classical", "country", "electronic", "experimental",
  "folk", "hip-hop", "indie", "jazz", "metal", "pop", "punk", "r&b",
  "reggae", "rock", "soul", "world",
] as const;
export type CanonicalGenre = (typeof CANONICAL_GENRES)[number];

const ALIASES: Record<string, CanonicalGenre> = {
  "hip hop": "hip-hop", hiphop: "hip-hop", "r and b": "r&b", rhythmblues: "r&b",
  "rhythm & blues": "r&b", electronica: "electronic", "singer-songwriter": "folk",
  "singer songwriter": "folk", "alternative rock": "rock",
};

/** Normalize provider evidence; unknown tags are intentionally discarded. */
export function canonicalGenre(tag: string): CanonicalGenre | null {
  const key = tag.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const direct = key.replace(/ /g, "") as CanonicalGenre;
  if ((CANONICAL_GENRES as readonly string[]).includes(key)) return key as CanonicalGenre;
  if ((CANONICAL_GENRES as readonly string[]).includes(direct)) return direct;
  return ALIASES[key] ?? null;
}

export function canonicalGenres(tags: readonly string[] | null | undefined): CanonicalGenre[] {
  return [...new Set((tags ?? []).map(canonicalGenre).filter((g): g is CanonicalGenre => g !== null))];
}

export type ReleaseEra = "current" | "catalog" | "deep";
/** Year semantics shared by Dial and saved-library views. */
export function releaseEra(year: number | null | undefined, now = new Date()): ReleaseEra | null {
  if (year == null || !Number.isFinite(year)) return null;
  // Keep this aligned with dialAgeFilter: MusicBrainz commonly supplies only
  // a year, so adding the current month would imply precision we do not have.
  const ageMonths = (now.getUTCFullYear() - year) * 12;
  if (ageMonths <= 18) return "current";
  if (ageMonths <= 60) return "catalog";
  return "deep";
}