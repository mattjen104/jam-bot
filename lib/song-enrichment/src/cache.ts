/**
 * Injectable cache for enrichment payloads.
 *
 * The enrichment modules cache their serialized JSON payloads keyed by a stable
 * cache key, with a TTL. jam-bot backs this with its sqlite `db.ts` (so the bot
 * keeps a persistent, shared cache); other hosts (the API server, tests without
 * wiring) fall back to the bundled in-memory store. The signatures mirror
 * jam-bot's db helpers exactly so the moved modules need no body changes.
 */
export interface EnrichmentCacheStore {
  getTrackKnowledge(cacheKey: string, ttlMs: number, nowMs?: number): string | null;
  setTrackKnowledge(cacheKey: string, payload: string, nowMs?: number): void;
  getTrackContext(cacheKey: string, ttlMs: number, nowMs?: number): string | null;
  setTrackContext(cacheKey: string, payload: string, nowMs?: number): void;
}

function createInMemoryStore(): EnrichmentCacheStore {
  const knowledge = new Map<string, { payload: string; fetchedAtMs: number }>();
  const context = new Map<string, { payload: string; fetchedAtMs: number }>();

  function get(
    map: Map<string, { payload: string; fetchedAtMs: number }>,
    cacheKey: string,
    ttlMs: number,
    nowMs: number,
  ): string | null {
    const row = map.get(cacheKey);
    if (!row) return null;
    if (nowMs - row.fetchedAtMs > ttlMs) return null;
    return row.payload;
  }

  return {
    getTrackKnowledge: (cacheKey, ttlMs, nowMs = Date.now()) =>
      get(knowledge, cacheKey, ttlMs, nowMs),
    setTrackKnowledge: (cacheKey, payload, nowMs = Date.now()) => {
      knowledge.set(cacheKey, { payload, fetchedAtMs: nowMs });
    },
    getTrackContext: (cacheKey, ttlMs, nowMs = Date.now()) =>
      get(context, cacheKey, ttlMs, nowMs),
    setTrackContext: (cacheKey, payload, nowMs = Date.now()) => {
      context.set(cacheKey, { payload, fetchedAtMs: nowMs });
    },
  };
}

let active: EnrichmentCacheStore = createInMemoryStore();

export function configureEnrichmentCache(store: EnrichmentCacheStore): void {
  active = store;
}

export function getTrackKnowledge(
  cacheKey: string,
  ttlMs: number,
  nowMs: number = Date.now(),
): string | null {
  return active.getTrackKnowledge(cacheKey, ttlMs, nowMs);
}

export function setTrackKnowledge(
  cacheKey: string,
  payload: string,
  nowMs: number = Date.now(),
): void {
  active.setTrackKnowledge(cacheKey, payload, nowMs);
}

export function getTrackContext(
  cacheKey: string,
  ttlMs: number,
  nowMs: number = Date.now(),
): string | null {
  return active.getTrackContext(cacheKey, ttlMs, nowMs);
}

export function setTrackContext(
  cacheKey: string,
  payload: string,
  nowMs: number = Date.now(),
): void {
  active.setTrackContext(cacheKey, payload, nowMs);
}
