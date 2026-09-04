/* eslint-disable no-console -- this file is a command-line audit report */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, scrapedShowsTable, stationsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const SOUNDTAP_SOURCE = fileURLToPath(
  new URL("../../../../research/sources/soundtap-home.md", import.meta.url),
);
const REPORT_PATH = fileURLToPath(
  new URL("../../../../research/soundtap-schedule-gap.json", import.meta.url),
);

export interface SoundtapStation {
  slug: string;
  label: string;
  callsign: string | null;
  evidenceUrl: string;
}

export function canonicalCallsign(value: string): string | null {
  const candidate = value
    .toUpperCase()
    .replace(/[–—].*$/, "")
    .match(/\b([A-Z]{1,5}(?:-FM|-LP|-FM-LP| HD ?\d)?)\b/)?.[1]
    ?.replace(/\s+/g, "");
  if (!candidate || candidate.length < 3) return null;
  // Ordinary words and network names are not broadcast callsigns.
  if (
    ["RADIO", "RADYO", "PURE", "LIVE", "THE", "FM", "AM", "BBC", "NTS"].includes(
      candidate,
    )
  ) {
    return null;
  }
  return candidate;
}

export interface SoundtapCallsignCandidate {
  id: number;
  slug: string;
  name: string;
  org: string | null;
  homepageUrl: string | null;
  scheduleUrl: string | null;
  config: Record<string, unknown> | null;
}

/**
 * Match only a callsign printed in the preserved Soundtap link. Slugs and
 * display-name similarity are deliberately never identity evidence.
 */
export function selectVerifiedSoundtapMatches<T extends SoundtapCallsignCandidate>(
  soundtap: SoundtapStation[],
  stations: T[],
): {
  matches: Array<{ soundtap: SoundtapStation; station: T; callsign: string }>;
  ambiguous: Array<{ soundtap: SoundtapStation; callsign: string; candidates: T[] }>;
  missing: SoundtapStation[];
} {
  const byCallsign = new Map<string, T[]>();
  for (const station of stations) {
    const configured =
      typeof station.config?.callsign === "string"
        ? canonicalCallsign(station.config.callsign)
        : null;
    const callsign =
      configured ?? canonicalCallsign(station.name) ?? canonicalCallsign(station.org ?? "");
    if (!callsign) continue;
    const bucket = byCallsign.get(callsign) ?? [];
    bucket.push(station);
    byCallsign.set(callsign, bucket);
  }

  const matches: Array<{ soundtap: SoundtapStation; station: T; callsign: string }> = [];
  const ambiguous: Array<{ soundtap: SoundtapStation; callsign: string; candidates: T[] }> = [];
  const missing: SoundtapStation[] = [];
  for (const source of soundtap) {
    if (!source.callsign) {
      missing.push(source);
      continue;
    }
    const candidates = byCallsign.get(source.callsign) ?? [];
    if (candidates.length === 1) {
      matches.push({ soundtap: source, station: candidates[0]!, callsign: source.callsign });
    } else if (candidates.length > 1) {
      ambiguous.push({ soundtap: source, callsign: source.callsign, candidates });
    } else {
      missing.push(source);
    }
  }
  return { matches, ambiguous, missing };
}

export function parseSoundtapStations(markdown: string): SoundtapStation[] {
  const stationLink = /^\[([^\]]+)\]\((https:\/\/soundtap\.fm\/stations\/([^/)]+))\)$/gm;
  const bySlug = new Map<string, SoundtapStation>();
  for (const match of markdown.matchAll(stationLink)) {
    const label = match[1]!.trim();
    const slug = match[3]!;
    bySlug.set(slug, {
      slug,
      label,
      callsign: canonicalCallsign(label),
      evidenceUrl: match[2]!,
    });
  }
  return [...bySlug.values()];
}

async function main(): Promise<void> {
  const soundtap = parseSoundtapStations(await readFile(SOUNDTAP_SOURCE, "utf8"));
  const lore = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      homepageUrl: stationsTable.homepageUrl,
      scheduleUrl: stationsTable.scheduleUrl,
      scrapedAt: stationsTable.scheduleScrapedAt,
      showCount: stationsTable.upcomingShowCount,
      config: stationsTable.nowPlayingConfig,
    })
    .from(stationsTable)
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)));

  const selection = selectVerifiedSoundtapMatches(soundtap, lore);
  const matches = selection.matches.map(({ soundtap: source, station, callsign }) => ({
    soundtap: source.slug,
    soundtapLabel: source.label,
    evidenceUrl: source.evidenceUrl,
    kind: "verified_callsign",
    callsign,
    id: station.id,
    slug: station.slug,
    name: station.name,
    homepageUrl: station.homepageUrl,
    scheduleUrl: station.scheduleUrl,
    scrapedAt: station.scrapedAt,
    showCount: station.showCount,
  }));
  const ambiguous = selection.ambiguous.map(({ soundtap: source, callsign, candidates }) => ({
        soundtap: source.slug,
        callsign,
        loreCandidates: candidates.map((candidate) => ({
          id: candidate.id,
          slug: candidate.slug,
          homepageUrl: candidate.homepageUrl,
        })),
      }));
  const missing = selection.missing;

  const matchedIds = matches.map((match) => match.id);
  const coverage = matchedIds.length
    ? await db
        .select({
          slots: sql<number>`count(*)::int`,
          stations: sql<number>`count(distinct ${scrapedShowsTable.stationId})::int`,
          sources: sql<number>`count(distinct ${scrapedShowsTable.sourceUrl})::int`,
        })
        .from(scrapedShowsTable)
        .where(
          sql`${scrapedShowsTable.stationId} = any(array[${sql.join(
            matchedIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::integer[]) and ${scrapedShowsTable.voidedAt} is null`,
        )
    : [{ slots: 0, stations: 0, sources: 0 }];

  const populated = matches.filter((match) => match.showCount > 0);
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      identity:
        "Exact callsign printed in the preserved Soundtap station link matched to Lore's configured callsign or station name. Slugs are never identity evidence; ambiguous callsigns are excluded.",
      sourceSnapshot: "research/sources/soundtap-home.md",
      scheduleFacts:
        "Counts come only from Lore scraped_shows rows, which retain the official source URL and extraction method.",
    },
    soundtap: { stations: soundtap.length, shows: 7713 },
    matches: matches.length,
    missing: missing.length,
    ambiguous: ambiguous.length,
    sharedWithShows: populated.length,
    showSlotCoverage: coverage[0]?.slots ?? 0,
    officialScheduleSources: coverage[0]?.sources ?? 0,
    sharedNoShows: matches.filter((match) => match.showCount === 0),
    matchedStations: matches,
    ambiguousStations: ambiguous,
    missingSoundtapStations: missing.map(({ slug, label, callsign, evidenceUrl }) => ({
      slug,
      label,
      callsign,
      evidenceUrl,
    })),
  };

  const shouldWrite = process.argv.includes("--write");
  if (shouldWrite) {
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(
    JSON.stringify(
      {
        matches: report.matches,
        missing: report.missing,
        ambiguous: report.ambiguous,
        populatedSchedules: report.sharedWithShows,
        showSlotCoverage: report.showSlotCoverage,
        officialScheduleSources: report.officialScheduleSources,
        wrote: shouldWrite ? REPORT_PATH : null,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}