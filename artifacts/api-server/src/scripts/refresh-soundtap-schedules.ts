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
import {
  canStartMonitoredTrial,
  MONITORED_TRIAL_DAYS,
} from "../lore/monitored-trial.js";
import { enrollStationPoller } from "../lore/poller.js";
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

export function parseArgs(args: string[]): {
  apply: boolean;
  limit: number | null;
  offset: number;
  trialSlug: string | null;
} {
  const apply = args.includes("--apply");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const offsetArg = args.find((arg) => arg.startsWith("--offset="));
  const trialArg = args.find((arg) => arg.startsWith("--trial="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
  const offset = offsetArg ? Number(offsetArg.slice("--offset=".length)) : 0;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  if (trialArg && !apply) {
    throw new Error("--trial is state-changing and requires --apply");
  }
  return {
    apply,
    limit,
    offset,
    trialSlug: trialArg?.slice("--trial=".length).trim() || null,
  };
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
  const { apply, limit, offset, trialSlug } = parseArgs(args);
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
      streamUrl: stationsTable.streamUrl,
      nowPlayingSource: stationsTable.nowPlayingSource,
      active: stationsTable.active,
      hidden: stationsTable.hidden,
      crossingEligible: stationsTable.crossingEligible,
      upcomingShowCount: stationsTable.upcomingShowCount,
      config: stationsTable.nowPlayingConfig,
    })
    .from(stationsTable)
    ;

  const selection = selectVerifiedSoundtapMatches(soundtap, stations);
  // A scraper target must be entirely DB-derived. The Soundtap slug is only
  // identity evidence; it is never used to construct or guess a URL.
  const seenStationIds = new Set<number>();
  const eligible = selection.shared
    .filter(({ station }) => {
      if (!station.homepageUrl || seenStationIds.has(station.id)) return false;
      seenStationIds.add(station.id);
      return true;
    })
    .sort(
      (a, b) =>
        (a.station.upcomingShowCount ?? 0) - (b.station.upcomingShowCount ?? 0) ||
        a.soundtap.label.localeCompare(b.soundtap.label),
    );
  // Dry runs list every verified overlap. Applies are deliberately bounded
  // even when the operator omits --limit.
  const applyLimit = limit ?? DEFAULT_APPLY_LIMIT;
  const scheduleApply = apply && !trialSlug;
  const selected = scheduleApply ? eligible.slice(offset, offset + applyLimit) : [];
  const selectedIds = new Set(selected.map(({ station }) => station.id));
  const output = [];
  let trialFound = false;

  if (scheduleApply) {
    // Structured adapters do not require AI, but ordinary official schedule
    // pages use the same managed extractor as the long-running server worker.
    // Wiring failure remains non-fatal per station and existing rows are kept.
    await wireScheduleExtractor();
  }

  for (const match of selection.shared) {
    const { station } = match;
    const prior = await stationStatus(station.id, station.scheduleUrl ?? station.homepageUrl);
    const willApply = scheduleApply && selectedIds.has(station.id);
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

    let trialStarted = false;
    if (trialSlug === station.slug) {
      trialFound = true;
      if (
        match.confidence !== "high" ||
        !canStartMonitoredTrial(station)
      ) {
        throw new Error(
          `station ${station.slug} lacks high-confidence identity or first-party polling evidence`,
        );
      }
      const startedAt = new Date();
      const endsAt = new Date(
        startedAt.getTime() + MONITORED_TRIAL_DAYS * 86_400_000,
      );
      const [updated] = await db
        .update(stationsTable)
        .set({
          active: true,
          nowPlayingConfig: {
            ...(station.config ?? {}),
            monitoredTrial: {
              kind: "soundtap_candidate",
              startedAt: startedAt.toISOString(),
              endsAt: endsAt.toISOString(),
            },
          },
        })
        .where(eq(stationsTable.id, station.id))
        .returning();
      if (!updated) throw new Error(`station ${station.slug} disappeared`);
      enrollStationPoller(updated);
      trialStarted = true;
    }

    output.push({
      identity: {
        confidence: match.confidence,
        score: match.score,
        signals: match.signals,
      },
      slug: station.slug,
      sourceUrl: prior.sourceUrl,
      prior,
      final,
      scraperResult,
      error,
      applied: willApply,
      trialStarted,
    });
  }
  if (trialSlug && !trialFound) {
    throw new Error(
      `--trial target ${trialSlug} is not a uniquely verified Soundtap identity`,
    );
  }

  console.log(
    JSON.stringify(
      {
        dryRun: !apply,
        limit: scheduleApply ? applyLimit : limit,
        offset,
        verifiedMatches: selection.shared.length,
        eligibleTargets: eligible.length,
        selectedTargets: selected.length,
        skippedWithoutHomepage: selection.shared.length - eligible.length,
        ambiguousIdentities: selection.ambiguous.length,
        absentSoundtapStations: selection.absent.length,
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