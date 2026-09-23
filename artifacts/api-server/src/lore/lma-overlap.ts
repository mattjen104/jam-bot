/** Public Archive search only. No listener identifiers or library contents leave this module. */
export type TasteArtist = { name: string; artistMbid: string | null; committed: boolean; evaluation: boolean };
export type ArchiveArtist = TasteArtist & {
  status: "matched" | "uncertain" | "none" | "unavailable";
  concerts: number;
  url: string;
  truncated: boolean;
};
type SearchResult = Pick<ArchiveArtist, "status" | "concerts" | "truncated"> & { identifiers: string[]; checkedAt: string };

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const AUDIO_FORMAT = /^(?:VBR MP3|MP3|Ogg Vorbis|Flac|FLAC|Shorten|WAVE|24bit FLAC)$/i;
const cache = new Map<string, { until: number; result: SearchResult }>();
const inFlight = new Map<string, Promise<SearchResult>>();

export function normalizeArtist(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/&/g, "and")
    .replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function gatherTaste(rows: Array<{ name: string; artistMbid?: string | null; source: "track" | "shelf" | "inbox" | "rotation" | "unresolved" | "passed" }>): TasteArtist[] {
  const found = new Map<string, TasteArtist>();
  for (const row of rows) {
    const name = row.name?.trim();
    const key = normalizeArtist(name ?? "");
    if (!key || key === "various artists" || key === "unknown artist" || name!.length > 120) continue;
    const current = found.get(key) ?? { name: name!, artistMbid: null, committed: false, evaluation: false };
    current.artistMbid ||= row.artistMbid ?? null;
    if (row.source === "track" || row.source === "shelf") current.committed = true;
    if (row.source === "inbox" || row.source === "rotation" || row.source === "unresolved") current.evaluation = true;
    found.set(key, current);
  }
  return [...found.values()].filter((artist) => artist.committed || artist.evaluation)
    .sort((a, b) => Number(b.committed) - Number(a.committed) || a.name.localeCompare(b.name));
}

function archiveQuery(name: string): string {
  // Quoted Lucene phrase, escaping operators and metacharacters.
  const quoted = name.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
  return `collection:etree AND creator:"${quoted}"`;
}

export function archiveUrl(name: string): string {
  return `https://archive.org/search?query=${encodeURIComponent(archiveQuery(name))}`;
}

type SearchDoc = { identifier?: string; creator?: string | string[]; collection?: string | string[]; format?: string | string[]; mediatype?: string };
export function countArchivePage(name: string, docs: SearchDoc[], seen: Set<string>) {
  let ambiguous = false;
  const compact = normalizeArtist(name).replace(/ /g, "");
  for (const doc of docs) {
    if (!doc.identifier || !/^[a-zA-Z0-9._-]+$/.test(doc.identifier)) continue;
    const collections = Array.isArray(doc.collection) ? doc.collection : [doc.collection];
    if (!collections.includes("etree") || doc.mediatype !== "etree") continue;
    const creators = Array.isArray(doc.creator) ? doc.creator : [doc.creator];
    if (!creators.some((creator) => typeof creator === "string" && normalizeArtist(creator) === normalizeArtist(name))) {
      ambiguous = true;
      continue;
    }
    const formats = Array.isArray(doc.format) ? doc.format : [doc.format];
    if (!formats.some((format) => typeof format === "string" && AUDIO_FORMAT.test(format))) continue;
    // etree membership plus creator alone can collide with namesakes. The
    // artist's own LMA collection is stronger identity evidence.
    if (collections.some((collection) => typeof collection === "string" && collection !== "etree" &&
      normalizeArtist(collection).replace(/ /g, "") === compact)) seen.add(doc.identifier);
    else ambiguous = true;
  }
  return ambiguous;
}

export async function searchArchive(name: string, fetcher: typeof fetch = fetch): Promise<SearchResult> {
  const key = normalizeArtist(name);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = searchArchiveUncached(name, fetcher);
  inFlight.set(key, request);
  try {
    const result = await request;
    if (cache.size > 1000) cache.clear();
    cache.set(key, { result, until: Date.now() + (result.status === "unavailable" || result.truncated ? 60_000 : 6 * 60 * 60_000) });
    return result;
  } finally {
    inFlight.delete(key);
  }
}

async function searchArchiveUncached(name: string, fetcher: typeof fetch): Promise<SearchResult> {
  const seen = new Set<string>();
  let ambiguous = false;
  let truncated = false;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        q: archiveQuery(name), rows: String(PAGE_SIZE), start: String(page * PAGE_SIZE), output: "json",
      });
      for (const field of ["identifier", "creator", "collection", "format", "mediatype"]) params.append("fl[]", field);
      const response = await fetcher(`https://archive.org/advancedsearch.php?${params}`, {
        headers: { "User-Agent": "LoreRadio/1.0 (read-only LMA overlap)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(`Archive search HTTP ${response.status}`);
      const body = await response.json() as { response?: { numFound?: number; docs?: SearchDoc[] } };
      if (!body.response || !Array.isArray(body.response.docs) || !Number.isFinite(body.response.numFound)) throw new Error("Invalid Archive response");
      ambiguous ||= countArchivePage(name, body.response.docs, seen);
      if (body.response.numFound! <= (page + 1) * PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    const result = { status: (seen.size ? "matched" : ambiguous ? "uncertain" : "none") as ArchiveArtist["status"], concerts: seen.size, truncated, identifiers: [...seen], checkedAt: new Date().toISOString() };
    return result;
  } catch {
    // Retain already verified items, but never present a failed search as a complete zero.
    return { status: seen.size ? "matched" : "unavailable", concerts: seen.size, truncated: true, identifiers: [...seen], checkedAt: new Date().toISOString() };
  }
}

export async function buildOverlap(
  artists: TasteArtist[],
  lookup: (name: string) => Promise<SearchResult> = searchArchive,
  onProgress?: (report: OverlapReport) => void,
) {
  const results: Array<ArchiveArtist & { identifiers: string[]; checkedAt: string }> = [];
  for (let i = 0; i < artists.length; i += 4) {
    results.push(...await Promise.all(artists.slice(i, i + 4).map(async (artist) => ({
      ...artist, ...await lookup(artist.name), url: archiveUrl(artist.name),
    }))));
    onProgress?.(summarizeOverlap(artists.length, results));
  }
  return summarizeOverlap(artists.length, results);
}

function summarizeOverlap(artistsTotal: number, results: Array<ArchiveArtist & { identifiers: string[]; checkedAt: string }>) {
  results.sort((a, b) => b.concerts - a.concerts || a.name.localeCompare(b.name));
  const committed = new Set<string>();
  const evaluation = new Set<string>();
  for (const artist of results) {
    if (artist.status !== "matched") continue;
    for (const id of artist.identifiers) (artist.committed ? committed : evaluation).add(id);
  }
  for (const id of committed) evaluation.delete(id);
  return {
    checkedAt: results.length ? results.map((item) => item.checkedAt).sort()[0]! : new Date().toISOString(),
    artistsTotal,
    artistsChecked: results.length,
    matchedArtists: results.filter((a) => a.status === "matched" && a.concerts > 0).length,
    // Cross-artist duplicates are rare but can exist. This is an upper bound if
    // the same Archive identifier is attributed to multiple artists.
    concerts: committed.size,
    evaluationConcerts: evaluation.size,
    partial: artistsTotal > results.length || results.some((a) => a.truncated || a.status === "unavailable"),
    artists: results.map(({ identifiers: _identifiers, checkedAt: _checkedAt, ...artist }) => artist),
  };
}

export type OverlapReport = ReturnType<typeof summarizeOverlap>;