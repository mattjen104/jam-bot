/**
 * Server-side release-metadata resolver for the Library crate.
 *
 * The crate used to call musicbrainz.org straight from the browser — one
 * throttled request per ~40 kept recordings, so a large library trickled
 * lookups for minutes after every page load. This module moves that work
 * behind the API:
 *
 *   1. `recording_release_groups` is the durable cache (the primary row is
 *      exactly what the crate renders: album title + release-group MBID).
 *   2. Misses are hydrated with BATCHED MB search queries (`rid:a OR rid:b…`,
 *      50 ids per call) serialized behind a >=1.1s pacing gate, then upserted
 *      so the next load — and the main library endpoint itself — reads them
 *      straight from Postgres.
 *   3. Recordings MB doesn't know land in a 7-day in-memory negative cache so
 *      repeat page loads don't re-hammer MB for the same dead ends. Fetch
 *      failures (5xx/network) are NOT negatively cached — they stay retryable.
 *
 * The network layer is injectable (`__setReleaseMetadataFetchForTests`) so DB
 * tests can drive hydration without hitting the real API.
 */
import { db, recordingReleaseGroupsTable, recordingsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_MIN_INTERVAL_MS = 1_100;
const FETCH_TIMEOUT_MS = 12_000;
/** rids per batched search query — keeps URLs well under MB's limits. */
const SEARCH_CHUNK = 50;
/** Mirrors NULL_CACHE_MISS_MAX_AGE_MS: MB may index the recording later. */
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_NEGATIVE_ENTRIES = 10_000;
/** Only real MBIDs are worth a query — synthetic `sp:%` ids can never match. */
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReleaseMetadataResult {
  title: string;
  releaseGroupMbid: string;
}

interface MbReleaseGroup {
  id?: string;
  title?: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  "first-release-date"?: string;
}

interface MbSearchRecording {
  id?: string;
  releases?: Array<{
    /** Release title — search projections often omit the nested group's
     *  title/date, so the release's own fields are the fallback source. */
    title?: string;
    date?: string;
    status?: string;
    "release-group"?: MbReleaseGroup;
  }>;
}

export interface ParsedRecording {
  /** Every distinct release group on the recording (for the bridge table). */
  groups: Array<{
    releaseGroupMbid: string;
    title: string | null;
    primaryType: string | null;
    releaseYear: number | null;
  }>;
  /** Canonical Album group per the house rule; null when nothing qualifies. */
  primary: ReleaseMetadataResult | null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
let fetchImpl: FetchLike = defaultFetch;

/** Test seam: swap the network layer. Pass null to restore the real fetch. */
export function __setReleaseMetadataFetchForTests(fn: FetchLike | null): void {
  fetchImpl = fn ?? defaultFetch;
}

const negativeCache = new Map<string, number>();
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Test seam: clear the negative cache and pacing state between tests. */
export function __clearReleaseMetadataCaches(): void {
  negativeCache.clear();
  chain = Promise.resolve();
  lastRequestAt = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Serialized, paced MB fetch. All hydration in the process funnels through
 * this chain so concurrent crate loads can't trip the ~1 req/sec limit.
 */
function mbSearchFetch(url: string, contact: string): Promise<Response> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MB_MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fetchImpl(url, {
      headers: { "User-Agent": contact, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  });
  chain = run.catch(() => undefined);
  return run;
}

function releaseDate(release: {
  date?: string;
  "release-group"?: { "first-release-date"?: string };
}): string {
  return release["release-group"]?.["first-release-date"] ?? release.date ?? "9999";
}

type MbRelease = NonNullable<MbSearchRecording["releases"]>[number];

/** A release is usable when the group id and SOME title are known — search
 *  projections may carry the title only on the release itself. */
function usableTitle(release: MbRelease): string | null {
  return release["release-group"]?.title ?? release.title ?? null;
}

/**
 * Pick the canonical release metadata for one recording search result.
 * Same rule the crate used client-side: earliest plain-Album group, else the
 * earliest Official release's group, else the earliest group at all.
 */
export function pickPrimaryReleaseMetadata(
  recording: MbSearchRecording,
): ReleaseMetadataResult | null {
  const releases = (recording.releases ?? []).filter(
    (release) => release["release-group"]?.id && usableTitle(release),
  );
  if (releases.length === 0) return null;
  const preferred = releases
    .filter((release) => {
      const group = release["release-group"];
      return group?.["primary-type"] === "Album"
        && (group?.["secondary-types"]?.length ?? 0) === 0;
    })
    .sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)))[0];
  const fallback = releases
    .filter((release) => release.status === "Official")
    .sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)))[0]
    ?? [...releases].sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)))[0];
  const chosen = preferred ?? fallback;
  const groupId = chosen?.["release-group"]?.id;
  const title = chosen ? usableTitle(chosen) : null;
  return groupId && title ? { title, releaseGroupMbid: groupId } : null;
}

/**
 * Parse a batched `/recording/?query=rid:…` response into per-recording
 * release-group rows plus the canonical primary pick. Pure; only recordings
 * whose id was actually requested are considered (MB can return extras).
 */
export function parseRecordingSearchResults(
  body: unknown,
  requested: ReadonlySet<string>,
): Map<string, ParsedRecording> {
  const out = new Map<string, ParsedRecording>();
  const recordings = (body as { recordings?: MbSearchRecording[] })?.recordings ?? [];
  for (const recording of recordings) {
    if (!recording.id || !requested.has(recording.id)) continue;
    const seen = new Map<string, ParsedRecording["groups"][number]>();
    for (const release of recording.releases ?? []) {
      const group = release["release-group"];
      if (!group?.id || seen.has(group.id)) continue;
      // Search projections omit first-release-date on the nested group (and
      // often its title); fall back to the release's own title/date, which
      // recording search DOES include.
      const firstDate = group["first-release-date"] ?? release.date ?? null;
      seen.set(group.id, {
        releaseGroupMbid: group.id,
        title: group.title ?? release.title ?? null,
        primaryType: group["primary-type"] ?? null,
        releaseYear: firstDate ? parseInt(firstDate.slice(0, 4), 10) || null : null,
      });
    }
    out.set(recording.id, {
      groups: [...seen.values()],
      primary: pickPrimaryReleaseMetadata(recording),
    });
  }
  return out;
}

async function upsertReleaseGroups(
  recordingMbid: string,
  parsed: ParsedRecording,
): Promise<void> {
  for (const group of parsed.groups) {
    const isPrimary = parsed.primary?.releaseGroupMbid === group.releaseGroupMbid;
    await db
      .insert(recordingReleaseGroupsTable)
      .values({
        recordingMbid,
        releaseGroupMbid: group.releaseGroupMbid,
        isPrimary,
        title: group.title,
        primaryType: group.primaryType,
        releaseYear: group.releaseYear,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          recordingReleaseGroupsTable.recordingMbid,
          recordingReleaseGroupsTable.releaseGroupMbid,
        ],
        set: {
          isPrimary,
          title: group.title,
          primaryType: group.primaryType,
          releaseYear: group.releaseYear,
          fetchedAt: new Date(),
        },
      });
  }
}

/**
 * Resolve release metadata for the given recording MBIDs. Every requested
 * MBID gets an explicit entry (null = no data, safe to stop asking this
 * session). Reads the bridge table first; misses are hydrated from MB in
 * paced batches and persisted. Hydration needs MUSICBRAINZ_CONTACT — without
 * it the function serves the cache only.
 */
export async function resolveReleaseMetadata(
  mbids: string[],
): Promise<Record<string, ReleaseMetadataResult | null>> {
  const result: Record<string, ReleaseMetadataResult | null> = {};
  const unique = [...new Set(mbids.map((m) => m.trim()).filter(Boolean))];
  if (unique.length === 0) return result;

  const cached = await db
    .select({
      recordingMbid: recordingReleaseGroupsTable.recordingMbid,
      title: recordingReleaseGroupsTable.title,
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
    })
    .from(recordingReleaseGroupsTable)
    .where(and(
      inArray(recordingReleaseGroupsTable.recordingMbid, unique),
      eq(recordingReleaseGroupsTable.isPrimary, true),
    ));
  const missing: string[] = [];
  for (const mbid of unique) {
    const hit = cached.find((row) => row.recordingMbid === mbid);
    if (hit?.title && hit.releaseGroupMbid) {
      result[mbid] = { title: hit.title, releaseGroupMbid: hit.releaseGroupMbid };
    } else {
      result[mbid] = null;
      missing.push(mbid);
    }
  }
  if (missing.length === 0) return result;

  const now = Date.now();
  const eligible = missing.filter((mbid) => {
    if (!MBID_RE.test(mbid)) return false;
    const missAt = negativeCache.get(mbid);
    if (missAt !== undefined) {
      if (now - missAt < NEGATIVE_TTL_MS) return false;
      negativeCache.delete(mbid);
    }
    return true;
  });

  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (eligible.length === 0 || !contact) return result;

  // The bridge table has an FK to recordings — only upsert ids we actually
  // hold, or a stray client-supplied id would 23503 the whole batch.
  const held = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(inArray(recordingsTable.mbid, eligible));
  const fetchable = held.map((row) => row.mbid);

  for (let i = 0; i < fetchable.length; i += SEARCH_CHUNK) {
    const chunk = fetchable.slice(i, i + SEARCH_CHUNK);
    const requested = new Set(chunk);
    const query = chunk.map((mbid) => `rid:${mbid}`).join(" OR ");
    const url = `${MB_BASE}/recording/?query=${encodeURIComponent(query)}&inc=releases+release-groups&fmt=json&limit=100`;
    let parsed: Map<string, ParsedRecording> | null = null;
    try {
      const res = await mbSearchFetch(url, contact);
      if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
      parsed = parseRecordingSearchResults(await res.json(), requested);
    } catch (err) {
      // Transient failure — do NOT negative-cache, so the next load retries.
      console.warn("[release-metadata] MB batch lookup failed", err);
    }
    for (const mbid of chunk) {
      const hit = parsed?.get(mbid);
      if (hit?.primary) {
        result[mbid] = hit.primary;
      } else if (parsed) {
        // Definitive miss: MB answered but has no usable group for this id.
        if (negativeCache.size >= MAX_NEGATIVE_ENTRIES) negativeCache.clear();
        negativeCache.set(mbid, Date.now());
      }
    }
    if (parsed) {
      for (const [recordingMbid, recording] of parsed) {
        if (recording.groups.length === 0) continue;
        try {
          await upsertReleaseGroups(recordingMbid, recording);
        } catch (err) {
          console.warn(`[release-metadata] upsert failed for ${recordingMbid}`, err);
        }
      }
    }
  }
  return result;
}
