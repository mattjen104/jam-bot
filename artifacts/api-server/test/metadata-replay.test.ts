import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADAPTER_REGISTRY_SOURCE_FAMILIES,
  parseBbcSegments,
  parseFipSteps,
  parseHistoryJson,
  parseHistoryJsonLd,
  parseHistoryRss,
  parseIcyNowPlaying,
  parseKcrwTrack,
  parseKexpPlays,
  parseLotRadioSchedule,
  parseNtsLive,
  parseRadiojarNowPlaying,
  parseRadioParadiseNowPlaying,
  parseSpinitronSpins,
  parseSpinitronWebPage,
  parseStationPage,
  parseSomaFmSongs,
} from "../src/lore/adapters.js";
import {
  classifyMetadataQuality,
  type MetadataQualityOutcome,
} from "../src/lore/metadata-quality.js";

type ReplayStatus = "accepted" | "rejected" | "unknown";
type ReplayParser =
  | "radio_paradise"
  | "station_page"
  | "icy_now_playing"
  | "kexp_plays"
  | "spinitron_spins"
  | "bbc_segments"
  | "somafm_songs"
  | "kcrw_track"
  | "nts_live"
  | "fip_steps"
  | "radiojar"
  | "spinitron_web"
  | "lot_radio_schedule"
  | "history_json"
  | "history_rss"
  | "history_jsonld"
  | "quality";

interface ReplayFixture {
  id: string;
  source: string;
  surface: string;
  context: string;
  parser: ReplayParser;
  input: unknown;
  qualityInput?: { artist: string | null; title: string | null };
  expected: {
    status: ReplayStatus;
    artist: string | null;
    title: string | null;
    quality: MetadataQualityOutcome;
    reason?: string;
  };
}

interface Pair {
  rawArtist?: string;
  rawTitle?: string;
}

interface SourceCounts {
  accepted: number;
  junkRejected: number;
  incompletePair: number;
  emptyOrUnknown: number;
  parserErrors: number;
}

const corpusPath = resolve(
  import.meta.dirname,
  "fixtures",
  "metadata-replay.json",
);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as ReplayFixture[];

function pairs(value: unknown): Pair[] {
  if (Array.isArray(value)) return value as Pair[];
  if (value && typeof value === "object") return [value as Pair];
  return [];
}

function runParser(fixture: ReplayFixture): unknown {
  switch (fixture.parser) {
    case "radio_paradise":
      return parseRadioParadiseNowPlaying(fixture.input);
    case "station_page": {
      const input = fixture.input as {
        body: unknown;
        config: Record<string, unknown>;
      };
      return parseStationPage(input.body, input.config);
    }
    case "icy_now_playing":
      return parseIcyNowPlaying(fixture.input as string);
    case "kexp_plays": {
      const input = fixture.input as {
        body: unknown;
        showMap?: [number, { name: string; djName?: string }][];
      };
      return parseKexpPlays(input.body, new Map(input.showMap ?? []));
    }
    case "spinitron_spins": {
      const input = fixture.input as {
        body: unknown;
        playlistMap?: [number, { name: string; djName?: string }][];
      };
      return parseSpinitronSpins(
        input.body,
        new Map(input.playlistMap ?? []),
      );
    }
    case "bbc_segments":
      return parseBbcSegments(fixture.input);
    case "somafm_songs": {
      const input = fixture.input as { body: unknown; channel: string };
      return parseSomaFmSongs(input.body, input.channel);
    }
    case "kcrw_track": {
      const input = fixture.input as { body: unknown; feed: string };
      return parseKcrwTrack(input.body, input.feed);
    }
    case "nts_live": {
      const input = fixture.input as { now: Record<string, unknown> };
      return parseNtsLive({ now: input.now }, Date.parse("2026-07-09T18:00:00Z"));
    }
    case "fip_steps": {
      const input = fixture.input as {
        steps: Record<string, Record<string, unknown>>;
        nowSec: number;
      };
      return parseFipSteps(input.steps, input.nowSec);
    }
    case "radiojar":
      return parseRadiojarNowPlaying(fixture.input);
    case "spinitron_web":
      return parseSpinitronWebPage(fixture.input as string);
    case "lot_radio_schedule": {
      const input = fixture.input as { rsc: string; now: string };
      return parseLotRadioSchedule(input.rsc, new Date(input.now));
    }
    case "history_json": {
      const input = fixture.input as {
        body: unknown;
        config: Record<string, unknown>;
        sourceUrl: string;
      };
      return parseHistoryJson(input.body, input.config, input.sourceUrl);
    }
    case "history_rss": {
      const input = fixture.input as {
        xml: string;
        config: Record<string, unknown>;
        sourceUrl: string;
      };
      return parseHistoryRss(input.xml, input.config, input.sourceUrl);
    }
    case "history_jsonld": {
      const input = fixture.input as {
        html: string;
        config: Record<string, unknown>;
        sourceUrl: string;
      };
      return parseHistoryJsonLd(input.html, input.config, input.sourceUrl);
    }
    case "quality": {
      const input = fixture.input as {
        artist: string | null;
        title: string | null;
      };
      return { rawArtist: input.artist ?? undefined, rawTitle: input.title ?? undefined };
    }
  }
}

function classifyFixture(
  fixture: ReplayFixture,
  outputPairs: Pair[],
): MetadataQualityOutcome {
  const pair = outputPairs[0];
  const qualityInput = pair
    ? { artist: pair.rawArtist ?? null, title: pair.rawTitle ?? null }
    : fixture.qualityInput;
  if (!qualityInput) return "empty_metadata";
  return classifyMetadataQuality(qualityInput.artist, qualityInput.title).outcome;
}

function emptyCounts(): SourceCounts {
  return {
    accepted: 0,
    junkRejected: 0,
    incompletePair: 0,
    emptyOrUnknown: 0,
    parserErrors: 0,
  };
}

describe("reviewed station metadata replay corpus", () => {
  it("covers every source family and enforces the reviewed precision bar", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(30);

    const corpusSources = new Set(corpus.map((fixture) => fixture.source));
    const missingSources = [
      ...ADAPTER_REGISTRY_SOURCE_FAMILIES.nowPlaying.map((source) => ({
        family: "now-playing",
        source,
      })),
      ...ADAPTER_REGISTRY_SOURCE_FAMILIES.history.map((source) => ({
        family: "history",
        source,
      })),
    ]
      .filter(({ source }) => !corpusSources.has(source))
      .map(({ family, source }) => `${family} source "${source}"`);

    expect(
      missingSources,
      [
        "Every registered station metadata adapter must have a reviewed replay fixture family.",
        `Missing: ${missingSources.join(", ") || "(none)"}`,
        "Add accepted, rejected, and unknown examples as appropriate; see artifacts/api-server/test/fixtures/metadata-replay.md.",
      ].join("\n"),
    ).toEqual([]);

    const counts = new Map<string, SourceCounts>();
    const extracted: string[] = [];
    const rejectionReasons = new Map<string, number>();

    for (const fixture of corpus) {
      const sourceCounts = counts.get(fixture.source) ?? emptyCounts();
      counts.set(fixture.source, sourceCounts);

      let output: unknown;
      let parserError: unknown;
      try {
        output = runParser(fixture);
      } catch (error) {
        parserError = error;
        sourceCounts.parserErrors++;
      }

      expect(
        parserError,
        `${fixture.id} (${fixture.source}) parser error`,
      ).toBeUndefined();

      const outputPairs = pairs(output);
      const actualPair = outputPairs[0];
      const expected = fixture.expected;

      if (actualPair) {
        extracted.push(
          `${fixture.source}/${fixture.id}: ${actualPair.rawArtist ?? "?"} — ${actualPair.rawTitle ?? "?"}`,
        );
        expect(actualPair.rawArtist ?? null, fixture.id).toBe(expected.artist);
        expect(actualPair.rawTitle ?? null, fixture.id).toBe(expected.title);
      } else {
        expect(null, fixture.id).toBe(expected.artist);
        expect(null, fixture.id).toBe(expected.title);
      }

      const quality = classifyFixture(fixture, outputPairs);
      expect(quality, `${fixture.id} quality`).toBe(expected.quality);

      if (expected.status === "accepted") {
        expect(outputPairs, `${fixture.id} must yield a pair`).toHaveLength(1);
        expect(quality, `${fixture.id} accepted quality`).toBe("usable_pair");
        sourceCounts.accepted++;
      } else if (expected.status === "rejected") {
        expect(quality, `${fixture.id} rejected quality`).toBe("junk_metadata");
        sourceCounts.junkRejected++;
      } else if (
        quality === "incomplete_pair"
      ) {
        sourceCounts.incompletePair++;
      } else {
        sourceCounts.emptyOrUnknown++;
      }

      if (expected.reason) {
        rejectionReasons.set(
          expected.reason,
          (rejectionReasons.get(expected.reason) ?? 0) + 1,
        );
      }
    }

    const report = [...counts.entries()]
      .map(([source, sourceCounts]) => ({
        source,
        ...sourceCounts,
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
    console.info("[metadata replay] per-source report", report);
    console.info("[metadata replay] extracted fields", extracted);
    console.info(
      "[metadata replay] rejection reasons",
      Object.fromEntries(rejectionReasons),
    );

    expect(
      report.every((row) => row.parserErrors === 0),
      "parser errors are regressions",
    ).toBe(true);
    expect(
      report.reduce((sum, row) => sum + row.accepted, 0),
      "reviewed accepted music pairs",
    ).toBeGreaterThanOrEqual(12);
    expect(
      report.reduce((sum, row) => sum + row.junkRejected, 0),
      "known junk must remain rejected",
    ).toBeGreaterThanOrEqual(5);
    expect(
      report.reduce((sum, row) => sum + row.incompletePair, 0),
      "incomplete pairs must remain visible",
    ).toBeGreaterThanOrEqual(3);
  });
});