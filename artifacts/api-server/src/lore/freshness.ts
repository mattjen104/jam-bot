/**
 * Now-playing freshness classification — pure, no DB / network.
 *
 * `observedAt` records when Lore actually received a spin's metadata
 * (ingestion time), as opposed to `playedAt`, the station-reported start
 * time. A track observed 40 minutes ago via a 15-minute history poller is a
 * very different claim from one observed 10 seconds ago over SSE — this
 * module turns that age into an explicit class the UI and crossing logic can
 * gate on:
 *
 *   fresh — within ~two expected polling intervals of the source; the station
 *           just told us this. Behaves exactly as today.
 *   aging — past the fresh budget but within the stale threshold; still
 *           presented as playing, no special treatment.
 *   stale — old enough that "playing right now" would be dishonest. The
 *           WebPlayer shows a "may be delayed" hint and the Dial never counts
 *           a stale candidate as a confirmed live crossing.
 */

export type FreshnessClass = "fresh" | "aging" | "stale";

/**
 * Expected polling cadence per now-playing source, mirroring the poller's
 * POLL_INTERVALS_MS (lore/poller.ts) plus the multiplexed host tier. History
 * sources (Spinitron, KEXP…) poll rarely but lose nothing — their spins are
 * learned late, so their fresh budget is proportionally wide. Unknown sources
 * fall back to the poller's default interval.
 */
const SOURCE_CADENCE_MS: Record<string, number> = {
  spinitron: 900_000,
  spinitron_web: 150_000,
  kexp_api: 900_000,
  kexp: 900_000,
  bbc_api: 600_000,
  somafm: 900_000,
  kcrw: 90_000,
  station_page: 60_000,
  radio_paradise: 60_000,
  nts_live: 120_000,
  fip: 60_000,
  // ICY covers both the 30s interval poller and the instant persistent
  // watcher — classify against the poller cadence (the weaker guarantee).
  radio_browser_icy: 30_000,
  radiojar: 60_000,
  // Multiplexed host tier polls every host every 10s; SSE is instant.
  azuracast: 30_000,
  icecast: 30_000,
  // ACR fingerprint spins arrive on the client's 2-minute re-fingerprint
  // cadence at most — classify against that so a one-shot identify doesn't
  // read as "fresh" for a whole default window after the song has moved on.
  acr_fingerprint: 120_000,
};

/** Poller default for sources without a dedicated cadence entry. */
const DEFAULT_CADENCE_MS = 90_000;

/** Fresh budget = roughly two expected polling intervals. */
const FRESH_MULTIPLIER = 2;
/** Stale beyond six intervals (three fresh budgets). */
const STALE_MULTIPLIER = 6;

/** Expected polling interval (ms) for a now-playing source kind. */
export function expectedCadenceMs(source: string | null | undefined): number {
  if (!source) return DEFAULT_CADENCE_MS;
  return SOURCE_CADENCE_MS[source] ?? DEFAULT_CADENCE_MS;
}

/**
 * Classify how fresh a now-playing observation is for its source kind.
 * Negative ages (clock skew) clamp to 0 — never stale by skew alone.
 */
export function classifyFreshness(
  source: string | null | undefined,
  observedAt: Date,
  now: Date = new Date(),
): FreshnessClass {
  const cadence = expectedCadenceMs(source);
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime());
  if (ageMs <= FRESH_MULTIPLIER * cadence) return "fresh";
  if (ageMs <= STALE_MULTIPLIER * cadence) return "aging";
  return "stale";
}
