/* eslint-disable no-console -- read-only network compatibility experiment */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  lookupRockskySong,
  type RockskyCompatibilityObservation,
  type RockskyLookupMethod,
  type RockskyManifest,
} from "../lore/rocksky-compatibility.js";

const ROOT = resolve(import.meta.dirname, "../../../../");
const DEFAULT_MANIFEST = resolve(ROOT, "research/rocksky-compatibility-manifest.json");
const DEFAULT_EVIDENCE = resolve(ROOT, "research/rocksky-compatibility-observations.jsonl");
const DEFAULT_SUMMARY = resolve(ROOT, "research/rocksky-compatibility-summary.json");

function value(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.split("=", 2)[1];
}

function boundedInteger(name: string, fallback: number, max: number): number {
  const parsed = Number(value(name) ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`--${name} must be an integer from 1 to ${max}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  if (process.argv.includes("--write") || process.argv.includes("--ingest") ||
      process.argv.includes("--apply")) {
    throw new Error("This experiment is non-writing; write/ingest/apply flags are prohibited");
  }
  const manifestPath = resolve(ROOT, value("manifest") ?? DEFAULT_MANIFEST);
  const evidencePath = resolve(ROOT, value("output") ?? DEFAULT_EVIDENCE);
  const summaryPath = resolve(ROOT, value("summary") ?? DEFAULT_SUMMARY);
  const limit = boundedInteger("limit", 300, 300);
  const spacingMs = boundedInteger("request-spacing-ms", 350, 10_000);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RockskyManifest;
  if (manifest.schemaVersion !== 1 || manifest.productionWrites !== 0 || !Array.isArray(manifest.items)) {
    throw new Error("Unsupported or unsafe Rocksky compatibility manifest");
  }

  const runId = randomUUID();
  const observations: RockskyCompatibilityObservation[] = [];
  const byStratum = new Map<string, typeof manifest.items>();
  for (const item of manifest.items) {
    byStratum.set(item.stratum, [...(byStratum.get(item.stratum) ?? []), item]);
  }
  const selected = [];
  const strata = [...byStratum.keys()].sort();
  for (let index = 0; selected.length < limit; index++) {
    let added = false;
    for (const stratum of strata) {
      const item = byStratum.get(stratum)?.[index];
      if (item && selected.length < limit) {
        selected.push(item);
        added = true;
      }
    }
    if (!added) break;
  }
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, "");
  let itemsWithoutDirectIdentifier = 0;
  for (const item of selected) {
    const methods: RockskyLookupMethod[] = [
      ...(item.mbid && !item.mbid.startsWith("sp:") ? ["mbid" as const] : []),
      ...(item.isrc ? ["isrc" as const] : []),
    ];
    if (!methods.length) itemsWithoutDirectIdentifier++;
    for (const method of methods) {
      const row = await lookupRockskySong(item, method, runId);
      observations.push(row);
      await appendFile(evidencePath, `${JSON.stringify(row)}\n`);
      await new Promise((done) => setTimeout(done, spacingMs));
    }
  }

  const byClass: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  const observationsByStratum: Record<string, number> = {};
  for (const row of observations) {
    byClass[row.matchClass] = (byClass[row.matchClass] ?? 0) + 1;
    byMethod[row.method] = (byMethod[row.method] ?? 0) + 1;
    observationsByStratum[row.stratum] = (observationsByStratum[row.stratum] ?? 0) + 1;
  }
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId,
    experimentOnly: true,
    productionWrites: 0,
    manifestPath,
    sampledItems: selected.length,
    itemsWithoutDirectIdentifier,
    observations: observations.length,
    byClass,
    byMethod,
    byStratum: observationsByStratum,
    errors: observations.filter((row) => row.error).length,
    averageElapsedMs: observations.length
      ? Math.round(observations.reduce((sum, row) => sum + row.elapsedMs, 0) / observations.length)
      : 0,
  };
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
