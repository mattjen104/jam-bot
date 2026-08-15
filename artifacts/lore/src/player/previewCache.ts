/**
 * Client-side in-memory cache for iTunes preview lookups, keyed by MBID.
 *
 * The server already caches preview resolutions for seven days, but a scan
 * session loops the same stations and would otherwise re-issue the same
 * network request on every pass. This module guarantees at most one in-flight
 * lookup per MBID (concurrent callers share the promise), remembers positive
 * results and negative results ("no Apple preview"), and bounds its size.
 *
 * Negatives get a shorter TTL than positives so a track that later gains a
 * preview (e.g. the server cache rolled over to a better match) is retried
 * sooner. Only URLs are cached — never audio bytes.
 */
import { getRecordingPreview } from "@workspace/api-client-react";

export interface PreviewResult {
  previewUrl: string | null;
  artworkUrl: string | null;
  source: string | null;
}

/** Positive results (a real preview URL) are kept for 30 minutes. */
export const POSITIVE_TTL_MS = 30 * 60 * 1000;
/** Negative results (no preview found) are kept for 5 minutes. */
export const NEGATIVE_TTL_MS = 5 * 60 * 1000;
/** Hard bound on cache entries; oldest resolved entries evicted first. */
export const MAX_ENTRIES = 300;

type Entry =
  | { kind: "resolved"; value: PreviewResult; at: number }
  | { kind: "inflight"; promise: Promise<PreviewResult> };

const cache = new Map<string, Entry>();

type Fetcher = (mbid: string) => Promise<PreviewResult>;

const defaultFetcher: Fetcher = async (mbid) => {
  const p = await getRecordingPreview(mbid);
  return {
    previewUrl: p.previewUrl ?? null,
    artworkUrl: p.artworkUrl ?? null,
    source: p.source ?? null,
  };
};

function isFresh(e: { value: PreviewResult; at: number }): boolean {
  const ttl = e.value.previewUrl ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  return Date.now() - e.at < ttl;
}

/** Evict oldest RESOLVED entries until under the bound (never in-flight ones). */
function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    if (entry.kind === "resolved") cache.delete(key);
  }
}

/**
 * Resolve a recording's preview through the cache.
 *
 * - Fresh cached result (positive OR negative): returned instantly.
 * - In-flight lookup for the same MBID: the same promise is shared.
 * - Fetch rejection is treated as transient: nothing is cached and the
 *   rejection propagates so callers keep their existing skip behaviour.
 *
 * `fetcher` is injectable for tests; production callers omit it.
 */
export function getPreviewCached(
  mbid: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<PreviewResult> {
  const key = mbid.trim();
  if (!key) return Promise.resolve({ previewUrl: null, artworkUrl: null, source: null });

  const hit = cache.get(key);
  if (hit) {
    if (hit.kind === "inflight") return hit.promise;
    if (isFresh(hit)) {
      // Refresh insertion order so hot entries survive eviction (LRU-ish).
      cache.delete(key);
      cache.set(key, hit);
      return Promise.resolve(hit.value);
    }
    cache.delete(key); // stale — fall through to refetch
  }

  const promise = fetcher(key).then(
    (p) => {
      const value: PreviewResult = {
        previewUrl: p.previewUrl ?? null,
        artworkUrl: p.artworkUrl ?? null,
        source: p.source ?? null,
      };
      cache.set(key, { kind: "resolved", value, at: Date.now() });
      evictIfNeeded();
      return value;
    },
    (err) => {
      // Transient failure — drop the in-flight marker, don't cache a negative.
      cache.delete(key);
      throw err;
    },
  );
  cache.set(key, { kind: "inflight", promise });
  evictIfNeeded();
  return promise;
}

/**
 * Fire-and-forget prefetch of a preview URL only (no audio element, no clip
 * bytes). Used to resolve the NEXT scan candidate while the current one plays.
 */
export function prefetchPreview(mbid: string, fetcher?: Fetcher): void {
  void getPreviewCached(mbid, fetcher).catch(() => {
    /* best-effort — the real lookup will retry when the hop arrives */
  });
}

/** Test/diagnostic helpers. */
export function clearPreviewCache(): void {
  cache.clear();
}

export function previewCacheSize(): number {
  return cache.size;
}
