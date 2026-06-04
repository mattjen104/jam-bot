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
      artist?: { name?: string };
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
    const type = (rel.type ?? "").toLowerCase();
    // Performer rels carry the instrument/voice in `attributes`; everything
    // else (producer, engineer, mix, mastering, etc.) uses the rel type.
    if (type === "vocal" || type === "instrument" || type === "performer") {
      const attrs = (rel.attributes ?? [])
        .map((a) => a.trim())
        .filter(Boolean);
      const role = attrs.length ? attrs.join(", ") : "performer";
      personnel.push({ role, name });
    } else if (type) {
      personnel.push({ role: type, name });
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
    relations?: Array<{ type?: string; artist?: { name?: string } }>;
  };
  const writers: Credit[] = [];
  for (const rel of b?.relations ?? []) {
    const name = rel?.artist?.name?.trim();
    if (!name) continue;
    const type = (rel.type ?? "").toLowerCase();
    if (type === "composer" || type === "lyricist" || type === "writer") {
      writers.push({ role: type, name });
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
