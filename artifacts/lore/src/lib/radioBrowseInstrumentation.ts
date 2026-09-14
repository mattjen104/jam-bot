/**
 * Privacy-safe browse instrumentation.
 *
 * Only aggregate counters are kept on the device.  No ZIP, city, artist,
 * station slug, URL, or track metadata is recorded.  This gives product
 * experiments a useful demand/result signal without creating a listener
 * history or a location profile.
 */

export type RadioBrowseEvent =
  | "lens_selected"
  | "filter_selected"
  | "sound_opened"
  | "deck_paged"
  | "result_quality";

const STORAGE_KEY = "lore:radioBrowse:metrics";
const EVENTS: readonly RadioBrowseEvent[] = [
  "lens_selected",
  "filter_selected",
  "sound_opened",
  "deck_paged",
  "result_quality",
];

type Metrics = Record<string, number>;

function readMetrics(): Metrics {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, count]) => typeof count === "number" && Number.isFinite(count)),
    ) as Metrics;
  } catch {
    return {};
  }
}

function writeMetrics(value: Metrics): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Metrics must never interfere with playback or browsing.
  }
}

export function recordRadioBrowseEvent(
  event: RadioBrowseEvent,
  dimensions: { filterFamily?: string; resultCount?: number } = {},
): void {
  if (!EVENTS.includes(event)) return;
  const family = dimensions.filterFamily?.replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
  const suffix = family ? `:${family}` : "";
  const key = `${event}${suffix}`;
  const metrics = readMetrics();
  metrics[key] = (metrics[key] ?? 0) + 1;
  if (event === "result_quality" && typeof dimensions.resultCount === "number") {
    const bucket = dimensions.resultCount === 0
      ? "empty"
      : dimensions.resultCount < 4
        ? "thin"
        : dimensions.resultCount < 12
          ? "healthy"
          : "broad";
    const bucketKey = `${event}:results-${bucket}`;
    metrics[bucketKey] = (metrics[bucketKey] ?? 0) + 1;
  }
  writeMetrics(metrics);
}

/** Tests and the local privacy settings surface can clear aggregate counters. */
export function clearRadioBrowseMetrics(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

export function readRadioBrowseMetrics(): Readonly<Record<string, number>> {
  return readMetrics();
}