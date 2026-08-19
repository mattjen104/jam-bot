import { db, stationsTable, radioBrowserStationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchIcyMetadata } from "./icy.js";
import { clearIcyErrorBackoff } from "./adapters.js";
import { enrollStationPoller } from "./poller.js";

/**
 * Batch re-probe of every icy_unsupported radio_browser_stations row.
 *
 * The icy_unsupported status is a permanent gate — once set, a station is
 * never re-probed automatically, even though the original failure may have
 * been transient (a one-off 302, a momentary CDN hiccup). This tool probes
 * every unsupported stream sequentially (rate-limited, ~3s between probes),
 * resets the ones that answer with icy-metaint back to `active`, and
 * re-enrolls their pollers live so they produce spins on the next cycle.
 *
 * Because probing hundreds of streams takes many minutes, the run executes
 * as a single-flight background job: POST starts it (409 if already
 * running) and the admin page polls the status endpoint for progress and
 * the final { probed, recovered, stillBad } summary.
 *
 * Note: probes use fetchIcyMetadata's current behavior, which does NOT
 * follow redirects — redirect (302) streams stay stillBad until the
 * redirect-following work lands, after which re-running this tool recovers
 * them too.
 */

const PROBE_GAP_MS = 3_000;

export interface BulkReprobeStatus {
  running: boolean;
  total: number;
  probed: number;
  recovered: number;
  stillBad: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const status: BulkReprobeStatus = {
  running: false,
  total: 0,
  probed: 0,
  recovered: 0,
  stillBad: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

/** Test seam: shrink the inter-probe delay. */
let probeGapMs = PROBE_GAP_MS;
export function _testOnly_setProbeGapMs(ms: number): () => void {
  const prev = probeGapMs;
  probeGapMs = ms;
  return () => {
    probeGapMs = prev;
  };
}

export function getBulkReprobeStatus(): BulkReprobeStatus {
  return { ...status };
}

/**
 * Start a bulk re-probe run in the background.
 * Returns false when a run is already in flight (single-flight guard).
 */
export function startBulkReprobe(): boolean {
  if (status.running) return false;
  status.running = true;
  status.total = 0;
  status.probed = 0;
  status.recovered = 0;
  status.stillBad = 0;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.error = null;

  void runBulkReprobe()
    .catch((err) => {
      status.error = err instanceof Error ? err.message : String(err);
      console.error("[lore] bulk reprobe failed:", err);
    })
    .finally(() => {
      status.running = false;
      status.finishedAt = new Date().toISOString();
      console.info(
        `[lore] bulk reprobe finished: probed=${status.probed} recovered=${status.recovered} stillBad=${status.stillBad}`,
      );
    });
  return true;
}

async function runBulkReprobe(): Promise<void> {
  const rows = await db
    .select()
    .from(radioBrowserStationsTable)
    .where(eq(radioBrowserStationsTable.icyStatus, "icy_unsupported"));
  status.total = rows.length;

  for (const row of rows) {
    const result = await fetchIcyMetadata(row.streamUrl);
    status.probed += 1;

    if (result.ok) {
      const now = new Date();
      await db
        .update(radioBrowserStationsTable)
        .set({
          icyStatus: "active",
          consecutiveErrors: 0,
          lastSuccessAt: now,
          updatedAt: now,
          ...(result.streamTitle ? { lastStreamTitle: result.streamTitle } : {}),
        })
        .where(eq(radioBrowserStationsTable.id, row.id));
      clearIcyErrorBackoff(row.id);

      // Re-enroll the exact RB row we recovered. A station can have several
      // RB rows; simply re-enrolling its old nowPlayingConfig could otherwise
      // leave it polling another still-unsupported row.
      if (row.stationId !== null) {
        await db
          .update(stationsTable)
          .set({
            streamUrl: row.streamUrl,
            nowPlayingSource: "radio_browser_icy",
            nowPlayingConfig: { streamUrl: row.streamUrl, radioBrowserId: row.id },
            updatedAt: now,
          })
          .where(eq(stationsTable.id, row.stationId));
        const [station] = await db
          .select()
          .from(stationsTable)
          .where(eq(stationsTable.id, row.stationId))
          .limit(1);
        if (station) enrollStationPoller(station);
      }
      status.recovered += 1;
      console.info(
        `[lore] bulk reprobe recovered: ${row.name} (rb=${row.id})`,
      );
    } else {
      status.stillBad += 1;
    }

    // Rate limit — be polite to the streaming hosts and our own event loop.
    await new Promise((r) => setTimeout(r, probeGapMs));
  }
}
