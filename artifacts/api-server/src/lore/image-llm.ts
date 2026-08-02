/**
 * Small, provider-independent seam for extracting music rows from screenshots.
 * Keeping validation here makes the endpoint safe to exercise without making a
 * provider call and keeps model output from becoming library metadata directly.
 */
export interface ImageTrackRow {
  artist: string;
  title: string;
  confidence: number;
}

export interface ImageExtractor {
  (image: {
    data: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  }): Promise<string>;
}

let extractor: ImageExtractor | null = null;

export function configureImageExtractor(fn: ImageExtractor): void {
  extractor = fn;
}

export function resetImageExtractor(): void {
  extractor = null;
}

export async function extractImageRaw(image: Parameters<ImageExtractor>[0]): Promise<string> {
  if (!extractor) {
    throw new Error("image-llm: no extractor configured");
  }
  return extractor(image);
}

const MIN_CONFIDENCE = 0.65;
const MAX_TEXT_LENGTH = 240;
const UI_NOISE = /^(track|title|artist|artists|album|albums|library|playlist|search|home|back|next|previous|play|pause|shuffle|queue|recently played|liked songs|your library|add to|more|options|open|close)$/i;

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH)
    : "";
}

function parseRows(raw: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim());
  } catch {
    throw new Error("OCR provider returned malformed JSON");
  }
  if (!Array.isArray(value)) throw new Error("OCR provider returned a non-list response");
  return value;
}

/**
 * Normalize the deliberately narrow provider contract. Invalid rows and low
 * confidence guesses are omitted, while an empty valid array remains valid.
 */
export function normalizeImageRows(raw: string): ImageTrackRow[] {
  const rows = parseRows(raw);
  const seen = new Set<string>();
  const normalized: ImageTrackRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    const artist = cleanText(candidate.artist);
    const title = cleanText(candidate.title);
    const confidence = typeof candidate.confidence === "number"
      ? candidate.confidence
      : Number(candidate.confidence);
    if (
      !artist ||
      !title ||
      !Number.isFinite(confidence) ||
      confidence < MIN_CONFIDENCE ||
      confidence > 1 ||
      UI_NOISE.test(artist) ||
      artist.length < 2 ||
      title.length < 2
    ) continue;
    const key = `${artist.toLocaleLowerCase()}\u001f${title.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ artist, title, confidence: Math.round(confidence * 100) / 100 });
  }
  return normalized;
}

export const IMAGE_OCR_PROMPT = `Read the visible music library rows in this screenshot.
Return ONLY a JSON array. Each item must be {"artist":"...","title":"...","confidence":0.0}.
Use confidence from 0 to 1. Include only clear song rows. Ignore headers, navigation,
album art text, timestamps, row numbers, buttons, menus, and other interface text.
Do not infer missing text, invent rows, or include albums without a visible track title.
An unreadable or non-music screenshot should return [].`;