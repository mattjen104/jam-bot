/**
 * Shared identity and pacing helpers for requests sent to station-owned
 * infrastructure. Keep the default honest and allow operators to add a public
 * contact URL without hard-coding a development or deployment hostname.
 */
export const STATION_NETWORK_USER_AGENT =
  process.env["LORE_NETWORK_USER_AGENT"]?.trim() ||
  "Lore-Radio/1.0 (public-stream metadata and health client)";

/** Add bounded jitter so fleet retries and recurring probes do not synchronize. */
export function withPoliteJitter(
  delayMs: number,
  fraction = 0.2,
  random = Math.random,
): number {
  const spread = Math.max(1, Math.floor(delayMs * fraction));
  return Math.max(1, delayMs + Math.floor((random() * 2 - 1) * spread));
}