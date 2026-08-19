/* eslint-disable no-console -- CLI operator tool; stdout is the interface. */
/**
 * One-off operator runner for the source-coverage probe pass.
 *
 * Equivalent to POST /api/admin/source-coverage/probe (which requires
 * LORE_ADMIN_TOKEN): probes every non-healthy real roster station's free
 * public metadata surface, persists outcomes to station_source_probes, and
 * repairs verified configurations in the database.
 *
 * Poller enrollment only takes effect in the long-running server process —
 * after running this standalone, restart the API Server (or use the admin
 * endpoint instead) for repaired stations to start polling.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx scripts/source-coverage-probe-run.ts
 */
import { startSourceCoverageProbeRun, getSourceCoverageProbeStatus } from "../src/lore/source-probe.js";
import { getSourceCoverageLedger } from "../src/lore/source-coverage.js";

const started = startSourceCoverageProbeRun();
if (!started) {
  console.error("a probe run is already in progress in this process");
  process.exit(1);
}

const timer = setInterval(() => {
  const s = getSourceCoverageProbeStatus();
  console.log(
    `[status] running=${s.running} probed=${s.probed}/${s.total} usable=${s.usable} repaired=${s.repaired} blank=${s.blank} unsupported=${s.unsupported} unreachable=${s.unreachable} skippedHidden=${s.skippedHidden} skippedOverride=${s.skippedOverride}`,
  );
  if (!s.running) {
    clearInterval(timer);
    void (async () => {
      const ledger = await getSourceCoverageLedger();
      console.log("\n=== LEDGER ===");
      console.log(
        `roster=${ledger.rosterSize} healthy=${ledger.counts.healthy} recoverable=${ledger.counts.recoverable} no_source=${ledger.counts.no_source} unavailable=${ledger.counts.unavailable} fingerprintCandidates=${ledger.fingerprintCandidateCount}`,
      );
      for (const s of ledger.stations) {
        if (s.class === "healthy") continue;
        console.log(
          `- ${s.slug} [${s.class}${s.fingerprintCandidate ? " +fingerprint" : ""}${s.hidden ? " hidden" : ""}] source=${s.source ?? "none"} probe=${s.probe ? `${s.probe.kind}:${s.probe.outcome}` : "none"}${s.probe?.resolvedUrl && s.probe.resolvedUrl !== s.streamUrl ? ` resolved=${s.probe.resolvedUrl}` : ""}`,
        );
      }
      process.exit(0);
    })();
  }
}, 5_000);
