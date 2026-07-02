import { config } from "./config.js";
import { logger } from "./logger.js";

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

/**
 * One of the four typed song-to-song relationship families the graph vision
 * wants. Kept deliberately small so both the Slack card and the web graph can
 * switch on it.
 */
export type SongRelationKind = "sample" | "cover" | "remix" | "interpolation";

/**
 * A typed, directional link from THIS song to another recording/work, parsed
 * from MusicBrainz recording-rels / work-rels.
 *
 * `direction` describes the relationship from this song's point of view:
 *   - "forward":  this song is the source — it samples / is a cover of / is a
 *     remix of / interpolates the related target.
 *   - "backward": this song is the target — the related entity samples / covers
 *     / remixes / interpolates THIS song.
 * `label` is the directional human phrasing ("samples", "sampled by", …) so the
 * card and graph never have to re-derive it.
 */
export interface SongRelationship {
  kind: SongRelationKind;
  direction: "forward" | "backward";
  /** Directional label, e.g. "samples", "sampled by", "remix of". */
  label: string;
  /** Related entity's title. */
  title: string;
  /** Related entity's artist, when MusicBrainz embedded an artist-credit. */
  artist?: string;
  /** Related entity's year, when MusicBrainz reported a date. */
  year?: number;
  /** Whether the related entity is a recording or a work. */
  targetType: "recording" | "work";
  /** Canonical MusicBrainz id of the related entity. */
  targetId: string;
  /** Canonical MusicBrainz page URL for the related entity. */
  mbUrl: string;
}

export interface RecordingCredits {
  recordingId: string;
  artistId?: string;
  artistName?: string;
  personnel: Credit[];
  /** Linked work ids (used to fetch writers in a second lookup). */
  workIds: string[];
  /**
   * Typed song-to-song relationships (samples / covers / remixes /
   * interpolations) parsed from recording-rels + the linked work's work-rels.
   * Optional so the pure credits parser (and older cached results) can omit it;
   * `fetchRecordingCredits` populates it best-effort.
   */
  relationships?: SongRelationship[];
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

/** Directional labels for each relationship family. */
const REL_LABELS: Record<
  SongRelationKind,
  { forward: string; backward: string }
> = {
  sample: { forward: "samples", backward: "sampled by" },
  cover: { forward: "cover of", backward: "covered by" },
  remix: { forward: "remix of", backward: "remixed by" },
  interpolation: { forward: "interpolates", backward: "interpolated by" },
};

/**
 * Classify a MusicBrainz relationship `type` into one of our four families, or
 * null if it isn't one we surface. Substring matching keeps us robust to the
 * exact MusicBrainz wording ("samples", "samples material", "remix", "cover",
 * "based on") without enumerating every variant.
 */
function classifyRelKind(type: string): SongRelationKind | null {
  const t = type.toLowerCase();
  if (t.includes("sampl")) return "sample";
  if (t.includes("remix")) return "remix";
  if (t.includes("cover")) return "cover";
  if (t.includes("interpolat") || t.includes("based on")) {
    return "interpolation";
  }
  return null;
}

/** Best-effort credited-artist name from an embedded artist-credit array. */
function artistCreditName(
  ac?: Array<{ name?: string; artist?: { name?: string } }>,
): string | undefined {
  if (!ac?.length) return undefined;
  const parts = ac
    .map((c) => (c.name?.trim() || c.artist?.name?.trim() || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/**
 * Pure: typed song-to-song relationships (samples / covers / remixes /
 * interpolations) from a recording OR work body's `relations` array. Only
 * relations that classify into one of the four families AND carry a usable
 * recording/work target (id + title) survive. Direction is taken verbatim from
 * MusicBrainz; the human label is derived from kind + direction. Dups (same
 * kind+direction+target) are dropped and the list is capped.
 */
export function parseSongRelationships(
  body: unknown,
  cap = 12,
): SongRelationship[] {
  const b = body as {
    relations?: Array<{
      type?: string;
      direction?: string;
      "target-type"?: string;
      recording?: {
        id?: string;
        title?: string;
        "first-release-date"?: string;
        "artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>;
      };
      work?: { id?: string; title?: string };
    }>;
  };
  const out: SongRelationship[] = [];
  const seen = new Set<string>();
  for (const rel of b?.relations ?? []) {
    const kind = classifyRelKind(rel?.type ?? "");
    if (!kind) continue;
    const targetType =
      rel["target-type"] === "work"
        ? "work"
        : rel["target-type"] === "recording"
          ? "recording"
          : null;
    if (!targetType) continue;
    const entity = targetType === "recording" ? rel.recording : rel.work;
    const targetId = entity?.id?.trim();
    const title = entity?.title?.trim();
    if (!targetId || !title) continue;
    const direction = rel.direction === "backward" ? "backward" : "forward";
    const dedupeKey = `${kind}|${direction}|${targetId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let artist: string | undefined;
    let year: number | undefined;
    if (targetType === "recording" && rel.recording) {
      artist = artistCreditName(rel.recording["artist-credit"]);
      const yearStr = rel.recording["first-release-date"]?.slice(0, 4);
      year =
        yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : undefined;
    }

    out.push({
      kind,
      direction,
      label: REL_LABELS[kind][direction],
      title,
      ...(artist ? { artist } : {}),
      ...(year != null ? { year } : {}),
      targetType,
      targetId,
      mbUrl: `https://musicbrainz.org/${targetType}/${targetId}`,
    });
  }
  return out.slice(0, cap);
}

/** Drop duplicate relationships (same kind+direction+target), preserving order. */
function dedupeRelationships(rels: SongRelationship[]): SongRelationship[] {
  const seen = new Set<string>();
  const out: SongRelationship[] = [];
  for (const r of rels) {
    const key = `${r.kind}|${r.direction}|${r.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
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
      `/recording/${recordingId}?inc=artist-credits+artist-rels+work-rels+recording-rels&fmt=json`,
    );
    const credits = parseRecordingCredits(recordingId, recBody);
    // Recording-level relationships (samples / remixes between recordings).
    const relationships: SongRelationship[] = parseSongRelationships(recBody);

    if (credits.workIds[0]) {
      try {
        const workBody = await mbFetch(
          `/work/${credits.workIds[0]}?inc=artist-rels+work-rels&fmt=json`,
        );
        credits.personnel = [
          ...credits.personnel,
          ...parseWorkWriters(workBody),
        ];
        // Work-level relationships (covers / interpolations between works).
        relationships.push(...parseSongRelationships(workBody));
      } catch (err) {
        logger.warn("MusicBrainz work lookup failed", {
          work: credits.workIds[0],
          error: String(err),
        });
      }
    }
    credits.relationships = dedupeRelationships(relationships);
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

/**
 * One recording released on a label, as surfaced by a label -> releases lookup.
 * Because MusicBrainz hands us the canonical recording id directly, these land
 * on the spine at "recording_id" confidence with no text resolution — they are
 * real, grounded picks, never invented.
 */
export interface LabelRecording {
  recordingId: string;
  title: string;
  artist?: string;
  artistMbid?: string;
  /** Owning release's id + title, for the "released on" source link/context. */
  releaseId: string;
  releaseTitle?: string;
  /** Release year, when MusicBrainz reported a date. */
  year?: number;
}

/**
 * Pure: flatten a MusicBrainz `/release?label=...&inc=recordings+artist-credits`
 * body into LabelRecording[]. Every track on every release the label put out
 * becomes a grounded pick. De-duped by recording id (a track pressed on several
 * releases appears once, earliest release wins). Capped so one giant back
 * catalogue can't explode into thousands of picks in a single sync.
 */
export function parseLabelReleaseRecordings(
  body: unknown,
  cap = 200,
): LabelRecording[] {
  const b = body as {
    releases?: Array<{
      id?: string;
      title?: string;
      date?: string;
      "artist-credit"?: Array<{
        name?: string;
        artist?: { id?: string; name?: string };
      }>;
      media?: Array<{
        tracks?: Array<{
          recording?: {
            id?: string;
            title?: string;
            "artist-credit"?: Array<{
              name?: string;
              artist?: { id?: string; name?: string };
            }>;
          };
        }>;
      }>;
    }>;
  };
  const out: LabelRecording[] = [];
  const seen = new Set<string>();
  // Oldest release first so the earliest pressing wins the de-dupe.
  const releases = [...(b?.releases ?? [])].sort((r1, r2) =>
    (r1.date ?? "9999").localeCompare(r2.date ?? "9999"),
  );
  for (const rel of releases) {
    const releaseId = rel?.id?.trim();
    if (!releaseId) continue;
    const releaseTitle = rel.title?.trim() || undefined;
    const yearStr = rel.date?.slice(0, 4);
    const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : undefined;
    const relAc = rel["artist-credit"]?.[0];
    for (const medium of rel.media ?? []) {
      for (const track of medium.tracks ?? []) {
        const rec = track.recording;
        const recordingId = rec?.id?.trim();
        const title = rec?.title?.trim();
        if (!recordingId || !title || seen.has(recordingId)) continue;
        seen.add(recordingId);
        const ac = rec?.["artist-credit"]?.[0] ?? relAc;
        const artist = ac?.name?.trim() || ac?.artist?.name?.trim() || undefined;
        const artistMbid = ac?.artist?.id?.trim() || undefined;
        out.push({
          recordingId,
          title,
          releaseId,
          ...(artist ? { artist } : {}),
          ...(artistMbid ? { artistMbid } : {}),
          ...(releaseTitle ? { releaseTitle } : {}),
          ...(year != null ? { year } : {}),
        });
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

/** A MusicBrainz label's display name, when resolvable. */
export async function fetchLabelName(labelId: string): Promise<string | null> {
  if (!musicbrainzEnabled() || !labelId.trim()) return null;
  try {
    const body = (await mbFetch(
      `/label/${encodeURIComponent(labelId.trim())}?fmt=json`,
    )) as { name?: string };
    return body?.name?.trim() || null;
  } catch (err) {
    logger.warn("MusicBrainz label lookup failed", {
      labelId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Fetch the recordings a label released (across its releases). Best-effort —
 * returns [] on any failure or when MusicBrainz is unconfigured; never throws.
 * A single request pulls up to `limit` releases with their embedded recordings,
 * so a label seed costs one MusicBrainz call, honoring the 1 req/sec budget.
 */
export async function fetchLabelReleaseRecordings(
  labelId: string,
  limit = 100,
): Promise<LabelRecording[]> {
  if (!musicbrainzEnabled() || !labelId.trim()) return [];
  try {
    const body = await mbFetch(
      `/release?label=${encodeURIComponent(labelId.trim())}` +
        `&inc=recordings+artist-credits&limit=${Math.min(
          Math.max(limit, 1),
          100,
        )}&fmt=json`,
    );
    return parseLabelReleaseRecordings(body);
  } catch (err) {
    logger.warn("MusicBrainz label releases lookup failed", {
      labelId,
      error: String(err),
    });
    return [];
  }
}

/** A recording resolved from a free-text (artist + title) MusicBrainz search. */
export interface RecordingTextMatch {
  recordingId: string;
  /** MusicBrainz search score (0–100); higher = more confident. */
  score: number;
  title: string;
  artist?: string;
  artistMbid?: string;
  isrc?: string;
  durationMs?: number;
}

/**
 * Pure: pick the best recording from a MusicBrainz recording-search body, or
 * null. Radio now-playing sources usually give only artist + title (no ISRC), so
 * this is the text path onto the MBID spine. We take MusicBrainz's own score,
 * and the caller applies a confidence threshold.
 */
export function parseRecordingSearch(body: unknown): RecordingTextMatch | null {
  const b = body as {
    recordings?: Array<{
      id?: string;
      score?: number;
      title?: string;
      length?: number;
      isrcs?: string[];
      "artist-credit"?: Array<{
        name?: string;
        artist?: { id?: string; name?: string };
      }>;
    }>;
  };
  const best = b?.recordings?.find((r) => !!r?.id);
  if (!best?.id) return null;
  const ac = best["artist-credit"]?.[0];
  const artist = ac?.name?.trim() || ac?.artist?.name?.trim() || undefined;
  const artistMbid = ac?.artist?.id?.trim() || undefined;
  const durationMs =
    typeof best.length === "number" && best.length > 0 ? best.length : undefined;
  const isrc = best.isrcs?.find((x) => !!x?.trim())?.trim() || undefined;
  return {
    recordingId: best.id,
    score: typeof best.score === "number" ? best.score : 0,
    title: best.title?.trim() || "",
    ...(artist ? { artist } : {}),
    ...(artistMbid ? { artistMbid } : {}),
    ...(isrc ? { isrc } : {}),
    ...(durationMs != null ? { durationMs } : {}),
  };
}

/** Escape a term for a Lucene-style MusicBrainz query. */
function escapeQuery(s: string): string {
  return s.replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolve an artist + title (the shape radio now-playing metadata gives us) to a
 * canonical MusicBrainz recording. Best-effort — returns null when MusicBrainz
 * is unconfigured, inputs are empty, nothing matches above `minScore`, or on any
 * failure; never throws. `minScore` guards against low-confidence junk matches
 * so a bad text search doesn't poison the spine.
 */
export async function resolveRecordingByText(
  artist: string,
  title: string,
  minScore = 90,
): Promise<RecordingTextMatch | null> {
  if (!musicbrainzEnabled() || !artist.trim() || !title.trim()) return null;
  const a = escapeQuery(artist);
  const t = escapeQuery(title);
  if (!a || !t) return null;
  try {
    const query = `recording:"${t}" AND artist:"${a}"`;
    const body = await mbFetch(
      `/recording?query=${encodeURIComponent(query)}&limit=5&fmt=json`,
    );
    const match = parseRecordingSearch(body);
    if (!match || match.score < minScore) return null;
    return match;
  } catch (err) {
    logger.warn("MusicBrainz text resolve failed", {
      artist,
      title,
      error: String(err),
    });
    return null;
  }
}
