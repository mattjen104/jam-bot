import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";
import { parseHistoryJson } from "../src/lore/adapters.js";
import {
  BRO_ZONES_CANDIDATE_AUDIT,
  BRO_ZONES_MEMBERSHIPS,
  BRO_ZONES_REVIEWED,
  applyBroZonesMigration,
} from "../src/lore/bro-zones-migration.js";
import { SEED_STATIONS } from "../src/lore/seed.js";
import { composeStationCatalog } from "../src/lore/station-catalog.js";

describe("Bro Zones reviewed coverage", () => {
  it("keeps all eight canonical zones explicit and additive", () => {
    expect(BRO_ZONES_REVIEWED).toEqual([
      "seattle",
      "portland",
      "denver",
      "cleveland",
      "los-angeles",
      "redlands-inland-empire",
      "washington-dc",
      "north-carolina",
    ]);
    expect(new Set(BRO_ZONES_REVIEWED).size).toBe(8);
  });

  it("documents every researched candidate and qualifies only reproducible history", () => {
    expect(BRO_ZONES_CANDIDATE_AUDIT.map(({ slug }) => slug)).toEqual([
      "knkx",
      "kbcs",
      "kboo",
      "kmhd",
      "kgnu",
      "wjcu",
      "the-socal-sound",
      "wowd",
      "wncw",
    ]);
    expect(
      BRO_ZONES_CANDIDATE_AUDIT.filter(({ qualified }) => qualified).map(
        ({ slug }) => slug,
      ),
    ).toEqual(["wjcu"]);
    for (const candidate of BRO_ZONES_CANDIDATE_AUDIT) {
      expect(candidate.identityUrl).toMatch(/^https:/);
      expect(candidate.scheduleUrl).toMatch(/^https:/);
      expect(candidate.historyUrl).toMatch(/^https:/);
      expect(candidate.auditNote.length).toBeGreaterThan(20);
    }
  });

  it("seeds and enrolls only the qualified shortlist station", () => {
    const candidateSlugs = new Set(
      BRO_ZONES_CANDIDATE_AUDIT.map(({ slug }) => slug),
    );
    const seededCandidates = SEED_STATIONS.filter(({ slug }) =>
      candidateSlugs.has(slug),
    );
    expect(seededCandidates.map(({ slug }) => slug)).toEqual(["wjcu"]);
    expect(BRO_ZONES_MEMBERSHIPS).toHaveLength(14);
    expect(
      BRO_ZONES_MEMBERSHIPS.filter(({ zone }) => zone === "cleveland").map(
        ({ slug }) => slug,
      ),
    ).toEqual(["wruw", "wjcu"]);
  });

  it("documents secure access without treating an unaudited key as qualification", () => {
    const pendingAccess = BRO_ZONES_CANDIDATE_AUDIT.filter(
      ({ access }) => access !== null,
    );
    expect(
      pendingAccess.map(({ slug, access }) => [slug, access!.secretName]),
    ).toEqual([
      ["knkx", "CADENCE_KEY_KNKX"],
      ["kbcs", "SPINITRON_KEY_KBCS"],
      ["kboo", "SPINITRON_KEY_KBOO"],
      ["wowd", "SPINITRON_KEY_WOWD"],
      ["wncw", "CADENCE_KEY_WNCW"],
    ]);
    expect(pendingAccess.every(({ qualified }) => !qualified)).toBe(true);
    expect(
      BRO_ZONES_MEMBERSHIPS.some(({ slug }) =>
        pendingAccess.some((candidate) => candidate.slug === slug),
      ),
    ).toBe(false);
  });

  it("maps WJCU's official Creek rows to stable, timestamped spins", () => {
    const station = SEED_STATIONS.find(({ slug }) => slug === "wjcu");
    expect(station).toMatchObject({
      active: true,
      hidden: false,
      streamUrl:
        "https://streaming.jcu.edu/listen/wjcu_radio/wjcu-aac-hi",
      nowPlayingSource: "station_history_json",
    });
    const config = station!.nowPlayingConfig as Record<string, unknown>;
    const rows = parseHistoryJson(
      {
        data: [
          {
            id: 18881705,
            start: "2026-09-11T01:14:42.000000Z",
            song: {
              artist: "Aaron Neville",
              title: "Tell It Like It Is",
              album: "Tell It Like It Is - The Par Lo Years",
              isrc: "NLG620403520",
              musicbrainz_id: "f66f57fb-ea47-4ef6-8d79-3068a53de48b",
            },
            broadcast: { show: { title: "Grooveyard" } },
          },
        ],
      },
      config,
      String(config.url),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "wjcu:18881705",
      playedAt: new Date("2026-09-11T01:14:42.000Z"),
      rawArtist: "Aaron Neville",
      rawTitle: "Tell It Like It Is",
      isrc: "NLG620403520",
      recordingId: "f66f57fb-ea47-4ef6-8d79-3068a53de48b",
      show: { name: "Grooveyard", attributionSource: "source_api" },
    });
  });

  it("keeps WJCU playable in the listener catalog and Cleveland Bro Zone", () => {
    const seed = SEED_STATIONS.find(({ slug }) => slug === "wjcu")!;
    const row = {
      ...seed,
      id: 887,
      slug: "wjcu",
      active: true,
      hidden: false,
      crossingEligible: true,
      streamUrl: seed.streamUrl!,
      broZones: ["cleveland"],
      libraryCrossings: 0,
      libraryArtistCrossings: 0,
      focusedArtistCrossings: 0,
      discoveryScore: 0,
      live: false,
      followed: false,
      support: false,
    };

    expect(
      composeStationCatalog(
        [row],
        "all",
        { stationTypes: [], formats: [], decades: [] },
        "name",
        null,
        50,
        10,
      ).items.map(({ station }) => station.slug),
    ).toEqual(["wjcu"]);
    expect(
      composeStationCatalog(
        [row],
        "all",
        {
          stationTypes: [],
          formats: [],
          decades: [],
          broZones: ["cleveland"],
        },
        "name",
        null,
        50,
        10,
      ).items.map(({ station }) => station.slug),
    ).toEqual(["wjcu"]);
  });

  it("applies reviewed memberships in a separate prepared statement", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 0 });
    const database = { execute } as unknown as Pick<typeof db, "execute">;

    await applyBroZonesMigration(database);

    expect(execute).toHaveBeenCalledTimes(4);
    const membershipStatement = JSON.stringify(execute.mock.calls[3]?.[0]);
    expect(membershipStatement).toContain("station_collection_memberships");
    expect(membershipStatement).toContain("wjcu");
    expect(membershipStatement).toContain("cleveland");
    for (const call of execute.mock.calls.slice(0, 3)) {
      expect(JSON.stringify(call[0])).not.toContain(
        "station_collection_memberships",
      );
    }
  });
});