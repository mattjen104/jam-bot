/* eslint-disable no-console -- this file is a command-line maintenance tool */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  db,
  scrapedShowExceptionsTable,
  scrapedShowsTable,
  stationsTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { scrapeStationSchedule } from "../lore/schedule-scraper.js";
import { wireScheduleExtractor } from "../lore/schedule-wire.js";
import {
  parseSoundtapStations,
  selectVerifiedSoundtapMatches,
} from "./audit-soundtap-schedules.js";

const SOUNDTAP_SOURCE = fileURLToPath(
  new URL("../../../../research/sources/soundtap-home.md", import.meta.url),
);
const DEFAULT_APPLY_LIMIT = 10;

type Status = {
  recurringSlotCount: number;
  datedSlotCount: number;
  sourceUrl: string | null;
};

function parseArgs(args: string[]): { apply: boolean; limit: number | null; offset: number } {
  const apply = args.includes("--apply");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const offsetArg = args.find((arg) => arg.startsWith("--offset="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
  const offset = offsetArg ? Number(offsetArg.slice("--offset=".length)) : 0;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  return { apply, limit, offset };
}

async function stationStatus(stationId: number, fallbackSourceUrl: string | null): Promise<Status> {
  const [recurring, dated] = await Promise.all([
    db
      .select({ sourceUrl: scrapedShowsTable.sourceUrl })
      .from(scrapedShowsTable)
      .where(and(eq(scrapedShowsTable.stationId, stationId), isNull(scrapedShowsTable.voidedAt))),
    db
      .select({ sourceUrl: scrapedShowExceptionsTable.sourceUrl })
      .from(scrapedShowExceptionsTable)
      .where(eq(scrapedShowExceptionsTable.stationId, stationId)),
  ]);
  return {
    recurringSlotCount: recurring.length,
    datedSlotCount: dated.length,
    sourceUrl: recurring[0]?.sourceUrl ?? dated[0]?.sourceUrl ?? fallbackSourceUrl,
  };
}

export async function refreshSoundtapSchedules(args = process.argv.slice(2)): Promise<void> {
  const { apply, limit, offset } = parseArgs(args);
  const soundtap = parseSoundtapStations(await readFile(SOUNDTAP_SOURCE, "utf8"));
  const stations = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      homepageUrl: stationsTable.homepageUrl,
      scheduleUrl: stationsTable.scheduleUrl,
      city: stationsTable.city,
      country: stationsTable.country,
      ianaTimezone: stationsTable.ianaTimezone,
      upcomingShowCount: stationsTable.upcomingShowCount,
      config: stationsTable.nowPlayingConfig,
    })
    .from(stationsTable)
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)));

  const selection = selectVerifiedSoundtapMatches(soundtap, stations);
  // A scraper target must be entirely DB-derived. The Soundtap slug is only
  // identity evidence; it is never used to construct or guess a URL.
  const seenStationIds = new Set<number>();
  const eligible = selection.matches
    .filter(({ station }) => {
      if (!station.homepageUrl || seenStationIds.has(station.id)) return false;
      seenStationIds.add(station.id);
      return true;
    })
    .sort(
      (a, b) =>
        (a.station.upcomingShowCount ?? 0) - (b.station.upcomingShowCount ?? 0) ||
        a.callsign.localeCompare(b.callsign),
    );
  // Dry runs list every verified overlap. Applies are deliberately bounded
  // even when the operator omits --limit.
  const applyLimit = limit ?? DEFAULT_APPLY_LIMIT;
  const selected = apply ? eligible.slice(offset, offset + applyLimit) : eligible;
  const selectedIds = new Set(selected.map(({ station }) => station.id));
  const output = [];

  if (apply) {
    // Structured adapters do not require AI, but ordinary official schedule
    // pages use the same managed extractor as the long-running server worker.
    // Wiring failure remains non-fatal per station and existing rows are kept.
    await wireScheduleExtractor();
  }

  for (const match of selection.matches) {
    const { station, callsign } = match;
    const prior = await stationStatus(station.id, station.scheduleUrl ?? station.homepageUrl);
    const willApply = apply && selectedIds.has(station.id);
    let final = prior;
    let scraperResult: { scraped: boolean; showCount: number } | null = null;
    let error: string | null = null;

    if (willApply) {
      try {
        scraperResult = await scrapeStationSchedule({
          id: station.id,
          slug: station.slug,
          homepageUrl: station.homepageUrl!,
          scheduleUrl: station.scheduleUrl,
          city: station.city,
          country: station.country,
          ianaTimezone: station.ianaTimezone,
        });
        final = await stationStatus(station.id, station.scheduleUrl ?? station.homepageUrl);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        // A final read lets one failed station be reported without interrupting
        // the bounded sequential batch.
        final = await stationStatus(station.id, station.scheduleUrl ?? station.homepageUrl);
      }
    }

    output.push({
      callsign,
      slug: station.slug,
      sourceUrl: prior.sourceUrl,
      prior,
      final,
      scraperResult,
      error,
      applied: willApply,
    });
  }

  console.log(
    JSON.stringify(
      {
        dryRun: !apply,
        limit: apply ? applyLimit : limit,
        offset,
        verifiedMatches: selection.matches.length,
        eligibleTargets: eligible.length,
        selectedTargets: selected.length,
        skippedWithoutHomepage: selection.matches.length - eligible.length,
        ambiguousCallsigns: selection.ambiguous.length,
        missingSoundtapStations: selection.missing.length,
        stations: output,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshSoundtapSchedules().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}