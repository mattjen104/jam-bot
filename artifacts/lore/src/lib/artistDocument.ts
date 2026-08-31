import { MAX_TASTE_SEEDS } from "../hooks/useDialData";

const MAX_ARTIST_LENGTH = 100;

export function parseArtistDocument(value: string): { artists: string[]; error: string | null } {
  const lines = value.split(/\r?\n/);
  const artists: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const artist = line.trim();
    if (!artist) continue;
    if (artist.length > MAX_ARTIST_LENGTH) {
      return {
        artists: [],
        error: `Artist names must be ${MAX_ARTIST_LENGTH} characters or fewer.`,
      };
    }
    const key = artist.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    artists.push(artist);
  }

  if (artists.length > MAX_TASTE_SEEDS) {
    return {
      artists: [],
      error: `You can keep up to ${MAX_TASTE_SEEDS} artists.`,
    };
  }
  return { artists, error: null };
}