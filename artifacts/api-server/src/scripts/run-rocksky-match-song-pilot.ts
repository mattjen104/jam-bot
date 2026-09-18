/* eslint-disable no-console -- read-only network compatibility experiment */
import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  matchRockskySong,
  type RockskyManifest,
  type RockskyMatchSongObservation,
} from "../lore/rocksky-compatibility.js";

const ROOT = resolve(import.meta.dirname, "../../../../");
const manifestPath = resolve(ROOT, "research/rocksky-compatibility-manifest.json");
const evidencePath = resolve(ROOT, "research/rocksky-match-song-observations.jsonl");
const summaryPath = resolve(ROOT, "research/rocksky-match-song-summary.json");

function boundedInteger(name: string, fallback: number, max: number): number {
  const raw = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.split("=", 2)[1];
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`--${name} must be an integer from 1 to ${max}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  if (process.argv.some((arg) => ["--write", "--ingest", "--apply"].includes(arg))) {
    throw new Error("This pilot is non-writing; write/ingest/apply flags are prohibited");
  }
  const perStratum = boundedInteger("per-stratum", 10, 20);
  const spacingMs = boundedInteger("request-spacing-ms", 500, 10_000);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RockskyManifest;
  if (manifest.schemaVersion !== 1 || manifest.productionWrites !== 0) {
    throw new Error("Unsupported or unsafe Rocksky compatibility manifest");
  }
  const selected = ["text", "unresolved"].flatMap((stratum) =>
    manifest.items
      .filter((item) => item.stratum === stratum && item.rawArtist?.trim() && item.rawTitle?.trim())
      .slice(0, perStratum)
  );
  const runId = randomUUID();
  const observations: RockskyMatchSongObservation[] = [];
  await writeFile(evidencePath, "");
  for (const item of selected) {
    const row = await matchRockskySong(item, runId);
    observations.push(row);
    await appendFile(evidencePath, `${JSON.stringify(row)}\n`);
    await new Promise((done) => setTimeout(done, spacingMs));
  }
  const successful = observations.filter((row) => row.matchClass === "candidate_only");
  const elapsed = observations.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    elapsed.length ? elapsed[Math.min(elapsed.length - 1, Math.ceil(elapsed.length * fraction) - 1)] : 0;
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId,
    experimentOnly: true,
    candidateOnly: true,
    productionWrites: 0,
    sampledItems: selected.length,
    byStratum: Object.fromEntries(["text", "unresolved"].map((stratum) => [
      stratum,
      observations.filter((row) => row.stratum === stratum).length,
    ])),
    responses: {
      candidate: successful.length,
      noMatch: observations.filter((row) => row.matchClass === "no_match").length,
      unavailable: observations.filter((row) => row.matchClass === "unavailable").length,
    },
    controls: {
      independentlyConfirmed: observations.filter((row) => row.independentlyConfirmed).length,
      identifierConflicts: observations.filter((row) => row.identifierConflict).length,
      metadataDisagreements: successful.filter((row) => !row.metadataAgrees).length,
    },
    editionAmbiguous: observations.filter((row) => row.editionAmbiguous).length,
    providerLinks: {
      observationsWithLinks: observations.filter((row) => row.providerLinks.length > 0).length,
      total: observations.reduce((sum, row) => sum + row.providerLinks.length, 0),
    },
    latencyMs: {
      average: elapsed.length
        ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length)
        : 0,
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: elapsed.at(-1) ?? 0,
    },
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});