import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePilotArgs, formatPilotReport, verifySpeechRuntimeExecutable } from "../../src/scripts/run-speech-pilot.js";
import { SpeechQuotaScheduler } from "../../src/lore/speech-scheduler.js";

describe("speech pilot operator contract", () => {
  it("requires an explicit bounded unique cohort and timeout", () => {
    expect(() => parsePilotArgs([])).toThrow("--stations");
    expect(() => parsePilotArgs(["--stations=1,1"])).toThrow("unique");
    expect(() => parsePilotArgs(["--stations=1,2,3,4,5,6"])).toThrow("1-5");
    expect(parsePilotArgs(["--stations=7,3", "--timeout-seconds=20", "--json"])).toMatchObject({
      stationIds: [7, 3], timeoutMs: 20_000, json: true,
    });
  });

  it("keeps production station quotas across run-scoped reservations", () => {
    const scheduler = new SpeechQuotaScheduler({ enabled: true, maxCapturesPerStation: 1, maxCapturesPerWindow: 2, windowMs: 60_000 });
    const at = new Date("2025-01-01T00:00:01Z");
    expect(scheduler.reserve(4, at, [{ url: "https://radio.example/a", estimatedCost: 1 }]).kind).toBe("sampled");
    expect(scheduler.reserve(4, at, [{ url: "https://radio.example/a", estimatedCost: 1 }], "pilot-a")).toMatchObject({
      kind: "skipped", reason: "station_quota",
    });
  });

  it("renders disabled capture flags as an actionable preflight failure", () => {
    expect(formatPilotReport({
      ok: false,
      runReady: false,
      errors: ["LORE_SPEECH_CAPTURE_ENABLED=true is required"],
    })).toContain("preflight FAILED");
  });

  it("renders concise human report separately from durable JSON", () => {
    expect(formatPilotReport({
      runId: "run-a", completed: true, stations: [{ stationId: 7, outcomes: ["silence"] }],
      aggregate: { captures: 1, transcriptSegments: 0, groundedClaims: 0, outcomes: { silence: 1 } },
    })).toContain("station 7:");
  });

  it("rejects a local fixture which cannot advertise the JSON wrapper contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-pilot-contract-"));
    const executable = join(directory, "wrapper");
    try {
      await writeFile(executable, "#!/bin/sh\necho 'plain text only'\n");
      await chmod(executable, 0o700);
      await expect(verifySpeechRuntimeExecutable(executable, "stt")).rejects.toThrow("JSON");
      await writeFile(executable, `#!/bin/sh
echo '{"contract":"lore-speech-local.v1","component":"stt","outputFormat":"json","localOnly":true}'
`);
      await expect(verifySpeechRuntimeExecutable(executable, "stt")).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});