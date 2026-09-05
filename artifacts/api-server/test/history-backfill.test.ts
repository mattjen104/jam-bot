import { describe, expect, it } from "vitest";
import {
  historySourceContract,
  parseWicbHistory,
  parseWxycDailyPlaylist,
  parseHistoryJson,
  parseHistoryJsonLd,
  parseHistoryRss,
  supportsBackfill,
} from "../src/lore/adapters.js";
import {
  canAuditHistorySource,
  reviewHistoricalBatch,
} from "../src/lore/backfill.js";
import type { RawSpin } from "../src/lore/types.js";

const config = {
  sourceKey: "fixture",
  artistPath: "artist",
  titlePath: "title",
  idPath: "id",
  playedAtPath: "playedAt",
  showPath: "show",
  djPath: "dj",
};

describe("configured station-history source families", () => {
  it("parses WICB's stable ids and station-local timestamps", () => {
    const rows = parseWicbHistory([
      {
        id: "2088063",
        timestamp: "2026-09-02 17:37:42",
        station: "WICB",
        title: "Pretend",
        artist: "Becca Mancari",
        album: "The Greatest Part",
      },
      {
        id: "bad",
        timestamp: "2026-09-02 17:38:00",
        artist: "Missing title",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "wicb:2088063",
      rawArtist: "Becca Mancari",
      rawTitle: "Pretend",
      album: "The Greatest Part",
      sourceFamily: "official_api",
      citationUrl: "https://wicb.org/last92/",
    });
    expect(rows[0]?.playedAt?.toISOString()).toBe("2026-09-02T21:37:42.000Z");
  });

  it("parses WXYC's nested official daily archive and filters non-track entries", () => {
    const body = {
      shows: [
        {
          signonTime: Date.parse("2026-08-20T10:00:00Z"),
          entries: [
            { id: 1, entryType: "talkset", offsetSeconds: 20 },
            {
              id: 2,
              entryType: "playcut",
              offsetSeconds: 60,
              artistName: "Alice Coltrane",
              songTitle: "Journey in Satchidananda",
              releaseTitle: "Journey in Satchidananda",
            },
          ],
        },
      ],
    };
    const rows = parseWxycDailyPlaylist(
      body,
      "https://archive.wxyc.org/api/daily-playlist?date=2026-08-20",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "wxyc:2",
      rawArtist: "Alice Coltrane",
      rawTitle: "Journey in Satchidananda",
      album: "Journey in Satchidananda",
      sourceFamily: "official_api",
    });
    expect(rows[0]?.playedAt?.toISOString()).toBe("2026-08-20T10:01:00.000Z");
    expect(
      parseWxycDailyPlaylist(
        body,
        "https://archive.wxyc.org/api/daily-playlist?date=2026-08-20",
        "2026-08-20T10:02:00Z",
      ),
    ).toHaveLength(1);
    expect(
      parseWxycDailyPlaylist(
        body,
        "https://archive.wxyc.org/api/daily-playlist?date=2026-08-20",
        "2026-08-20T10:01:00Z",
      ),
    ).toHaveLength(0);
  });

  it("parses only complete rows from official JSON", () => {
    const rows = parseHistoryJson(
      {
        plays: [
          {
            id: "p-1",
            artist: "Alice Coltrane",
            title: "Journey in Satchidananda",
            playedAt: "2026-08-20T10:00:00Z",
            show: "Morning Music",
            dj: "Alex",
          },
          { id: "bad", artist: "Missing title" },
        ],
      },
      { ...config, itemsPath: "plays" },
      "https://station.example/api/plays",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "fixture:p-1",
      rawArtist: "Alice Coltrane",
      rawTitle: "Journey in Satchidananda",
      show: { name: "Morning Music", djName: "Alex" },
      sourceFamily: "official_api",
      sourceUrl: "https://station.example/api/plays",
    });
  });

  it("parses reviewed RSS items without reading page prose", () => {
    const rows = parseHistoryRss(
      `<?xml version="1.0"?>
       <rss><channel><item>
         <guid>p-2</guid><artist>Arthur Russell</artist>
         <title>This Is How We Walk on the Moon</title>
         <pubDate>2026-08-20T11:00:00Z</pubDate>
       </item></channel></rss>`,
      {
        ...config,
        idPath: "guid",
        playedAtPath: "pubDate",
        sourceFamily: "rss",
      },
      "https://station.example/history.xml",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceFamily).toBe("rss");
  });

  it("accepts valid JSON-LD blocks and ignores changed or malformed blocks", () => {
    const rows = parseHistoryJsonLd(
      `<script type="application/ld+json">not-json</script>
       <script type="application/ld+json">
         {"itemListElement":[{"id":"p-3","artist":"Broadcast","title":"Come On Let's Go","playedAt":"2026-08-20T12:00:00Z"}]}
       </script>`,
      { ...config, itemsPath: "itemListElement", sourceFamily: "structured_data" },
      "https://station.example/playlist",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceFamily).toBe("structured_data");
  });
});

describe("historical row safety gate", () => {
  const now = new Date("2026-08-20T13:00:00Z");
  const spin = (overrides: Partial<RawSpin> = {}): RawSpin => ({
    rawArtist: "Can",
    rawTitle: "Future Days",
    externalId: "fixture:1",
    playedAt: new Date("2026-08-20T12:00:00Z"),
    ...overrides,
  });

  it("rejects duplicate, future, placeholder, and identity-ambiguous rows", () => {
    const review = reviewHistoricalBatch(
      [
        spin(),
        spin(),
        spin({ externalId: "fixture:future", playedAt: new Date("2026-08-21") }),
        spin({ externalId: "fixture:junk", rawArtist: "Station ID" }),
        spin({ externalId: undefined }),
      ],
      now,
    );
    expect(review.accepted).toHaveLength(1);
    expect(review.outcomes).toEqual([
      "duplicate",
      "future_dated",
      "junk_metadata",
      "ambiguous_row",
    ]);
  });
});

describe("history source contract", () => {
  it("describes no-key Spinitron history as unsupported, not empty", () => {
    const noKey = historySourceContract("spinitron", {});
    expect(noKey).toMatchObject({
      surface: "Spinitron authenticated playlist API",
      supportsBackfill: false,
      retryPolicy: "unsupported",
    });
    expect(canAuditHistorySource(noKey, true)).toBe(false);
    expect(historySourceContract("spinitron", { accessToken: "configured" }))
      .toMatchObject({ supportsBackfill: true, retryPolicy: "retryable" });
  });
  it("describes WICB as a shallow, independently cited archive", () => {
    expect(supportsBackfill("wicb_history")).toBe(false);
    expect(historySourceContract("wicb_history")).toMatchObject({
      family: "official_api",
      cursorMode: "fixed_feed",
      supportsBackfill: false,
      stableIdentity: "required",
      reportedTimestamp: "required",
      archiveCitation: "dated",
      supportedDepthDays: 1,
    });
  });

  it("describes WXYC as an independent, time-anchored archive", () => {
    expect(supportsBackfill("wxyc_history")).toBe(true);
    expect(historySourceContract("wxyc_history")).toMatchObject({
      family: "official_api",
      cursorMode: "time_anchor",
      supportsBackfill: true,
      stableIdentity: "required",
      reportedTimestamp: "required",
      archiveCitation: "dated",
    });
  });

  it("requires an explicit time anchor for generic deep backfill", () => {
    expect(supportsBackfill("station_history_json", {})).toBe(false);
    expect(
      supportsBackfill("station_history_json", {
        cursorMode: "time_anchor",
        beforeParam: "before",
      }),
    ).toBe(true);
    expect(
      historySourceContract("station_history_json", {
        cursorMode: "time_anchor",
        beforeParam: "before",
      }),
    ).toMatchObject({
      family: "official_api",
      cursorMode: "time_anchor",
      supportsBackfill: true,
      stableIdentity: "required",
      reportedTimestamp: "required",
    });
  });
});