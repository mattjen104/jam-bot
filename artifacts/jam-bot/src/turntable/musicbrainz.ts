import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Minimal MusicBrainz client for the track-knowledge (liner-notes) feature.
 *
 * MusicBrainz is the canonical-ID spine: an ACRCloud ISRC resolves to a
 * MusicBrainz *recording* id, which in turn gives us a stable artist id and
 * the structured artist-relationships (producer, engineer, performers) that
 * make up production credits. The recording's linked *work* gives writers
 * (composer / lyricist).
 *
 * API rules we honor:
 *  - A descriptive User-Agent containing contact info is REQUIRED. We use
 *    `config.MUSICBRAINZ_CONTACT` verbatim and skip the feature when unset.
 *  - At most ~1 request/second from a single source. All calls funnel through
 *    `mbFetch`, which serializes them behind a >=1.1s spacing gate.
 *
 * Network functions are thin; the response-shape handling lives in exported
 * pure parsers so it can be locked down with unit tests.
 */

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_MIN_INTERVAL_MS = 1100;
const MB_TIMEOUT_MS = 10_000;

export interface Credit {
  /** Normalized role, e.g. "producer", "engineer", "vocals", "guitar". */
  role: string;
  /** Person or group name. */
  name: string;
  /**
   * MusicBrainz artist id, when the relation carried one. Enables hyperlinking
   * the name to its canonical artist page and the person rabbit-hole drill-down.
   */
  artistId?: string;
}

/** A release group (album/EP/single) credited to an artist. */
export interface ArtistReleaseGroup {
  id: string;
  title: string;
  /** First-release year, when MusicBrainz reported a date. */
  year?: number;
  /** Primary type, e.g. "Album", "EP", "Single". */
  primaryType?: string;
}

/**
 * Another artist this artist is related to (band member, frequent collaborator,
 * etc.). Carries a canonical artist id so the card's person rabbit-hole can hop
 * to a grounded sub-page — never a name-search guess.
 */
export interface ArtistCollaborator {
  artistId: string;
  name: string;
  /** Relationship label from MusicBrainz, e.g. "member of band". */
  relation?: string;
}

export interface RecordingCredits {
  recordingId: string;
  artistId?: string;
  artistName?: string;
  personnel: Credit[];
  /** Linked work ids (used to fetch writers in a second lookup). */
  workIds: string[];
}

/** Whether MusicBrainz lookups are configured (a contact UA is required). */
export function musicbrainzEnabled(): boolean {
  return !!config.MUSICBRAINZ_CONTACT?.trim();
}

// Serialize all MusicBrainz requests behind a >=1.1s spacing gate so we never
// trip the rate limit even when several enrichments overlap.
let mbChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function mbFetch(pathWithQuery: string): Promise<unknown> {
  const contact = config.MUSICBRAINZ_CONTACT?.trim();
  if (!contact) throw new Error("MusicBrainz not configured");
  const run = mbChain.then(async () => {
    await sleep(MB_MIN_INTERVAL_MS);
    const res = await fetch(`${MB_BASE}${pathWithQuery}`, {
      headers: { "User-Agent": contact, Accept: "application/json" },
      signal: AbortSignal.timeout(MB_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`MusicBrainz ${res.status} for ${pathWithQuery}`);
    }
    return res.json();
  });
  // Keep the chain alive even when a call rejects, so one failure doesn't
  // wedge every later request.
  mbChain = run.catch(() => undefined);
  return run;
}

/** Pure: first recording id from an ISRC lookup body, or null. */
export function parseIsrcRecordingId(body: unknown): string | null {
  const b = body as { recordings?: Array<{ id?: string }> };
  return b?.recordings?.find((r) => !!r?.id)?.id ?? null;
}

/** Pure: artist id/name, personnel credits, and linked work ids. */
export function parseRecordingCredits(
  recordingId: string,
  body: unknown,
): RecordingCredits {
  const b = body as {
    "artist-credit"?: Array<{ artist?: { id?: string; name?: string } }>;
    relations?: Array<{
      type?: string;
      direction?: string;
      artist?: { id?: string; name?: string };
      work?: { id?: string };
      attributes?: string[];
    }>;
  };
  const primary = b?.["artist-credit"]?.[0]?.artist;
  const personnel: Credit[] = [];
  const workIds: string[] = [];
  for (const rel of b?.relations ?? []) {
    if (rel?.work?.id) workIds.push(rel.work.id);
    const name = rel?.artist?.name?.trim();
    if (!name) continue;
    const artistId = rel?.artist?.id?.trim() || undefined;
    const type = (rel.type ?? "").toLowerCase();
    // Performer rels carry the instrument/voice in `attributes`; everything
    // else (producer, engineer, mix, mastering, etc.) uses the rel type.
    if (type === "vocal" || type === "instrument" || type === "performer") {
      const attrs = (rel.attributes ?? [])
        .map((a) => a.trim())
        .filter(Boolean);
      const role = attrs.length ? attrs.join(", ") : "performer";
      personnel.push({ role, name, ...(artistId ? { artistId } : {}) });
    } else if (type) {
      personnel.push({ role: type, name, ...(artistId ? { artistId } : {}) });
    }
  }
  return {
    recordingId,
    artistId: primary?.id,
    artistName: primary?.name,
    personnel: dedupeCredits(personnel),
    workIds: [...new Set(workIds)],
  };
}

/** Pure: writer credits (composer / lyricist / writer) from a work body. */
export function parseWorkWriters(body: unknown): Credit[] {
  const b = body as {
    relations?: Array<{ type?: string; artist?: { id?: string; name?: string } }>;
  };
  const writers: Credit[] = [];
  for (const rel of b?.relations ?? []) {
    const name = rel?.artist?.name?.trim();
    if (!name) continue;
    const artistId = rel?.artist?.id?.trim() || undefined;
    const type = (rel.type ?? "").toLowerCase();
    if (type === "composer" || type === "lyricist" || type === "writer") {
      writers.push({ role: type, name, ...(artistId ? { artistId } : {}) });
    }
  }
  return dedupeCredits(writers);
}

/** Drop exact (role+name) duplicates while preserving order. */
function dedupeCredits(credits: Credit[]): Credit[] {
  const seen = new Set<string>();
  const out: Credit[] = [];
  for (const c of credits) {
    const key = `${c.role.toLowerCase()}|${c.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Cheap first step: resolve an ISRC to its canonical MusicBrainz recording id
 * (a single request). Split out from the heavier credits fetch so callers can
 * use the recording id as a canonical cache key BEFORE paying for the full
 * credits/writers lookups. Best-effort — never throws.
 */
export async function resolveRecordingId(
  isrc: string,
): Promise<string | null> {
  if (!musicbrainzEnabled() || !isrc.trim()) return null;
  try {
    const body = await mbFetch(
      `/isrc/${encodeURIComponent(isrc.trim())}?inc=recordings&fmt=json`,
    );
    return parseIsrcRecordingId(body);
  } catch (err) {
    logger.warn("MusicBrainz ISRC resolve failed", {
      isrc,
      error: String(err),
    });
    return null;
  }
}

/**
 * Fetch credits for a known recording id: artist-rels (producer/engineer/
 * performers) plus writers from the first linked work. Best-effort — any
 * failed step is logged and the partial result (or null) is returned; this
 * never throws.
 */
export async function fetchRecordingCredits(
  recordingId: string,
): Promise<RecordingCredits | null> {
  if (!musicbrainzEnabled() || !recordingId) return null;
  try {
    const recBody = await mbFetch(
      `/recording/${recordingId}?inc=artist-credits+artist-rels+work-rels&fmt=json`,
    );
    const credits = parseRecordingCredits(recordingId, recBody);

    if (credits.workIds[0]) {
      try {
        const workBody = await mbFetch(
          `/work/${credits.workIds[0]}?inc=artist-rels&fmt=json`,
        );
        credits.personnel = [
          ...credits.personnel,
          ...parseWorkWriters(workBody),
        ];
      } catch (err) {
        logger.warn("MusicBrainz work lookup failed", {
          work: credits.workIds[0],
          error: String(err),
        });
      }
    }
    return credits;
  } catch (err) {
    logger.warn("MusicBrainz recording lookup failed", {
      recordingId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Convenience composer: ISRC -> recording id -> credits. Kept for callers /
 * tests that want the whole resolution in one call; the orchestrator uses the
 * two split steps directly so it can converge on the canonical cache key.
 */
export async function fetchMusicBrainzCredits(
  isrc: string,
): Promise<RecordingCredits | null> {
  const id = await resolveRecordingId(isrc);
  if (!id) return null;
  return fetchRecordingCredits(id);
}

/**
 * Pure: an artist's release groups (their albums/EPs/singles), most recent
 * first, capped. Powers the "known for" list on a person sub-page. MusicBrainz
 * is the canonical, grounded source here — these are real release groups linked
 * to the artist, never invented.
 */
export function parseArtistReleaseGroups(
  body: unknown,
  cap = 6,
): ArtistReleaseGroup[] {
  const b = body as {
    "release-groups"?: Array<{
      id?: string;
      title?: string;
      "first-release-date"?: string;
      "primary-type"?: string;
      "secondary-types"?: string[];
    }>;
  };
  const out: ArtistReleaseGroup[] = [];
  const seen = new Set<string>();
  for (const rg of b?.["release-groups"] ?? []) {
    const id = rg?.id?.trim();
    const title = rg?.title?.trim();
    if (!id || !title) continue;
    // Skip compilations/live/remix secondary types — keep the list to the
    // artist's primary body of work so "known for" reads true.
    if ((rg["secondary-types"]?.length ?? 0) > 0) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const yearStr = rg["first-release-date"]?.slice(0, 4);
    const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : undefined;
    out.push({
      id,
      title,
      year,
      primaryType: rg["primary-type"]?.trim() || undefined,
    });
  }
  // Most recent first; undated entries sink to the bottom.
  out.sort((a, b2) => (b2.year ?? 0) - (a.year ?? 0));
  return out.slice(0, cap);
}

/**
 * Fetch an artist's release groups (albums/EPs/singles). Best-effort — returns
 * [] on any failure or when MusicBrainz is unconfigured; never throws.
 */
export async function fetchArtistReleaseGroups(
  artistId: string,
): Promise<ArtistReleaseGroup[]> {
  if (!musicbrainzEnabled() || !artistId.trim()) return [];
  try {
    const body = await mbFetch(
      `/release-group?artist=${encodeURIComponent(
        artistId.trim(),
      )}&type=album|ep&limit=25&fmt=json`,
    );
    return parseArtistReleaseGroups(body);
  } catch (err) {
    logger.warn("MusicBrainz release-group lookup failed", {
      artistId,
      error: String(err),
    });
    return [];
  }
}

/**
 * Pure: an artist's related artists (band members, collaborators, etc.) from
 * artist-rels. Only relations carrying a canonical artist id survive — these
 * are the grounded hops the person rabbit-hole can follow, never name guesses.
 * Self-links and duplicates are dropped; the list is capped.
 */
export function parseArtistRelations(
  body: unknown,
  cap = 8,
): ArtistCollaborator[] {
  const b = body as {
    id?: string;
    relations?: Array<{
      type?: string;
      artist?: { id?: string; name?: string };
    }>;
  };
  const selfId = b?.id?.trim();
  const out: ArtistCollaborator[] = [];
  const seen = new Set<string>();
  for (const rel of b?.relations ?? []) {
    const artistId = rel?.artist?.id?.trim();
    const name = rel?.artist?.name?.trim();
    if (!artistId || !name) continue;
    if (artistId === selfId || seen.has(artistId)) continue;
    seen.add(artistId);
    const relation = rel.type?.trim() || undefined;
    out.push({ artistId, name, ...(relation ? { relation } : {}) });
  }
  return out.slice(0, cap);
}

/**
 * Fetch an artist's related artists (band members / collaborators). Best-effort
 * — returns [] on any failure or when MusicBrainz is unconfigured; never throws.
 */
export async function fetchArtistRelations(
  artistId: string,
): Promise<ArtistCollaborator[]> {
  if (!musicbrainzEnabled() || !artistId.trim()) return [];
  try {
    const body = await mbFetch(
      `/artist/${encodeURIComponent(artistId.trim())}?inc=artist-rels&fmt=json`,
    );
    return parseArtistRelations(body);
  } catch (err) {
    logger.warn("MusicBrainz artist-rels lookup failed", {
      artistId,
      error: String(err),
    });
    return [];
  }
}
