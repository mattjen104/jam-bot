/* eslint-disable no-console -- experiment runner; JSONL/stdout are its interface. */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  observeIcy,
  observeLastFm,
  observeRockskyHistory,
  observeRockskyStatus,
  summarizeExperiment,
  type ExperimentObservation,
  type ScrobbleExperimentTarget,
} from "../lore/scrobble-source-experiment.js";

const ROOT = resolve(import.meta.dirname, "../../../../");

type Config = {
  experimentOnly: true;
  targets: ScrobbleExperimentTarget[];
};

function value(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=", 2)[1];
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("sample values must be positive integers");
  return parsed;
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("request spacing must be a non-negative integer");
  }
  return parsed;
}

type ExperimentJob = {
  provider: "icy" | "lastfm" | "rocksky";
  run: () => Promise<ExperimentObservation>;
};

function createProviderGate(spacingMs: number) {
  const tails = new Map<ExperimentJob["provider"], Promise<void>>();
  return async <T>(provider: ExperimentJob["provider"], operation: () => Promise<T>): Promise<T> => {
    const previous = tails.get(provider) ?? Promise.resolve();
    const turn = previous.then(
      () => new Promise<void>((done) => setTimeout(done, spacingMs)),
    );
    tails.set(provider, turn.catch(() => undefined));
    await turn;
    return operation();
  };
}

async function mapBounded<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        out[index] = await fn(values[index]!);
      }
    }),
  );
  return out;
}

export async function runScrobbleExperiment(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--write") || argv.includes("--ingest") || argv.includes("--apply")) {
    throw new Error("This experiment is non-writing; write/ingest/apply flags are prohibited");
  }
  const configPath = value(argv, "config");
  if (!configPath) throw new Error("--config=<JSON file> is required");
  const outputPath = resolve(ROOT, value(argv, "output") ?? "research/scrobble-source-observations.jsonl");
  const summaryPath = resolve(ROOT, value(argv, "summary") ?? "research/scrobble-source-summary.json");
  const samples = positiveInteger(value(argv, "samples"), 1);
  const intervalSeconds = positiveInteger(value(argv, "interval-seconds"), 60);
  const concurrency = Math.min(positiveInteger(value(argv, "concurrency"), 3), 5);
  const requestSpacingMs = nonNegativeInteger(value(argv, "request-spacing-ms"), 250);
  const config = JSON.parse(await readFile(resolve(ROOT, configPath), "utf8")) as Config;
  if (config.experimentOnly !== true || !Array.isArray(config.targets)) {
    throw new Error("Config must contain experimentOnly:true and a targets array");
  }
  const apiKey = process.env["LASTFM_API_KEY"]?.trim();
  const all: ExperimentObservation[] = [];
  const runId = randomUUID();
  const throughProviderGate = createProviderGate(requestSpacingMs);
  await mkdir(dirname(outputPath), { recursive: true });
  // Every invocation owns one evidence file. Never append new sample IDs to a
  // prior run, which would make the persisted data disagree with its summary.
  await writeFile(outputPath, "");

  for (let sample = 0; sample < samples; sample++) {
    const jobs = config.targets.flatMap((target) => [
      ...(target.icyStreamUrl
        ? [{ provider: "icy" as const, run: () => observeIcy(target) }]
        : []),
      ...(target.lastfmUser
        ? [
            {
              provider: "lastfm" as const,
              run: () =>
                apiKey
                  ? observeLastFm(target, apiKey)
                  : Promise.resolve({
                    schemaVersion: 1 as const,
                    stationSlug: target.stationSlug,
                    source: "lastfm" as const,
                    identityConfidence: target.identityConfidence,
                    account: target.lastfmUser,
                    observedAt: new Date().toISOString(),
                    nowPlaying: null,
                    current: false,
                    requestBytes: 0,
                    elapsedMs: 0,
                    error: "LASTFM_API_KEY is not configured",
                  }),
            },
          ]
        : []),
      ...(target.rockskyActor
        ? [
            {
              provider: "rocksky" as const,
              run: () => observeRockskyHistory(target),
            },
            {
              provider: "rocksky" as const,
              run: () => observeRockskyStatus(target),
            },
          ]
        : []),
    ]);
    const rows = (
      await mapBounded(jobs, concurrency, (job) =>
        throughProviderGate(job.provider, job.run),
      )
    ).map(
      (row) => ({ ...row, runId, sampleId: sample + 1 }),
    );
    all.push(...rows);
    await appendFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    if (sample + 1 < samples) await new Promise((done) => setTimeout(done, intervalSeconds * 1000));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    runId,
    experimentOnly: true,
    productionWrites: 0,
    samples,
    intervalSeconds,
    requestSpacingMs,
    ...summarizeExperiment(all),
  };
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScrobbleExperiment().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}