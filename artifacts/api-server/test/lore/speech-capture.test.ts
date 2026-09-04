import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  assertPublicHttpStreamUrl,
  deriveSpeechEndsThenSustainedMusic,
  withTransientSpeechClip,
  LocalSttAdapter,
} from "../../src/lore/speech-capture.js";
import { SpeechQuotaScheduler, selectCheapestMount } from "../../src/lore/speech-scheduler.js";
import { estimateTalkWindows } from "../../src/lore/speech-talk-window.js";
import { validateGroundedClaim } from "../../src/lore/speech-grounding.js";
import { compareTranscriptToSchedule } from "../../src/lore/speech-schedule-comparison.js";
import { parseSpeechPilotCohort, speechShadowEnabled } from "../../src/lore/speech-shadow-orchestrator.js";

describe("speech/capture core", () => {
  it("always removes transient ffmpeg clip directories", async () => {
    let clipPath = "";
    await withTransientSpeechClip("https://radio.example/live", {
      durationSeconds: 3, timeoutMs: 1_000, tempRoot: tmpdir(),
    }, async (clip) => {
      clipPath = clip.path;
      await writeFile(clip.path, "audio");
      throw new Error("STT failed");
    }, async () => ({ stdout: "", stderr: "" })).catch(() => undefined);
    expect(clipPath).not.toBe("");
    expect(existsSync(clipPath)).toBe(false);
  });

  it("rejects oversized transient clips and still removes them", async () => {
    let clipPath = "";
    await expect(withTransientSpeechClip("https://radio.example/live", {
      durationSeconds: 3, timeoutMs: 1_000, maxBytes: 3, tempRoot: tmpdir(),
    }, async (clip) => {
      clipPath = clip.path;
    }, async (_executable, args) => {
      const path = args.at(-1)!;
      await writeFile(path, "audio");
      return { stdout: "", stderr: "" };
    })).rejects.toThrow("byte limit");
    expect(existsSync(clipPath)).toBe(false);
  });

  it("fails closed without a small explicit pilot cohort", () => {
    const base = {
      LORE_SPEECH_SHADOW_ENABLED: "true",
      LORE_SPEECH_CAPTURE_ENABLED: "true",
      LORE_SPEECH_LOCAL_STT_EXECUTABLE: "whisper",
      LORE_SPEECH_LOCAL_STT_MODEL: "model",
      LORE_SPEECH_CLASSIFIER_EXECUTABLE: "classifier",
      LORE_SPEECH_SILERO_VAD_EXECUTABLE: "vad",
      LORE_SPEECH_FFMPEG_EXECUTABLE: "ffmpeg",
    };
    expect(speechShadowEnabled(base)).toBe(false);
    expect(speechShadowEnabled({ ...base, LORE_SPEECH_PILOT_STATION_IDS: "3,7" })).toBe(true);
    expect(speechShadowEnabled({
      ...base,
      LORE_SPEECH_PILOT_STATION_IDS: "1,2,3,4,5,6",
      LORE_SPEECH_PILOT_MAX_STATIONS: "5",
    })).toBe(false);
    expect(parseSpeechPilotCohort("7, 3,7,nope,-1")).toEqual([7, 3]);
  });

  it("skips an unavailable local STT runner without invoking it", async () => {
    let invoked = false;
    const adapter = new LocalSttAdapter(
      { timeoutMs: 10, maxConcurrency: 1 },
      async () => { invoked = true; return { stdout: "{}", stderr: "" }; },
    );
    await expect(adapter.transcribe("/tmp/a.wav")).resolves.toEqual({
      kind: "unavailable", reason: "not_configured",
    });
    expect(invoked).toBe(false);
  });

  it.skipIf(process.platform !== "linux").each([
    {
      resource: "CPU",
      budget: { maxCpuMs: 10 },
      body: "while (true) { Math.sqrt(Math.random()); }",
      reason: "cpu_budget",
    },
    {
      resource: "memory",
      budget: { maxMemoryBytes: 1 },
      body: "const memory = []; while (true) { memory.push(Buffer.alloc(1024 * 1024, 1)); }",
      reason: "memory_budget",
    },
  ] as const)(
    "kills a real child that exceeds its $resource budget",
    async ({ budget, body, reason }) => {
      const directory = await mkdtemp(join(tmpdir(), "lore-speech-budget-"));
      const executable = join(directory, "runaway-model");
      const modelPath = join(directory, "model.bin");
      const pidPath = join(directory, "child.pid");
      await writeFile(executable, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.argv.at(-1), String(process.pid));
${body}
`);
      await chmod(executable, 0o700);
      await writeFile(modelPath, "test model");

      try {
        const adapter = new LocalSttAdapter({
          executable,
          modelPath,
          timeoutMs: 3_000,
          maxConcurrency: 1,
          ...budget,
        });
        await expect(adapter.transcribe(pidPath)).resolves.toEqual({
          kind: "skipped",
          reason,
        });

        const pid = Number(await readFile(pidPath, "utf8"));
        expect(Number.isInteger(pid)).toBe(true);
        expect(existsSync(`/proc/${pid}`)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    5_000,
  );

  it.skipIf(process.platform !== "linux")(
    "waits for a timed-out real child to exit before returning its failure",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "lore-speech-timeout-"));
      const executable = join(directory, "stalled-model");
      const modelPath = join(directory, "model.bin");
      const pidPath = join(directory, "child.pid");
      await writeFile(executable, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.argv.at(-1), String(process.pid));
setInterval(() => undefined, 1_000);
`);
      await chmod(executable, 0o700);
      await writeFile(modelPath, "test model");

      try {
        const adapter = new LocalSttAdapter({
          executable,
          modelPath,
          timeoutMs: 150,
          maxConcurrency: 1,
        });
        await expect(adapter.transcribe(pidPath)).resolves.toEqual({
          kind: "transcription_failure",
          reason: "local command timed out after 150ms",
        });

        const pid = Number(await readFile(pidPath, "utf8"));
        expect(Number.isInteger(pid)).toBe(true);
        expect(existsSync(`/proc/${pid}`)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    2_000,
  );

  it.skipIf(process.platform !== "linux")(
    "waits for an aborted local model process to exit",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "lore-speech-abort-"));
      const executable = join(directory, "stalled-model");
      const modelPath = join(directory, "model.bin");
      const pidPath = join(directory, "child.pid");
      await writeFile(executable, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.argv.at(-1), String(process.pid));
setInterval(() => undefined, 1_000);
`);
      await chmod(executable, 0o700);
      await writeFile(modelPath, "test model");
      const controller = new AbortController();
      try {
        const adapter = new LocalSttAdapter({
          executable,
          modelPath,
          timeoutMs: 3_000,
          maxConcurrency: 1,
        });
        const pending = adapter.transcribe(pidPath, controller.signal);
        for (let attempt = 0; attempt < 50 && !existsSync(pidPath); attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        controller.abort();
        await expect(pending).resolves.toEqual({
          kind: "transcription_failure",
          reason: "local command aborted",
        });
        const pid = Number(await readFile(pidPath, "utf8"));
        expect(existsSync(`/proc/${pid}`)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    5_000,
  );

  it.skipIf(process.platform !== "linux")(
    "settles when the local model starts with an already-aborted signal",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "lore-speech-pre-abort-"));
      const executable = join(directory, "stalled-model");
      const modelPath = join(directory, "model.bin");
      await writeFile(executable, "#!/bin/sh\nsleep 30\n");
      await chmod(executable, 0o700);
      await writeFile(modelPath, "test model");
      const controller = new AbortController();
      controller.abort();
      try {
        const adapter = new LocalSttAdapter({
          executable,
          modelPath,
          timeoutMs: 3_000,
          maxConcurrency: 1,
        });
        await expect(adapter.transcribe("/tmp/pre-aborted.wav", controller.signal)).resolves.toEqual({
          kind: "transcription_failure",
          reason: "local command aborted",
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    5_000,
  );

  it("classifies silence and music locally before ASR", async () => {
    for (const outcome of ["silence", "music"] as const) {
      const calls: string[] = [];
      const adapter = new LocalSttAdapter({
        executable: "whisper", modelPath: "model", timeoutMs: 10, maxConcurrency: 1,
        classifier: { executable: "classifier", timeoutMs: 10 },
      }, async (executable) => {
        calls.push(executable);
        return { stdout: JSON.stringify({ outcome }), stderr: "" };
      }, async () => undefined);
      await expect(adapter.transcribe("/tmp/a.wav")).resolves.toEqual({ kind: outcome });
      expect(calls).toEqual(["classifier"]);
    }
  });

  it("retains speech-over-music classification and rebases ASR timestamps after VAD trimming", async () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const adapter = new LocalSttAdapter({
      executable: "whisper", modelPath: "model", timeoutMs: 10, maxConcurrency: 1,
      classifier: { executable: "classifier", timeoutMs: 10 },
      vad: { executable: "silero-vad", timeoutMs: 10 },
    }, async (executable, args) => {
      calls.push({ executable, args });
      if (executable === "classifier") return { stdout: '{"outcome":"speech_over_music"}', stderr: "" };
      if (executable === "silero-vad") return { stdout: '{"segments":[{"start":12,"end":14}]}', stderr: "" };
      return { stdout: '{"segments":[{"start":0.25,"end":1.5,"text":"station ID"}]}', stderr: "" };
    }, async () => undefined);
    await expect(adapter.transcribe("/tmp/a.wav")).resolves.toEqual({
      kind: "speech_over_music",
      segments: [{ startedAtMs: 12_250, endedAtMs: 13_500, text: "station ID" }],
    });
    expect(calls[2]?.args).toContain("--clip-timestamps");
    expect(calls[2]?.args).toContain("12,14");
  });

  it("carries local classifier timeline intervals through the STT outcome", async () => {
    const adapter = new LocalSttAdapter({
      executable: "whisper", modelPath: "model", timeoutMs: 10, maxConcurrency: 1,
      classifier: { executable: "classifier", timeoutMs: 10 },
    }, async (executable) => executable === "classifier"
      ? { stdout: '{"segments":[{"label":"speech","start":0,"end":2},{"label":"music","start":2.1,"end":18}]}', stderr: "" }
      : { stdout: '{"segments":[{"start":0,"end":1,"text":"station ID"}]}', stderr: "" },
    async () => undefined);
    await expect(adapter.transcribe("/tmp/a.wav")).resolves.toMatchObject({
      kind: "speech",
      intervals: [
        { kind: "speech", startedAtMs: 0, endedAtMs: 2_000 },
        { kind: "music", startedAtMs: 2_100, endedAtMs: 18_000 },
      ],
    });
  });

  it("does not turn classifier failures into no-speech or invoke ASR", async () => {
    let calls = 0;
    const adapter = new LocalSttAdapter({
      executable: "whisper", modelPath: "model", timeoutMs: 10, maxConcurrency: 1,
      classifier: { executable: "classifier", timeoutMs: 10 },
    }, async () => {
      calls++;
      return { stdout: "not json", stderr: "" };
    }, async () => undefined);
    await expect(adapter.transcribe("/tmp/a.wav")).resolves.toMatchObject({ kind: "classification_failure" });
    expect(calls).toBe(1);
  });

  it("derives a sustained-music boundary without assigning an identity", () => {
    expect(deriveSpeechEndsThenSustainedMusic([
      { kind: "speech", startedAtMs: 0, endedAtMs: 2_000 },
      { kind: "music", startedAtMs: 2_200, endedAtMs: 18_000 },
    ])).toEqual({
      kind: "speech_ends_then_sustained_music",
      speechEndedAtMs: 2_000, musicStartedAtMs: 2_200, musicDurationMs: 15_800,
    });
  });

  it("rejects IPv4-mapped private IPv6 stream targets", async () => {
    await expect(assertPublicHttpStreamUrl(
      "https://radio.example/live",
      async () => [{ address: "::ffff:10.0.0.1", family: 6 }] as never,
    )).rejects.toThrow("non-public");
  });

  it.each([
    "fe90::1",
    "febf::1",
    "0:0:0:0:0:ffff:a00:1",
    "64:ff9b::a00:1",
  ])("rejects canonical IPv6 special-use target %s", async (address) => {
    await expect(assertPublicHttpStreamUrl(
      "https://radio.example/live",
      async () => [{ address, family: 6 }] as never,
    )).rejects.toThrow("non-public");
  });

  it.each([
    "192.0.0.1",
    "192.0.0.8",
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
  ])(
    "rejects multicast or reserved IPv4 stream target %s",
    async (address) => {
      await expect(assertPublicHttpStreamUrl(
        "http://radio.example/live",
        async () => [{ address, family: 4 }] as never,
      )).rejects.toThrow("non-public");
    },
  );

  it("pins the validated address so capture cannot re-resolve the hostname", async () => {
    const target = await assertPublicHttpStreamUrl(
      "https://radio.example:8443/live",
      async () => [{ address: "8.8.8.8", family: 4 }] as never,
    );
    expect(target.pinnedUrl).toBe("https://8.8.8.8:8443/live");
    expect(target.originalAuthority).toBe("radio.example:8443");
    expect(target.originalHostname).toBe("radio.example");
  });

  it("enforces quotas while making same station/window reservation idempotent", () => {
    const scheduler = new SpeechQuotaScheduler({
      enabled: true, maxCapturesPerStation: 1, maxCapturesPerWindow: 1, windowMs: 60_000,
    });
    const at = new Date("2025-01-01T12:00:10Z");
    const first = scheduler.reserve(1, at, [{ url: "a", estimatedCost: 2 }]);
    const retry = scheduler.reserve(1, at, [{ url: "a", estimatedCost: 2 }]);
    expect(first.kind).toBe("sampled");
    expect(retry).toMatchObject({ kind: "sampled", reason: "idempotent" });
    expect(scheduler.reserve(2, at, [{ url: "b", estimatedCost: 1 }])).toEqual({
      kind: "skipped", reason: "window_quota",
    });
    expect(selectCheapestMount([{ url: "costly", estimatedCost: 4 }, { url: "cheap", estimatedCost: 1 }])?.url).toBe("cheap");
  });

  it("keeps speech history restricted to ranking, not scheduler policy", () => {
    const rank = estimateTalkWindows([{ stationId: 9, startedAt: new Date(9_000), endedAt: new Date(10_000), speechConfidence: 1 }], new Date(10_000), 10_000);
    expect(rank[0]?.stationId).toBe(9);
    const disabled = new SpeechQuotaScheduler({ enabled: false, maxCapturesPerStation: 99, maxCapturesPerWindow: 99, windowMs: 1 });
    expect(disabled.reserve(9, new Date(), [{ url: "x", estimatedCost: 0 }])).toEqual({ kind: "skipped", reason: "disabled" });
  });

  it("requires exact grounded spans and gives schedule comparison precedence", () => {
    const segments = [{ startedAtMs: 0, endedAtMs: 1_000, text: "You are listening to DJ Nova." }];
    expect(validateGroundedClaim(segments, { kind: "dj", value: "DJ Nova", segmentIndex: 0, startedAtMs: 0, endedAtMs: 1_000, startChar: 21, endChar: 28 })).toBe(true);
    expect(validateGroundedClaim(segments, { kind: "dj", value: "DJ Nova", segmentIndex: 0, startedAtMs: 0, endedAtMs: 1_000, startChar: 0, endChar: 7 })).toBe(false);
    expect(compareTranscriptToSchedule("DJ Nova", "DJ Nova")).toBe("supporting");
    expect(compareTranscriptToSchedule("DJ Nova", "DJ Lunar")).toBe("contradictory");
    expect(compareTranscriptToSchedule("", "DJ Nova")).toBe("inconclusive");
  });
});