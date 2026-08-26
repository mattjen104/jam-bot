/* eslint-disable no-console -- pre-lint file: migrate logging to the structured logger on touch */
/**
 * Lightweight GCS helper for the art-proxy cache.
 * Stores image blobs keyed by a SHA-256 hash of the source URL.
 * Does NOT use the full ObjectStorageService — we only need read/write blobs.
 */
import { createHash } from "crypto";
import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
} as ConstructorParameters<typeof Storage>[0]);

function getBucket() {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  return gcs.bucket(bucketId);
}

const ART_PREFIX = "art-proxy/";
const MEMORY_CACHE_MAX_ENTRIES = 512;
const MEMORY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

type MemoryArt = {
  data: Buffer;
  contentType: string;
  cachedAt: number;
};

/**
 * Fast fallback for development and any deployment where App Storage is not
 * configured. Persistent object storage remains the durable cache; this small
 * bounded layer prevents every station mark from re-fetching its origin during
 * a running server session when that durable cache is unavailable.
 */
const memoryArtCache = new Map<string, MemoryArt>();
let warnedMissingBucket = false;

function logStorageFailure(action: string, err: unknown): void {
  if (
    err instanceof Error &&
    err.message.includes("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set")
  ) {
    if (!warnedMissingBucket) {
      warnedMissingBucket = true;
      console.warn(
        "[art-storage] App Storage is unavailable; using the bounded in-memory artwork cache",
      );
    }
    return;
  }
  console.error(`[art-storage] ${action} failed`, err);
}

function memoryGet(url: string): MemoryArt | null {
  const key = artUrlHash(url);
  const entry = memoryArtCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > MEMORY_CACHE_TTL_MS) {
    memoryArtCache.delete(key);
    return null;
  }
  // Refresh LRU position on use.
  memoryArtCache.delete(key);
  memoryArtCache.set(key, entry);
  return entry;
}

function memoryPut(url: string, data: Buffer, contentType: string): void {
  const key = artUrlHash(url);
  memoryArtCache.delete(key);
  memoryArtCache.set(key, { data, contentType, cachedAt: Date.now() });
  while (memoryArtCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    const oldest = memoryArtCache.keys().next().value;
    if (!oldest) break;
    memoryArtCache.delete(oldest);
  }
}

/**
 * Stable URL-safe base64 hash of the source URL — used as the GCS object
 * name and as the cache key in /api/art?src=... lookups.
 */
export function artUrlHash(url: string): string {
  return createHash("sha256")
    .update(url)
    .digest("base64url")
    .slice(0, 32); // 192 bits — collision-safe for artwork volumes
}

/** True when this URL's artwork blob already exists in Object Storage. */
export async function artExists(url: string): Promise<boolean> {
  try {
    const hash = artUrlHash(url);
    const [exists] = await getBucket().file(`${ART_PREFIX}${hash}`).exists();
    return exists;
  } catch {
    return false;
  }
}

/** Read a cached blob. Returns null on miss or error. */
export async function artGet(
  url: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const memory = memoryGet(url);
  if (memory) return memory;

  try {
    const hash = artUrlHash(url);
    const file = getBucket().file(`${ART_PREFIX}${hash}`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [data] = await file.download();
    const [meta] = await file.getMetadata();
    const cached = {
      data: data as Buffer,
      contentType: (meta.contentType as string | undefined) ?? "image/jpeg",
    };
    memoryPut(url, cached.data, cached.contentType);
    return cached;
  } catch {
    return null;
  }
}

/**
 * Delete a cached blob from Object Storage. Best-effort — never throws.
 * Called when a recording's artworkUrl changes so the old immutable blob is
 * evicted and the next /api/art request re-fetches the new cover.
 */
export async function artDelete(url: string): Promise<void> {
  memoryArtCache.delete(artUrlHash(url));
  try {
    const hash = artUrlHash(url);
    const file = getBucket().file(`${ART_PREFIX}${hash}`);
    const [exists] = await file.exists();
    if (exists) await file.delete();
  } catch (err) {
    logStorageFailure("delete", err);
  }
}

/** Write a blob to Object Storage. Best-effort — never throws. */
export async function artPut(
  url: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  memoryPut(url, data, contentType);
  try {
    const hash = artUrlHash(url);
    const file = getBucket().file(`${ART_PREFIX}${hash}`);
    await file.save(data, {
      metadata: { contentType },
      resumable: false,
    });
  } catch (err) {
    logStorageFailure("write", err);
  }
}
