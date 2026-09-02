import type {
  RecordingTextMatch,
  RecordingTextResolutionStatus,
} from "@workspace/song-enrichment";

/**
 * Increment whenever text normalization or the ordered query variants change.
 * The version lives in the cache key so old rows remain available for audit,
 * while stale permanent misses cannot suppress the repaired resolver.
 */
export const RESOLUTION_CACHE_VERSION = 2;

const CACHE_SEPARATOR = "\u001f";

function normalizePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Stable, unversioned pair identity for in-process deduplication. */
export function normalizeMetadataPair(artist: string, title: string): string {
  return `${normalizePart(artist)}${CACHE_SEPARATOR}${normalizePart(title)}`;
}

/** Current resolver-cache key. Older versioned/unversioned rows remain intact. */
export function normalizeKey(artist: string, title: string): string {
  return `v${RESOLUTION_CACHE_VERSION}${CACHE_SEPARATOR}${normalizeMetadataPair(artist, title)}`;
}

/**
 * Whether a source-reported duration and a candidate recording's duration are
 * grossly incompatible. Missing/non-positive durations are not evidence.
 */
export function durationMismatch(
  hintMs?: number,
  candidateMs?: number,
  toleranceMs = 120_000,
): boolean {
  if (hintMs == null || candidateMs == null) return false;
  if (hintMs <= 0 || candidateMs <= 0) return false;
  return Math.abs(hintMs - candidateMs) > toleranceMs;
}

export interface ResolutionTextVariant {
  artist: string;
  title: string;
  order: "direct" | "swapped";
}

/**
 * Conservative, versioned resolver variants shared by live ingestion and
 * historical replay. Never add more than the direct pair plus one reversal.
 */
export function resolutionTextVariants(
  artist: string,
  title: string,
): ResolutionTextVariant[] {
  const direct: ResolutionTextVariant = { artist, title, order: "direct" };
  if (
    normalizeMetadataPair(artist, title) === normalizeMetadataPair(title, artist)
  ) {
    return [direct];
  }
  return [direct, { artist: title, title: artist, order: "swapped" }];
}

export type TextVariantResolution =
  | {
      status: "matched";
      match: RecordingTextMatch;
      variant: ResolutionTextVariant;
    }
  | { status: "unavailable" }
  | { status: "deferred" }
  | { status: "duration_rejected" };

/**
 * Run the shared bounded variant set. A provider failure stops immediately and
 * remains retryable. A duration rejection also stops: reversing fields after a
 * plausible-but-wrong-duration hit risks attaching the wrong recording.
 */
export async function resolveTextWithVariants(
  artist: string,
  title: string,
  durationHints: Array<number | undefined>,
  lookup: (
    variantArtist: string,
    variantTitle: string,
  ) => Promise<RecordingTextResolutionStatus>,
): Promise<TextVariantResolution> {
  for (const variant of resolutionTextVariants(artist, title)) {
    const result = await lookup(variant.artist, variant.title);
    if (result.status === "deferred") return { status: "deferred" };
    if (result.status !== "matched") continue;
    if (
      durationHints.some((hint) =>
        durationMismatch(hint, result.match.durationMs),
      )
    ) {
      return { status: "duration_rejected" };
    }
    return { status: "matched", match: result.match, variant };
  }
  return { status: "unavailable" };
}