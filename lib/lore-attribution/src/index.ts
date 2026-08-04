/**
 * Shared rules for deciding whether source metadata is usable as a live
 * selector/DJ attribution. This package intentionally has no database or
 * browser dependencies so ingestion, API serialization, and the Dial use the
 * same decision.
 */

const MISSING_OR_GENERIC = new Set([
  "unknown",
  "unknown dj",
  "unknown host",
  "unknown selector",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "no dj",
  "no host",
  "no selector",
  "continuous",
  "automation",
  "automated",
  "automated programming",
  "automatic",
  "auto",
  "on air",
  "on-air",
  "now playing",
  "live",
  "music",
  "station",
  "station id",
  "station identification",
  "radio",
  "radio station",
  "dj",
  "djs",
  "host",
  "hosts",
  "selector",
  "selectors",
]);

const AUDIO_FILENAME_RE = /\.\s*(mp3|wav|ogg|flac|aac|m4a|opus|wma|aiff?)\s*$/i;

/** Normalize names for comparisons without changing the value displayed. */
export function normalizeAttributionName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, " ")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface DjAttributionContext {
  artist?: string | null;
  title?: string | null;
  showTitle?: string | null;
  stationName?: string | null;
}

export interface ShowAttributionLike {
  name: string;
  djName?: string;
  /** Multi-DJ array. When present, takes precedence over the single `djName`. */
  djNames?: string[];
}

/**
 * Return the deduplicated list of eligible DJ names for a show.
 * Handles both the legacy single-string `djName` and the new multi-DJ `djNames`
 * array. Each candidate is run through `eligibleDjName` for generic-name
 * filtering and (optionally) live-track collision checks.
 *
 * An empty array means no eligible DJ names were found.
 * A single-element array means exactly one eligible DJ can be credited.
 * Two or more elements signals an ambiguous multi-DJ show where no single
 * selector can be named: callers should suppress the DJ slot and fall back to
 * the show name or station level.
 */
export function eligibleDjNames(
  show: ShowAttributionLike,
  context: DjAttributionContext = {},
): string[] {
  const candidates =
    show.djNames != null && show.djNames.length > 0
      ? show.djNames
      : show.djName != null
        ? [show.djName]
        : [];
  const eligible = candidates
    .map((n) => eligibleDjName(n, context))
    .filter((n): n is string => n !== null);
  // Deduplicate: preserve first occurrence, compare via normalised form.
  const seen = new Set<string>();
  return eligible.filter((n) => {
    const key = normalizeAttributionName(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function usableShowAttribution(
  show: ShowAttributionLike | null | undefined,
  context: DjAttributionContext = {},
): ShowAttributionLike | null {
  if (!show) return null;
  const djName = eligibleDjName(show.djName, {
    ...context,
    showTitle: context.showTitle ?? show.name,
  });
  return { ...show, ...(djName ? { djName } : { djName: undefined }) };
}

/**
 * Return the cleaned DJ value when it is safe to use, otherwise null.
 *
 * Shape alone is never used as a rejection rule: one-word aliases remain
 * eligible. A collision is only meaningful against the metadata supplied for
 * this show/track, so a legitimate selector who happens to share a public
 * name with an unrelated artist is preserved.
 */
export function eligibleDjName(
  value: string | null | undefined,
  context: DjAttributionContext = {},
): string | null {
  const display = value?.replace(/[\u200B-\u200F\u2060\uFEFF]/g, " ").replace(/\s+/g, " ").trim() ?? "";
  if (!display) return null;

  const normalized = normalizeAttributionName(display);
  if (!normalized || MISSING_OR_GENERIC.has(normalized) || AUDIO_FILENAME_RE.test(display)) {
    return null;
  }

  const comparisons = [context.artist, context.title, context.showTitle, context.stationName]
    .map(normalizeAttributionName)
    .filter(Boolean);
  return comparisons.includes(normalized) ? null : display;
}