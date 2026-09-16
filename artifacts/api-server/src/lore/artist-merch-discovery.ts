import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  normalizeApprovedMerchSourceTarget,
  upsertArtistMerchSourceTarget,
  type MerchSource,
} from "./artist-merch.js";

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_MIN_INTERVAL_MS = 1_100;
const FETCH_TIMEOUT_MS = 12_000;
const DISCOVERY_BATCH_SIZE = 12;
const DISCOVERY_INTERVAL_MS = 30 * 60_000;
const DISCOVERY_WARMUP_MS = 45_000;
const SUCCESS_REFRESH_MS = 30 * 24 * 60 * 60_000;
const NOT_FOUND_REFRESH_MS = 7 * 24 * 60 * 60_000;
const ERROR_RETRY_MS = 60 * 60_000;
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type MbArtistRelation = {
  type?: string;
  url?: { resource?: string };
};
type MbArtistResponse = {
  id?: string;
  relations?: MbArtistRelation[];
};

export type AutomaticMerchSource = {
  sourceUrl: string;
  source: MerchSource;
};

let fetchImpl: FetchLike = (url, init) => fetch(url, init);
let mbChain: Promise<unknown> = Promise.resolve();
let lastMbRequestAt = 0;
let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
let discoveryRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function __setArtistMerchDiscoveryFetchForTests(fn: FetchLike | null): void {
  fetchImpl = fn ?? ((url, init) => fetch(url, init));
}

export function __resetArtistMerchDiscoveryForTests(): void {
  mbChain = Promise.resolve();
  lastMbRequestAt = 0;
}

export function automaticMerchSourceForUrl(value: string): AutomaticMerchSource | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  url.search = "";
  url.hash = "";
  const host = url.hostname.toLowerCase();
  if (host === "bandcamp.com" || host.endsWith(".bandcamp.com")) {
    return { sourceUrl: url.toString(), source: "bandcamp" };
  }
  if (host.endsWith(".myshopify.com")) {
    url.pathname = "/";
    return { sourceUrl: url.toString(), source: "artist_store" };
  }
  return null;
}

export function parseAutomaticMerchSources(payload: MbArtistResponse): AutomaticMerchSource[] {
  const seen = new Set<string>();
  const sources: AutomaticMerchSource[] = [];
  for (const relation of payload.relations ?? []) {
    const resource = relation.url?.resource;
    if (!resource) continue;
    const source = automaticMerchSourceForUrl(resource);
    if (!source || seen.has(source.sourceUrl)) continue;
    seen.add(source.sourceUrl);
    sources.push(source);
  }
  return sources;
}

async function pacedMusicBrainzFetch(artistMbid: string, contact: string): Promise<Response> {
  const run = mbChain.then(async () => {
    const wait = Math.max(0, MB_MIN_INTERVAL_MS - (Date.now() - lastMbRequestAt));
    if (wait > 0) await sleep(wait);
    lastMbRequestAt = Date.now();
    return fetchImpl(
      `${MB_BASE}/artist/${encodeURIComponent(artistMbid)}?inc=url-rels&fmt=json`,
      {
        headers: {
          "User-Agent": `LoreRadio/1.0 (${contact})`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  });
  mbChain = run.catch(() => undefined);
  return run;
}

async function dueLibraryArtistMbids(limit = DISCOVERY_BATCH_SIZE): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT r.artist_mbid AS "artistMbid"
    FROM library_items li
    INNER JOIN recordings r ON r.mbid = li.mbid
    LEFT JOIN artist_merch_discovery d ON d.artist_mbid = r.artist_mbid
    WHERE li.removed_at IS NULL
      AND r.artist_mbid IS NOT NULL
      AND r.artist_mbid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (d.artist_mbid IS NULL OR d.refresh_after <= now())
    ORDER BY r.artist_mbid
    LIMIT ${limit}
  `);
  return (result.rows as Array<{ artistMbid: string }>).map((row) => row.artistMbid);
}

async function recordDiscoveryResult(input: {
  artistMbid: string;
  now: Date;
  refreshAfter: Date;
  discoveredCount: number;
  error: string | null;
  success: boolean;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO artist_merch_discovery (
      artist_mbid, refresh_after, last_checked_at, last_success_at,
      last_error, discovered_count, updated_at
    ) VALUES (
      ${input.artistMbid}, ${input.refreshAfter}, ${input.now},
      ${input.success ? input.now : null}, ${input.error},
      ${input.discoveredCount}, ${input.now}
    )
    ON CONFLICT (artist_mbid) DO UPDATE SET
      refresh_after = excluded.refresh_after,
      last_checked_at = excluded.last_checked_at,
      last_success_at = CASE
        WHEN ${input.success} THEN excluded.last_success_at
        ELSE artist_merch_discovery.last_success_at
      END,
      last_error = excluded.last_error,
      discovered_count = CASE
        WHEN ${input.success} THEN excluded.discovered_count
        ELSE artist_merch_discovery.discovered_count
      END,
      updated_at = excluded.updated_at
  `);
}

export async function discoverArtistMerchSources(
  artistMbid: string,
  contact = process.env["MUSICBRAINZ_CONTACT"]?.trim() ?? "",
): Promise<number> {
  if (!contact || !MBID_RE.test(artistMbid)) return 0;
  const now = new Date();
  try {
    const response = await pacedMusicBrainzFetch(artistMbid, contact);
    if (response.status === 404) {
      await recordDiscoveryResult({
        artistMbid,
        now,
        refreshAfter: new Date(now.getTime() + NOT_FOUND_REFRESH_MS),
        discoveredCount: 0,
        error: null,
        success: true,
      });
      return 0;
    }
    if (!response.ok) throw new Error(`MusicBrainz artist URLs returned ${response.status}`);
    const payload = await response.json() as MbArtistResponse;
    const sources = parseAutomaticMerchSources(payload);
    let enrolled = 0;
    for (const source of sources) {
      const target = normalizeApprovedMerchSourceTarget({
        artistMbid,
        ...source,
      });
      if (!target) continue;
      await upsertArtistMerchSourceTarget({ ...target, status: "active" });
      enrolled++;
    }
    await recordDiscoveryResult({
      artistMbid,
      now,
      refreshAfter: new Date(now.getTime() + SUCCESS_REFRESH_MS),
      discoveredCount: enrolled,
      error: null,
      success: true,
    });
    return enrolled;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordDiscoveryResult({
      artistMbid,
      now,
      refreshAfter: new Date(now.getTime() + ERROR_RETRY_MS),
      discoveredCount: 0,
      error: message.slice(0, 500),
      success: false,
    });
    return 0;
  }
}

export async function refreshDueLibraryArtistMerchDiscovery(): Promise<void> {
  if (discoveryRunning || !process.env["MUSICBRAINZ_CONTACT"]?.trim()) return;
  discoveryRunning = true;
  try {
    for (const artistMbid of await dueLibraryArtistMbids()) {
      await discoverArtistMerchSources(artistMbid);
    }
  } finally {
    discoveryRunning = false;
  }
}

export function startArtistMerchDiscoveryPoller(): void {
  if (discoveryTimer || !process.env["MUSICBRAINZ_CONTACT"]?.trim()) return;
  const run = async () => {
    try {
      await refreshDueLibraryArtistMerchDiscovery();
    } catch (error) {
      console.error("[artist-merch-discovery] batch failed", error);
    } finally {
      discoveryTimer = setTimeout(run, DISCOVERY_INTERVAL_MS);
    }
  };
  discoveryTimer = setTimeout(run, DISCOVERY_WARMUP_MS);
}

export function stopArtistMerchDiscoveryPoller(): void {
  if (discoveryTimer) clearTimeout(discoveryTimer);
  discoveryTimer = null;
}