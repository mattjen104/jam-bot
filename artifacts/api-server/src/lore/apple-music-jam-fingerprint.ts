import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  recordingsTable,
  serviceTrackMapTable,
  type AppleJamQueueEntry,
} from "@workspace/db";
import type { FingerprintObservation } from "./apple-music-jam-timing.js";

const ENDPOINT = "/v1/identify";
const IDENTIFY_TIMEOUT_MS = 15_000;

export interface AcrCredentials {
  host: string;
  accessKey: string;
  accessSecret: string;
}

export function acrCredentials(): AcrCredentials | null {
  const host = process.env.ACRCLOUD_HOST?.trim();
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY?.trim();
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET?.trim();
  return host && accessKey && accessSecret ? { host, accessKey, accessSecret } : null;
}

export function signAcrRequest(args: {
  accessKey: string;
  accessSecret: string;
  timestamp: number;
}): string {
  const value = ["POST", ENDPOINT, args.accessKey, "audio", "1", String(args.timestamp)].join("\n");
  return createHmac("sha1", args.accessSecret).update(value).digest("base64");
}

export function parseAcrResponse(body: unknown): FingerprintObservation | null {
  const root = body as {
    status?: { code?: number; msg?: string };
    metadata?: { music?: Array<{
      acrid?: string;
      title?: string;
      artists?: Array<{ name?: string }>;
      external_ids?: { isrc?: string };
      play_offset_ms?: number;
      score?: number;
    }> };
  };
  if (root.status?.code === 1001) return null;
  if (root.status?.code !== 0) {
    throw new Error(`ACRCloud error ${root.status?.code ?? "?"}: ${root.status?.msg ?? "unknown"}`);
  }
  const music = root.metadata?.music?.[0];
  if (!music?.acrid || !music.title) return null;
  const artist = music.artists?.map((item) => item.name).filter(Boolean).join(", ") || "Unknown artist";
  const isrc = music.external_ids?.isrc?.trim() || undefined;
  return {
    key: isrc ? `isrc:${isrc}` : `acrid:${music.acrid}`,
    title: music.title,
    artist,
    isrc,
    playOffsetMs: Math.max(0, Math.round(music.play_offset_ms ?? 0)),
    score: typeof music.score === "number" ? music.score : undefined,
  };
}

export async function identifyRecordClip(
  sample: Buffer,
  creds = acrCredentials(),
): Promise<FingerprintObservation | null> {
  if (!creds) throw new Error("ACRCloud is not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.append("access_key", creds.accessKey);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", signAcrRequest({ ...creds, timestamp }));
  form.append("timestamp", String(timestamp));
  form.append("sample_bytes", String(sample.length));
  form.append("sample", new Blob([new Uint8Array(sample)]), "sample");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${creds.host}${ENDPOINT}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ACRCloud HTTP ${response.status}`);
    return parseAcrResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve only through a strong ISRC -> Lore recording -> exact Apple map.
 * No title search is permitted for record-master playback.
 */
export async function resolveExactAppleTrack(
  observation: FingerprintObservation,
): Promise<AppleJamQueueEntry | null> {
  if (!observation.isrc) return null;
  const [recording] = await db.select({
    mbid: recordingsTable.mbid,
    title: recordingsTable.title,
    artist: recordingsTable.artist,
    artworkUrl: recordingsTable.artworkUrl,
    durationMs: recordingsTable.durationMs,
  }).from(recordingsTable).where(eq(recordingsTable.isrc, observation.isrc)).limit(1);
  if (!recording) return null;
  const [mapping] = await db.select({
    appleMusicId: serviceTrackMapTable.externalId,
    deadLink: serviceTrackMapTable.deadLink,
    confidence: serviceTrackMapTable.confidence,
  }).from(serviceTrackMapTable).where(and(
    eq(serviceTrackMapTable.recordingMbid, recording.mbid),
    eq(serviceTrackMapTable.service, "apple_music"),
  )).limit(1);
  if (!mapping?.appleMusicId || mapping.deadLink || mapping.confidence !== "exact") return null;
  return {
    mbid: recording.mbid,
    title: recording.title,
    artist: recording.artist,
    artworkUrl: recording.artworkUrl,
    appleMusicId: mapping.appleMusicId,
    isrc: observation.isrc,
    durationMs: recording.durationMs,
  };
}