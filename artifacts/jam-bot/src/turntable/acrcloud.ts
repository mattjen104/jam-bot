import { createHmac } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Minimal, vendored ACRCloud "identify" client.
 *
 * We deliberately do NOT depend on the `acrcloud` npm package: it's a thin,
 * stale wrapper around the same HMAC-signed multipart POST we build here, and
 * vendoring keeps the supply-chain surface (and the 1-day release-age gate in
 * pnpm-workspace.yaml) out of the hot path. The signing + request shape is
 * documented at https://docs.acrcloud.com/reference/identification-api.
 *
 * Audio is sent ONLY for identification. ACRCloud fingerprints the clip and
 * returns metadata (title/artist/ISRC/offset); the raw audio is never stored
 * or redistributed by this bot.
 */

const DATA_TYPE = "audio";
const SIGNATURE_VERSION = "1";
const ENDPOINT = "/v1/identify";

export interface AcrMatch {
  /** ACRCloud's own id for the recording — stable per fingerprint. */
  acrid: string;
  title: string;
  artist: string;
  album: string;
  /** International Standard Recording Code, when ACRCloud has one. */
  isrc?: string;
  /**
   * Offset (ms) into the master recording that the *start* of the submitted
   * clip corresponds to. This is the anchor for clock-based sync: it tells us
   * how far into the track the analog source was when the clip began.
   */
  playOffsetMs: number;
  /** ACRCloud match confidence score (0-100), when present. */
  score?: number;
}

/**
 * Build the base64 HMAC-SHA1 signature ACRCloud expects, plus the exact
 * string that was signed (returned for testability). Pure — no I/O — so the
 * signing can be locked down with a known vector in tests.
 */
export function signAcrRequest(args: {
  accessKey: string;
  accessSecret: string;
  timestamp: number;
  method?: string;
  endpoint?: string;
  dataType?: string;
  signatureVersion?: string;
}): { signature: string; stringToSign: string } {
  const {
    accessKey,
    accessSecret,
    timestamp,
    method = "POST",
    endpoint = ENDPOINT,
    dataType = DATA_TYPE,
    signatureVersion = SIGNATURE_VERSION,
  } = args;
  const stringToSign = [
    method,
    endpoint,
    accessKey,
    dataType,
    signatureVersion,
    String(timestamp),
  ].join("\n");
  const signature = createHmac("sha1", accessSecret)
    .update(Buffer.from(stringToSign, "utf-8"))
    .digest("base64");
  return { signature, stringToSign };
}

/**
 * Parse an ACRCloud identify response body into our `AcrMatch`, or null when
 * there was no match. Pure, so the (slightly fiddly) shape handling is
 * covered by tests. ACRCloud status codes: 0 = success, 1001 = no result;
 * anything else is an error we surface to the caller.
 */
export function parseAcrResponse(body: unknown): AcrMatch | null {
  const b = body as {
    status?: { code?: number; msg?: string };
    metadata?: {
      music?: Array<{
        acrid?: string;
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
  if (code === 1001) return null; // explicit "no result"
  if (code !== 0) {
    throw new Error(
      `ACRCloud error ${code ?? "?"}: ${b?.status?.msg ?? "unknown"}`,
    );
  }
  const music = b?.metadata?.music?.[0];
  if (!music) return null;
  const artist =
    (music.artists ?? [])
      .map((a) => a?.name)
      .filter((n): n is string => !!n)
      .join(", ") || "Unknown artist";
  return {
    acrid: music.acrid ?? "",
    title: music.title ?? "Unknown title",
    artist,
    album: music.album?.name ?? "",
    isrc: music.external_ids?.isrc || undefined,
    playOffsetMs: Math.max(0, Math.round(music.play_offset_ms ?? 0)),
    score: typeof music.score === "number" ? music.score : undefined,
  };
}

export interface AcrCredentials {
  host: string;
  accessKey: string;
  accessSecret: string;
}

/**
 * Returns the configured ACRCloud credentials, or null if the feature isn't
 * fully configured. Used to gate the whole turntable feature without throwing.
 */
export function acrCredentials(): AcrCredentials | null {
  const host = config.ACRCLOUD_HOST;
  const accessKey = config.ACRCLOUD_ACCESS_KEY;
  const accessSecret = config.ACRCLOUD_ACCESS_SECRET;
  if (!host || !accessKey || !accessSecret) return null;
  return { host, accessKey, accessSecret };
}

const IDENTIFY_TIMEOUT_MS = 15_000;

/**
 * Fingerprint a clip against ACRCloud and return the best match (or null for
 * "no match"). Throws on transport/credential/quota errors so the caller can
 * decide whether to surface or swallow them. `sample` should be a short
 * (~5-10s) PCM/WAV/MP3 clip — ACRCloud accepts raw audio bytes.
 */
export async function identifyAudio(
  sample: Buffer,
  creds: AcrCredentials | null = acrCredentials(),
): Promise<AcrMatch | null> {
  if (!creds) throw new Error("ACRCloud is not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const { signature } = signAcrRequest({
    accessKey: creds.accessKey,
    accessSecret: creds.accessSecret,
    timestamp,
  });

  const form = new FormData();
  form.append("access_key", creds.accessKey);
  form.append("data_type", DATA_TYPE);
  form.append("signature_version", SIGNATURE_VERSION);
  form.append("signature", signature);
  form.append("timestamp", String(timestamp));
  form.append("sample_bytes", String(sample.length));
  // Wrap the bytes in a Blob so undici sends them as a file part. The byte
  // copy keeps a Buffer-backed view from leaking its full pool into the part.
  form.append(
    "sample",
    new Blob([new Uint8Array(sample)], { type: "application/octet-stream" }),
    "sample",
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://${creds.host}${ENDPOINT}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`ACRCloud request failed: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`ACRCloud HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const match = parseAcrResponse(json);
  logger.debug("ACRCloud identify result", {
    matched: !!match,
    title: match?.title,
    offsetMs: match?.playOffsetMs,
  });
  return match;
}
