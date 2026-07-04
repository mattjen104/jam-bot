/**
 * Probe script — NTS Live API reachability check.
 *
 * Run from the api-server package root:
 *
 *   npx tsx src/scripts/probe-nts-live.ts
 *
 * Exits 0 when the NTS Live API is reachable and returns parseable show data
 * for both NTS 1 and NTS 2. Exits 1 when the API is unreachable (e.g. the
 * Replit container's IP range is blocked) or when the response shape does not
 * yield a show title.
 *
 * This script is the integration check described in the task: when the
 * environment changes (different IP range, proxy, or Replit network update)
 * and the NTS API becomes accessible, this probe should exit 0 and the live
 * nts_live adapter will automatically start populating show titles on the
 * station dial without any code changes.
 */

import { parseNtsLive } from "../lore/adapters.js";

const CHANNELS = ["1", "2"] as const;
const FETCH_TIMEOUT_MS = 8_000;

async function probeChannel(channel: string): Promise<boolean> {
  const url = `https://www.nts.live/api/v2/live/${encodeURIComponent(channel)}`;
  let status: number | null = null;
  let body: unknown = null;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) {
      console.error(`[nts-probe] NTS ${channel}: HTTP ${status} — API not reachable from this environment`);
      return false;
    }
    body = await res.json();
  } catch (err) {
    console.error(`[nts-probe] NTS ${channel}: network error — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  const parsed = parseNtsLive(body);
  if (!parsed) {
    console.warn(`[nts-probe] NTS ${channel}: API reachable (${status}) but response yielded no show data`);
    console.warn(`[nts-probe] NTS ${channel}: raw body:`, JSON.stringify(body, null, 2).slice(0, 500));
    return false;
  }

  console.log(`[nts-probe] NTS ${channel}: OK — show="${parsed.rawTitle}" host="${parsed.rawArtist}"`);
  return true;
}

async function main(): Promise<void> {
  console.log("[nts-probe] Checking NTS Live API reachability…");
  const results = await Promise.all(CHANNELS.map(probeChannel));
  const allOk = results.every(Boolean);
  if (allOk) {
    console.log("[nts-probe] All channels reachable — nts_live adapter is fully operational.");
    process.exit(0);
  } else {
    const failed = CHANNELS.filter((_, i) => !results[i]);
    console.error(`[nts-probe] Failed channels: ${failed.join(", ")}`);
    console.error("[nts-probe] The nts_live adapter will silently return null until the API becomes reachable.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[nts-probe] Unexpected error:", err);
  process.exit(1);
});
