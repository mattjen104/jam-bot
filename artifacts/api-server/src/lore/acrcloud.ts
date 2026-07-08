import { createHmac } from "node:crypto";

/**
 * Minimal ACRCloud "identify" client, vendored from jam-bot/src/turntable/acrcloud.ts.
 *
 * We vendor rather than import across artifacts: separate pnpm packages,
 * separate tsconfig roots. The signing + request shape is documented at
 * https://docs.acrcloud.com/reference/identification-api.
 *
 * Audio is sent ONLY for identification. ACRCloud fingerprints the clip and
 * returns metadata (title/artist/ISRC/offset); the raw audio is never stored
 * or redistributed by this server.
 */

const DATA_TYPE = "audio";
const SIGNATURE_VERSION = "1";
const ENDPOINT = "/v1/identify";
const IDENTIFY_TIMEOUT_MS = 15_000;

export interface AcrMatch {
  title: string;
  artist: string;
  album: string;
  isrc?: string;
  playOffsetMs: number;
  score?: number;
}

export interface AcrCredentials {
  host: string;
  accessKey: string;
  accessSecret: string;
}

/** Returns configured credentials, or null when the feature isn't configured. */
export function acrCredentials(): AcrCredentials | null {
  const host = process.env["ACRCLOUD_HOST"];
  const accessKey = process.env["ACRCLOUD_ACCESS_KEY"];
  const accessSecret = process.env["ACRCLOUD_ACCESS_SECRET"];
  if (!host || !accessKey || !accessSecret) return null;
  return { host, accessKey, accessSecret };
}

function sign(creds: AcrCredentials, timestamp: number): string {
  const str = [
    "POST",
    ENDPOINT,
    creds.accessKey,
    DATA_TYPE,
    SIGNATURE_VERSION,
    String(timestamp),
  ].join("\n");
  return createHmac("sha1", creds.accessSecret)
    .update(Buffer.from(str, "utf-8"))
    .digest("base64");
}

function parse(body: unknown): AcrMatch | null {
  const b = body as {
    status?: { code?: number; msg?: string };
    metadata?: {
      music?: Array<{
        title?: string;
        artists?: Array<{ name?: string }>;
        album?: { name?: string };
        external_ids?: { isrc?: string };
        play_offset_ms?: number;
        score?: number;
      }>;
    };
  };
  const code = b?.status?.code;
  if (code === 1001) return null;
  if (code !== 0) {
    throw new Error(`ACRCloud error ${code ?? "?"}: ${b?.status?.msg ?? "unknown"}`);
  }
  const music = b?.metadata?.music?.[0];
  if (!music) return null;
  const artist =
    (music.artists ?? [])
      .map((a) => a?.name)
      .filter((n): n is string => !!n)
      .join(", ") || "";
  return {
    title: music.title ?? "",
    artist,
    album: music.album?.name ?? "",
    isrc: music.external_ids?.isrc || undefined,
    playOffsetMs: Math.max(0, Math.round(music.play_offset_ms ?? 0)),
    score: typeof music.score === "number" ? music.score : undefined,
  };
}

/**
 * Fingerprint a raw audio clip against ACRCloud. `sample` should be ~5–10 s
 * of MP3/PCM bytes. Returns null on "no match"; throws on transport errors.
 */
export async function identifyAudio(
  sample: Buffer,
  creds: AcrCredentials = acrCredentials()!,
): Promise<AcrMatch | null> {
  if (!creds) throw new Error("ACRCloud is not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = sign(creds, timestamp);

  const form = new FormData();
  form.append("access_key", creds.accessKey);
  form.append("data_type", DATA_TYPE);
  form.append("signature_version", SIGNATURE_VERSION);
  form.append("signature", sig);
  form.append("timestamp", String(timestamp));
  form.append("sample_bytes", String(sample.length));
  form.append(
    "sample",
    new Blob([new Uint8Array(sample)], { type: "application/octet-stream" }),
    "sample",
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${creds.host}${ENDPOINT}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ACRCloud HTTP ${res.status} ${res.statusText}`);
    return parse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
