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
  try {
    const hash = artUrlHash(url);
    const file = getBucket().file(`${ART_PREFIX}${hash}`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [data] = await file.download();
    const [meta] = await file.getMetadata();
    return {
      data: data as Buffer,
      contentType: (meta.contentType as string | undefined) ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

/** Write a blob to Object Storage. Best-effort — never throws. */
export async function artPut(
  url: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  try {
    const hash = artUrlHash(url);
    const file = getBucket().file(`${ART_PREFIX}${hash}`);
    await file.save(data, {
      metadata: { contentType },
      resumable: false,
    });
  } catch (err) {
    console.error("[art-storage] write failed", err);
  }
}
