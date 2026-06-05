import { config } from "./config.js";
import { logger } from "./logger.js";
import { getTrackContext, setTrackContext } from "./cache.js";
import {
  type ArtistReleaseGroup,
  type ArtistCollaborator,
  fetchArtistReleaseGroups,
  fetchArtistRelations,
  musicbrainzEnabled,
} from "./musicbrainz.js";
import { fetchArtistTags, lastfmEnabled } from "./lastfm.js";
import { fetchArtistBio, wikipediaEnabled } from "./wikipedia.js";

/**
 * Person rabbit-hole enrichment for the consolidated track card.
 *
 * When a listener taps a credited name (producer, writer, engineer, performer)
 * we open a grounded sub-page about that PERSON: a canonical MusicBrainz artist
 * link, a "known for" list of their release groups, crowd genre tags, and a
 * short bio. Every fact is sourced — MusicBrainz release groups, Last.fm tags,
 * Wikipedia bio — never invented. Like the other enrichment layers it runs OFF
 * the playback hot path (it's user-initiated on a button click), is cached by a
 * canonical person key, and never throws.
 */

export interface PersonInfo {
  name: string;
  /** MusicBrainz artist id, when known (the canonical key). */
  artistId?: string;
  /** Canonical MusicBrainz artist page. */
  mbUrl?: string;
  /** A few release groups the person is known for. */
  knownFor: Array<{ title: string; year?: number; mbUrl: string }>;
  /** Genre tags (Last.fm). */
  tags: string[];
  /** Short bio snippet (Wikipedia). */
  bio?: string;
  wikipediaUrl?: string;
  /**
   * Grounded related artists (band members / collaborators) the card can hop to.
   * Each carries a canonical MusicBrainz artist id; empty when none resolved.
   */
  collaborators: ArtistCollaborator[];
  fetchedAtMs: number;
}

const ttlMs = (): number =>
  config.TRACK_CONTEXT_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function cacheKey(name: string, artistId?: string): string {
  return artistId ? `person:mb:${artistId}` : `person:nm:${slug(name)}`;
}

function mbArtistUrl(artistId: string): string {
  return `https://musicbrainz.org/artist/${artistId}`;
}

function releaseGroupUrl(id: string): string {
  return `https://musicbrainz.org/release-group/${id}`;
}

function hasContent(p: PersonInfo): boolean {
  return (
    !!p.mbUrl ||
    p.knownFor.length > 0 ||
    p.tags.length > 0 ||
    !!p.bio ||
    (p.collaborators?.length ?? 0) > 0
  );
}

function toKnownFor(groups: ArtistReleaseGroup[]): PersonInfo["knownFor"] {
  return groups.map((g) => ({
    title: g.title,
    year: g.year,
    mbUrl: releaseGroupUrl(g.id),
  }));
}

/**
 * Resolve grounded info about a credited person. Returns null when nothing
 * useful resolved or every source is disabled. Cached (including empty) so a
 * repeat tap is instant and a dud isn't re-queried. Never throws.
 */
export async function enrichPerson(args: {
  name: string;
  artistId?: string;
}): Promise<PersonInfo | null> {
  const name = args.name.trim();
  const artistId = args.artistId?.trim() || undefined;
  if (!name && !artistId) return null;

  const key = cacheKey(name, artistId);

  try {
    const raw = getTrackContext(key, ttlMs());
    if (raw) {
      const cached = JSON.parse(raw) as PersonInfo;
      return hasContent(cached) ? cached : null;
    }
  } catch (err) {
    logger.warn("Person cache read failed", { key, error: String(err) });
  }

  // Fetch every available source in parallel; each is independently best-effort.
  const [groups, tags, bio, collaborators] = await Promise.all([
    artistId && musicbrainzEnabled()
      ? fetchArtistReleaseGroups(artistId)
      : Promise.resolve<ArtistReleaseGroup[]>([]),
    lastfmEnabled()
      ? fetchArtistTags(name, artistId)
      : Promise.resolve<string[]>([]),
    wikipediaEnabled() && name ? fetchArtistBio(name) : Promise.resolve(null),
    artistId && musicbrainzEnabled()
      ? fetchArtistRelations(artistId)
      : Promise.resolve<ArtistCollaborator[]>([]),
  ]);

  const info: PersonInfo = {
    name: name || "this person",
    artistId,
    mbUrl: artistId ? mbArtistUrl(artistId) : undefined,
    knownFor: toKnownFor(groups),
    tags,
    bio: bio?.extract,
    wikipediaUrl: bio?.url,
    collaborators,
    fetchedAtMs: Date.now(),
  };

  try {
    setTrackContext(key, JSON.stringify(info));
  } catch (err) {
    logger.warn("Person cache write failed", { key, error: String(err) });
  }

  return hasContent(info) ? info : null;
}
