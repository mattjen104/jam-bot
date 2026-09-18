export const ROCKSKY_COMPATIBILITY_SCHEMA_VERSION = 1;
export const ROCKSKY_API = "https://api.rocksky.app/xrpc";

export type RockskyLookupMethod = "mbid" | "isrc";
export type RockskyMatchClass =
  | "exact"
  | "compatible"
  | "identifier_conflict"
  | "ambiguous"
  | "candidate_only"
  | "no_match"
  | "unavailable";

export interface RockskyManifestItem {
  sampleId: string;
  stratum:
    | "recording_id"
    | "isrc"
    | "text"
    | "unresolved"
    | "library"
    | "difficult";
  spinId: number;
  stationId: number;
  playedAt: string;
  confidence: string;
  rawArtist: string | null;
  rawTitle: string | null;
  mbid: string | null;
  isrc: string | null;
  recordingArtist: string | null;
  recordingTitle: string | null;
  durationMs: number | null;
  activeLibraryItem: boolean;
}

export interface RockskyManifest {
  schemaVersion: 1;
  generatedAt: string;
  method: "deterministic_stratified_hash_v1";
  targetPerStratum: number;
  productionWrites: 0;
  items: RockskyManifestItem[];
}

export interface RockskySong {
  id?: string;
  uri?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  mbid?: string;
  mbId?: string;
  isrc?: string;
  spotifyLink?: string | null;
  appleMusicLink?: string | null;
  tidalLink?: string | null;
  youtubeLink?: string | null;
  [key: string]: unknown;
}

export interface RockskyCompatibilityObservation {
  schemaVersion: 1;
  runId: string;
  sampleId: string;
  stratum: RockskyManifestItem["stratum"];
  method: RockskyLookupMethod;
  queriedIdentifier: string;
  observedAt: string;
  elapsedMs: number;
  requestBytes: number;
  httpStatus?: number;
  matchClass: RockskyMatchClass;
  song: RockskySong | null;
  conflicts: string[];
  error?: string;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function rockskyMbid(song: RockskySong): string | undefined {
  return clean(song.mbid) ?? clean(song.mbId);
}

export function classifyRockskySong(
  item: RockskyManifestItem,
  method: RockskyLookupMethod,
  queriedIdentifier: string,
  song: RockskySong | null,
): { matchClass: RockskyMatchClass; conflicts: string[] } {
  if (!song || Object.keys(song).length === 0) {
    return { matchClass: "no_match", conflicts: [] };
  }

  const conflicts: string[] = [];
  const returnedMbid = rockskyMbid(song);
  const returnedIsrc = clean(song.isrc)?.toUpperCase();
  if (method === "mbid" && returnedMbid && returnedMbid !== queriedIdentifier) {
    conflicts.push("mbid");
  }
  if (method === "isrc" && returnedIsrc && returnedIsrc !== queriedIdentifier.toUpperCase()) {
    conflicts.push("isrc");
  }
  if (item.mbid && returnedMbid && item.mbid !== returnedMbid) conflicts.push("lore_mbid");
  if (item.isrc && returnedIsrc && item.isrc.toUpperCase() !== returnedIsrc) {
    conflicts.push("lore_isrc");
  }
  if (conflicts.length) {
    return { matchClass: "identifier_conflict", conflicts: [...new Set(conflicts)] };
  }

  const expectedArtist = normalized(item.recordingArtist ?? item.rawArtist);
  const expectedTitle = normalized(item.recordingTitle ?? item.rawTitle);
  const artistAgrees = Boolean(expectedArtist && expectedArtist === normalized(song.artist));
  const titleAgrees = Boolean(expectedTitle && expectedTitle === normalized(song.title));
  const identifierAgrees =
    (method === "mbid" && returnedMbid === queriedIdentifier) ||
    (method === "isrc" && returnedIsrc === queriedIdentifier.toUpperCase());

  if (identifierAgrees && artistAgrees && titleAgrees) {
    return { matchClass: "exact", conflicts: [] };
  }
  if (identifierAgrees) {
    return { matchClass: "compatible", conflicts: [] };
  }
  return { matchClass: "candidate_only", conflicts: [] };
}

export async function lookupRockskySong(
  item: RockskyManifestItem,
  method: RockskyLookupMethod,
  runId: string,
  timeoutMs = 10_000,
  fetchFn: typeof fetch = fetch,
): Promise<RockskyCompatibilityObservation> {
  const queriedIdentifier = method === "mbid" ? item.mbid : item.isrc;
  if (!queriedIdentifier) {
    throw new Error(`Sample ${item.sampleId} has no ${method}`);
  }
  const url = new URL(`${ROCKSKY_API}/app.rocksky.song.getSong`);
  url.searchParams.set(method, queriedIdentifier);
  const started = performance.now();
  const observedAt = new Date().toISOString();
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json", "User-Agent": "Lore-Rocksky-Compatibility/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const song = response.ok && text ? JSON.parse(text) as RockskySong : null;
    const classified = response.status === 404
      ? { matchClass: "no_match" as const, conflicts: [] }
      : response.ok
        ? classifyRockskySong(item, method, queriedIdentifier, song)
        : { matchClass: "unavailable" as const, conflicts: [] };
    return {
      schemaVersion: ROCKSKY_COMPATIBILITY_SCHEMA_VERSION,
      runId,
      sampleId: item.sampleId,
      stratum: item.stratum,
      method,
      queriedIdentifier,
      observedAt,
      elapsedMs: Math.round(performance.now() - started),
      requestBytes: Buffer.byteLength(text),
      httpStatus: response.status,
      ...classified,
      song,
      ...(!response.ok && response.status !== 404
        ? { error: `HTTP ${response.status}: ${response.statusText}` }
        : {}),
    };
  } catch (error) {
    return {
      schemaVersion: ROCKSKY_COMPATIBILITY_SCHEMA_VERSION,
      runId,
      sampleId: item.sampleId,
      stratum: item.stratum,
      method,
      queriedIdentifier,
      observedAt,
      elapsedMs: Math.round(performance.now() - started),
      requestBytes: 0,
      matchClass: "unavailable",
      song: null,
      conflicts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
