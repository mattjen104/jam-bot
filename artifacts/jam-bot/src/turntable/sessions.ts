import { logger } from "../logger.js";
import { searchTrack, type SearchResultTrack } from "../spotify/client.js";
import type { PersonInfo } from "./person.js";

/**
 * Resolve a person's notable work (their MusicBrainz "known for" release groups)
 * to real Spotify tracks so the card can queue them onto the host playback.
 *
 * Release-group-level known work carries no ISRC (ISRCs live on recordings, not
 * release groups), so there's no exact `isrc:` lookup to try here — we resolve
 * via a guarded title+artist search and keep ONLY confident matches. The honesty
 * guard (`isConfidentMatch`) drops any hit whose artist credit doesn't actually
 * contain the person, so a same-named song by the wrong artist is skipped rather
 * than approximated into the wrong recording. Never throws.
 */
export interface ResolvedSessionTrack {
  trackId: string;
  uri: string;
  title: string;
  artist: string;
}

/** Default ceiling on how many session tracks we queue per tap. */
export const SESSION_TRACK_CAP = 5;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A Spotify hit is a confident match only when the person's name appears in the
 * resolved track's artist credit (substring either direction on normalized
 * strings). Title-only searches can surface a same-named song by a different
 * artist; we'd rather drop it than queue the wrong recording.
 */
function isConfidentMatch(resultArtist: string, personName: string): boolean {
  const a = normalize(resultArtist);
  const p = normalize(personName);
  if (!a || !p) return false;
  return a.includes(p) || p.includes(a);
}

export async function resolvePersonSessions(
  person: PersonInfo,
  opts: {
    cap?: number;
    search?: (query: string) => Promise<SearchResultTrack | null>;
  } = {},
): Promise<ResolvedSessionTrack[]> {
  const cap = Math.max(1, opts.cap ?? SESSION_TRACK_CAP);
  const search = opts.search ?? searchTrack;
  const name = person.name?.trim();
  const works = person.knownFor ?? [];
  if (!name || !works.length) return [];

  const out: ResolvedSessionTrack[] = [];
  const seen = new Set<string>();
  for (const work of works) {
    if (out.length >= cap) break;
    const title = work.title?.trim();
    if (!title) continue;
    const query = `${title} ${name}`.trim();
    let hit: SearchResultTrack | null = null;
    try {
      hit = await search(query);
    } catch (err) {
      logger.warn("Session resolve: Spotify search failed", {
        query,
        error: String(err),
      });
      continue;
    }
    if (!hit || seen.has(hit.id)) continue;
    if (!isConfidentMatch(hit.artist, name)) continue;
    seen.add(hit.id);
    out.push({
      trackId: hit.id,
      uri: hit.uri,
      title: hit.title,
      artist: hit.artist,
    });
  }
  return out;
}
