/**
 * List provenance scraper.
 *
 * Given a URL and metadata for a publication list (year-end, all-time, etc.),
 * fetches the HTML, calls an LLM to extract ranked entries, resolves each
 * entry to a MusicBrainz release group MBID, and stores the results in
 * `list_entries` with a confidence flag ready for the admin confirm flow.
 *
 * Only facts are stored (rank, release-group MBID, blurb URL pointer).
 * No editorial prose is ever cached.
 *
 * Rate limiting: MB allows ~1 req/sec. A simple sequential sleep is used
 * because this runs admin-triggered, not on the hot path.
 */

import {
  db,
  listEntriesTable,
  recordingReleaseGroupsTable,
} from "@workspace/db";
import { extractListRaw } from "./list-llm.js";
import { requireSourceUrl } from "./schedule-scraper.js";

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_MIN_INTERVAL_MS = 1100;
const FETCH_TIMEOUT_MS = 15_000;
// Allow up to 400k chars of stripped plain text so large lists (e.g. RS 500)
// are not silently truncated mid-list. Multi-pass extraction then handles
// anything too long for a single LLM call.
const MAX_PAGE_CHARS = 400_000;
// Each LLM chunk is at most this many characters of plain text.
const LLM_CHUNK_SIZE = 40_000;
// Overlap between successive chunks so entries that straddle a boundary are
// not missed. Duplicates are deduplicated after merging.
const LLM_CHUNK_OVERLAP = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Strip HTML to readable plain text (same approach as schedule-scraper). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExtractedEntry {
  rank: number | null;
  artist: string;
  album: string;
}

/**
 * Parse and validate the LLM's raw JSON output into a list of entries.
 * Strips markdown fences, rejects malformed output. Pure, no I/O.
 */
export function parseExtractedEntries(
  raw: string,
): ExtractedEntry[] | null {
  let jsonText = raw.trim();
  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonText = fenced[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const entries: ExtractedEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const artist = typeof o["artist"] === "string" ? o["artist"].trim() : null;
    const album =
      typeof o["album"] === "string"
        ? o["album"].trim()
        : typeof o["title"] === "string"
          ? o["title"].trim()
          : null;
    if (!artist || !album) continue;
    const rank =
      typeof o["rank"] === "number"
        ? o["rank"]
        : typeof o["rank"] === "string"
          ? parseInt(o["rank"], 10) || null
          : null;
    entries.push({ rank, artist, album });
  }
  return entries.length > 0 ? entries : null;
}

export interface ReleaseGroupMatch {
  mbid: string;
  title: string;
  primaryType: string | null;
  /** MB score 0-100. */
  score: number;
  confidence: "exact" | "fuzzy" | "unresolved";
}

/**
 * Search MusicBrainz for a release group by artist + album title.
 * Returns the best match with a confidence tier based on score.
 *
 * Callers are responsible for rate-limiting (call `sleep(1100)` between calls).
 */
export async function lookupReleaseGroup(
  artist: string,
  album: string,
  contact: string,
): Promise<ReleaseGroupMatch | null> {
  const query = `releasegroup:"${album.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`;
  const url = `${MB_BASE}/release-group?query=${encodeURIComponent(query)}&limit=3&fmt=json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": contact, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[list-scraper] MB release-group search ${res.status} for "${album}" by "${artist}"`);
      return null;
    }
    const body = (await res.json()) as {
      "release-groups"?: Array<{
        id?: string;
        title?: string;
        score?: number;
        "primary-type"?: string;
      }>;
    };
    const hits = body["release-groups"] ?? [];
    const best = hits[0];
    if (!best?.id) return null;

    const score = best.score ?? 0;
    const confidence: ReleaseGroupMatch["confidence"] =
      score >= 90 ? "exact" : score >= 60 ? "fuzzy" : "unresolved";

    return {
      mbid: best.id,
      title: best.title ?? album,
      primaryType: best["primary-type"] ?? null,
      score,
      confidence,
    };
  } catch (err) {
    console.warn(`[list-scraper] MB lookup failed for "${album}"`, err);
    return null;
  }
}

export interface RecordingReleaseGroupResult {
  recordingMbid: string;
  inserted: number;
  primaryMbid: string | null;
}

/**
 * Fetch a recording's release groups from MusicBrainz and populate the
 * `recording_release_groups` bridge table (upsert on conflict).
 *
 * Uses `inc=release-groups` on the recording lookup. The "primary" release
 * group is the one with primaryType="Album", no secondary types, and the
 * earliest first-release-date. Singles/EPs/compilations are also stored so
 * that list entries for EPs are still matched.
 *
 * Rate-limit: one 1.1s sleep before the single MB call. Do not call this on
 * the hot path.
 */
export async function enrichRecordingReleaseGroups(
  recordingMbid: string,
  contact: string,
): Promise<RecordingReleaseGroupResult> {
  await sleep(MB_MIN_INTERVAL_MS);

  const url = `${MB_BASE}/recording/${encodeURIComponent(recordingMbid)}?inc=release-groups&fmt=json`;
  let body: unknown;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": contact, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[list-scraper] MB recording lookup ${res.status} for ${recordingMbid}`);
      return { recordingMbid, inserted: 0, primaryMbid: null };
    }
    body = await res.json();
  } catch (err) {
    console.warn(`[list-scraper] MB recording lookup failed for ${recordingMbid}`, err);
    return { recordingMbid, inserted: 0, primaryMbid: null };
  }

  const b = body as {
    releases?: Array<{
      "release-group"?: {
        id?: string;
        title?: string;
        "primary-type"?: string;
        "secondary-types"?: string[];
        "first-release-date"?: string;
      };
    }>;
  };

  // Deduplicate release groups from the releases list.
  const rgMap = new Map<
    string,
    {
      mbid: string;
      title: string | null;
      primaryType: string | null;
      secondaryTypes: string[];
      firstReleaseDate: string | null;
    }
  >();

  for (const release of b?.releases ?? []) {
    const rg = release["release-group"];
    if (!rg?.id) continue;
    if (rgMap.has(rg.id)) continue;
    rgMap.set(rg.id, {
      mbid: rg.id,
      title: rg.title ?? null,
      primaryType: rg["primary-type"] ?? null,
      secondaryTypes: rg["secondary-types"] ?? [],
      firstReleaseDate: rg["first-release-date"] ?? null,
    });
  }

  if (rgMap.size === 0) {
    return { recordingMbid, inserted: 0, primaryMbid: null };
  }

  // Determine primary: Album type + no secondary types + earliest date.
  let primaryMbid: string | null = null;
  let primaryDate: string | null = null;
  for (const rg of rgMap.values()) {
    if (rg.primaryType === "Album" && rg.secondaryTypes.length === 0) {
      if (!primaryMbid || (rg.firstReleaseDate && (!primaryDate || rg.firstReleaseDate < primaryDate))) {
        primaryMbid = rg.mbid;
        primaryDate = rg.firstReleaseDate;
      }
    }
  }

  // Fallback: if no Album type, pick the earliest release group.
  if (!primaryMbid) {
    for (const rg of rgMap.values()) {
      if (!primaryMbid || (rg.firstReleaseDate && (!primaryDate || rg.firstReleaseDate < primaryDate))) {
        primaryMbid = rg.mbid;
        primaryDate = rg.firstReleaseDate;
      }
    }
  }

  let inserted = 0;

  for (const rg of rgMap.values()) {
    const releaseYear = rg.firstReleaseDate
      ? parseInt(rg.firstReleaseDate.slice(0, 4), 10) || null
      : null;
    const result = await db
      .insert(recordingReleaseGroupsTable)
      .values({
        recordingMbid,
        releaseGroupMbid: rg.mbid,
        isPrimary: rg.mbid === primaryMbid,
        title: rg.title,
        primaryType: rg.primaryType,
        releaseYear,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          recordingReleaseGroupsTable.recordingMbid,
          recordingReleaseGroupsTable.releaseGroupMbid,
        ],
        set: {
          isPrimary: rg.mbid === primaryMbid,
          title: rg.title,
          primaryType: rg.primaryType,
          releaseYear,
          fetchedAt: new Date(),
        },
      });
    if (result) inserted++;
  }

  return { recordingMbid, inserted, primaryMbid };
}

export interface ScrapeResult {
  total: number;
  resolved: number;
  fuzzy: number;
  unresolved: number;
  entries: Array<{
    rank: number | null;
    rawArtist: string;
    rawAlbum: string;
    releaseGroupMbid: string;
    confidence: "exact" | "fuzzy" | "unresolved";
  }>;
  error?: string;
}

const LIST_EXTRACTION_PROMPT = `You are extracting a ranked list of albums from the text of a music publication page.
Return ONLY a JSON array — no prose, no explanation. Each item must have:
  "rank": integer or null (null for unranked lists)
  "artist": string (primary performing artist)
  "album": string (album title, not track title)

Rules:
- Only include albums/EPs. Skip tracks, artists without albums, or unclear entries.
- Use the artist's most common name (e.g. "Radiohead" not "Radiohead, The").
- If ranks are clearly present (1., 2., etc.) include them; otherwise set to null.
- Return at most 500 entries.
- If no list is found, return [].

Page text:
`;

/**
 * Extract entries from potentially very long page text using multi-pass chunked
 * LLM extraction. Splits the text into overlapping windows, runs the extraction
 * prompt on each, then merges and deduplicates by rank (ranked lists) or by
 * normalised artist+album identity (unranked lists).
 *
 * A single LLM pass is used when the text fits within one chunk.
 */
export async function extractEntriesMultiPass(
  pageText: string,
): Promise<ExtractedEntry[]> {
  if (pageText.length <= LLM_CHUNK_SIZE) {
    const rawJson = await extractListRaw(LIST_EXTRACTION_PROMPT + pageText);
    return parseExtractedEntries(rawJson) ?? [];
  }

  // Build overlapping chunks so entries that straddle a boundary are not lost.
  const chunks: string[] = [];
  let start = 0;
  while (start < pageText.length) {
    chunks.push(pageText.slice(start, start + LLM_CHUNK_SIZE));
    start += LLM_CHUNK_SIZE - LLM_CHUNK_OVERLAP;
  }

  const merged: ExtractedEntry[] = [];
  // Rank-keyed dedup (primary): covers ranked lists (RS 500, Pitchfork, etc.)
  const seenRanks = new Set<number>();
  // Identity-keyed dedup (fallback): covers unranked or overlap-boundary dups.
  const seenIdentity = new Set<string>();

  for (const chunk of chunks) {
    let entries: ExtractedEntry[];
    try {
      const rawJson = await extractListRaw(LIST_EXTRACTION_PROMPT + chunk);
      entries = parseExtractedEntries(rawJson) ?? [];
    } catch {
      // A single chunk failure is non-fatal; skip and continue.
      continue;
    }
    for (const entry of entries) {
      if (entry.rank != null) {
        if (seenRanks.has(entry.rank)) continue;
        seenRanks.add(entry.rank);
      } else {
        const key = `${entry.artist.toLowerCase().replace(/\s+/g, " ")}|${entry.album.toLowerCase().replace(/\s+/g, " ")}`;
        if (seenIdentity.has(key)) continue;
        seenIdentity.add(key);
      }
      merged.push(entry);
    }
  }

  // Sort ranked entries ascending; unranked entries trail in insertion order.
  merged.sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return 0;
  });

  return merged;
}

/**
 * Fetch a list URL, extract entries via LLM, resolve each to a MB release group,
 * and insert into `list_entries` for the given listId.
 */
export async function scrapeAndPopulateList(
  listId: number,
  url: string,
  contact: string,
): Promise<ScrapeResult> {
  let sourceUrl: string;
  try {
    sourceUrl = requireSourceUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { total: 0, resolved: 0, fuzzy: 0, unresolved: 0, entries: [], error: msg };
  }
  const scrapedAt = new Date();

  let html: string;
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        "User-Agent": contact,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) {
      return { total: 0, resolved: 0, fuzzy: 0, unresolved: 0, entries: [], error: `HTTP ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { total: 0, resolved: 0, fuzzy: 0, unresolved: 0, entries: [], error: msg };
  }

  const pageText = htmlToPlainText(html).slice(0, MAX_PAGE_CHARS);

  let rawEntries: ExtractedEntry[];
  try {
    rawEntries = await extractEntriesMultiPass(pageText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { total: 0, resolved: 0, fuzzy: 0, unresolved: 0, entries: [], error: `LLM extraction failed: ${msg}` };
  }

  if (rawEntries.length === 0) {
    return { total: 0, resolved: 0, fuzzy: 0, unresolved: 0, entries: [], error: "No entries extracted from page" };
  }

  const result: ScrapeResult = {
    total: rawEntries.length,
    resolved: 0,
    fuzzy: 0,
    unresolved: 0,
    entries: [],
  };

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i]!;
    await sleep(MB_MIN_INTERVAL_MS);

    const match = await lookupReleaseGroup(entry.artist, entry.album, contact);

    let mbid: string;
    let confidence: "exact" | "fuzzy" | "unresolved";

    if (match && match.confidence !== "unresolved") {
      mbid = match.mbid;
      confidence = match.confidence;
      if (confidence === "exact") result.resolved++;
      else result.fuzzy++;
    } else if (match) {
      mbid = match.mbid;
      confidence = "unresolved";
      result.unresolved++;
    } else {
      // Use a placeholder so the unique constraint holds; human can correct.
      mbid = `unresolved:${listId}:${i}`;
      confidence = "unresolved";
      result.unresolved++;
    }

    result.entries.push({
      rank: entry.rank,
      rawArtist: entry.artist,
      rawAlbum: entry.album,
      releaseGroupMbid: mbid,
      confidence,
    });

    await db
      .insert(listEntriesTable)
      .values({
        listId,
        releaseGroupMbid: mbid,
        rank: entry.rank,
        rawArtist: entry.artist,
        rawAlbum: entry.album,
        confidence,
        confirmed: confidence === "exact",
        sourceUrl,
        scrapedAt,
        extraction: "llm",
      })
      .onConflictDoNothing();
  }

  return result;
}
