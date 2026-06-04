import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AcrMatch } from "../src/turntable/acrcloud.js";

vi.mock("../src/turntable/musicbrainz.js", () => ({
  musicbrainzEnabled: vi.fn(() => true),
  resolveRecordingId: vi.fn(),
  fetchRecordingCredits: vi.fn(),
}));
vi.mock("../src/turntable/discogs.js", () => ({
  discogsEnabled: vi.fn(() => true),
  fetchDiscogsPressing: vi.fn(),
}));

const knowledge = await import("../src/turntable/knowledge.js");
const mb = await import("../src/turntable/musicbrainz.js");
const dc = await import("../src/turntable/discogs.js");

function mkMatch(over: Partial<AcrMatch> = {}): AcrMatch {
  return {
    acrid: "acr-1",
    title: "Midnight City",
    artist: "M83",
    album: "Hurry Up, We're Dreaming",
    playOffsetMs: 0,
    ...over,
  };
}

const spTrack = {
  id: "sp1",
  uri: "spotify:track:sp1",
  title: "Midnight City",
  artist: "M83",
  album: "Hurry Up, We're Dreaming",
  durationMs: 240000,
};

function uniqueIsrc() {
  return `TEST${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  (mb.musicbrainzEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (dc.discogsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

describe("buildCacheKey", () => {
  it("uses uppercased ISRC when present, else a title|artist digest", () => {
    expect(knowledge.buildCacheKey(mkMatch({ isrc: "gbum71200001" }))).toBe(
      "isrc:GBUM71200001",
    );
    expect(knowledge.buildCacheKey(mkMatch({ isrc: undefined }))).toBe(
      "tt:midnight city|m83",
    );
  });
});

describe("enrichTrack", () => {
  it("combines MusicBrainz credits + Discogs pressing; exact when via ISRC", async () => {
    const isrc = uniqueIsrc();
    (mb.resolveRecordingId as ReturnType<typeof vi.fn>).mockResolvedValue(
      "rec-1",
    );
    (
      mb.fetchRecordingCredits as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      recordingId: "rec-1",
      artistId: "art-1",
      artistName: "M83",
      personnel: [{ role: "producer", name: "JMJ" }],
      workIds: [],
    });
    (dc.fetchDiscogsPressing as ReturnType<typeof vi.fn>).mockResolvedValue({
      label: "Mute",
      year: 2011,
    });

    const result = await knowledge.enrichTrack({
      match: mkMatch({ isrc }),
      track: spTrack,
      viaIsrc: true,
    });
    expect(result).not.toBeNull();
    expect(result?.recordingId).toBe("rec-1");
    expect(result?.personnel).toEqual([{ role: "producer", name: "JMJ" }]);
    expect(result?.pressing).toEqual({ label: "Mute", year: 2011 });
    expect(result?.approximate).toBe(false);
  });

  it("caches by canonical key — a repeat play does not re-query sources", async () => {
    const isrc = uniqueIsrc();
    (mb.resolveRecordingId as ReturnType<typeof vi.fn>).mockResolvedValue(
      "rec-2",
    );
    (mb.fetchRecordingCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordingId: "rec-2",
      personnel: [{ role: "composer", name: "Writer" }],
      workIds: [],
    });
    (dc.fetchDiscogsPressing as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const args = { match: mkMatch({ isrc }), track: spTrack, viaIsrc: true };
    await knowledge.enrichTrack(args);
    await knowledge.enrichTrack(args);
    expect(mb.resolveRecordingId).toHaveBeenCalledTimes(1);
    expect(mb.fetchRecordingCredits).toHaveBeenCalledTimes(1);
    expect(dc.fetchDiscogsPressing).toHaveBeenCalledTimes(1);
  });

  it("converges different ISRCs of the same recording on the canonical entry", async () => {
    (mb.resolveRecordingId as ReturnType<typeof vi.fn>).mockResolvedValue(
      "rec-shared",
    );
    (mb.fetchRecordingCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordingId: "rec-shared",
      personnel: [{ role: "producer", name: "Shared" }],
      workIds: [],
    });
    (dc.fetchDiscogsPressing as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // Two distinct ISRCs that MusicBrainz resolves to the same recording id.
    await knowledge.enrichTrack({
      match: mkMatch({ isrc: uniqueIsrc() }),
      track: spTrack,
      viaIsrc: true,
    });
    await knowledge.enrichTrack({
      match: mkMatch({ isrc: uniqueIsrc() }),
      track: spTrack,
      viaIsrc: true,
    });
    // resolveRecordingId runs for each (cheap), but the heavy credits + Discogs
    // fetch only happens once because the second hits the canonical cache.
    expect(mb.resolveRecordingId).toHaveBeenCalledTimes(2);
    expect(mb.fetchRecordingCredits).toHaveBeenCalledTimes(1);
    expect(dc.fetchDiscogsPressing).toHaveBeenCalledTimes(1);
  });

  it("is approximate when matched by title (not ISRC)", async () => {
    (mb.resolveRecordingId as ReturnType<typeof vi.fn>).mockResolvedValue(
      "rec-3",
    );
    (mb.fetchRecordingCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      recordingId: "rec-3",
      personnel: [{ role: "producer", name: "P" }],
      workIds: [],
    });
    (dc.fetchDiscogsPressing as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await knowledge.enrichTrack({
      match: mkMatch({ isrc: uniqueIsrc() }),
      track: spTrack,
      viaIsrc: false,
    });
    expect(result?.approximate).toBe(true);
  });

  it("returns null when nothing useful resolves", async () => {
    (mb.resolveRecordingId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mb.fetchRecordingCredits as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    (dc.fetchDiscogsPressing as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await knowledge.enrichTrack({
      match: mkMatch({ isrc: uniqueIsrc() }),
      track: spTrack,
      viaIsrc: true,
    });
    expect(result).toBeNull();
  });

  it("no-ops (returns null) when no source is enabled", async () => {
    (mb.musicbrainzEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (dc.discogsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await knowledge.enrichTrack({
      match: mkMatch({ isrc: uniqueIsrc() }),
      track: spTrack,
      viaIsrc: true,
    });
    expect(result).toBeNull();
    expect(mb.resolveRecordingId).not.toHaveBeenCalled();
  });
});

describe("knowledgeBlocks", () => {
  it("renders grouped credits + pressing into a section block", () => {
    const blocks = knowledge.knowledgeBlocks({
      recordingId: "rec-1",
      personnel: [
        { role: "producer", name: "JMJ" },
        { role: "composer", name: "Writer" },
        { role: "guitar", name: "Player A" },
      ],
      pressing: { label: "Mute", year: 2011, country: "GB", format: "Vinyl" },
      approximate: false,
      fetchedAtMs: Date.now(),
    });
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text).toContain("Liner notes");
    expect(text).toContain("*Produced by:* JMJ");
    expect(text).toContain("*Written by:* Writer");
    expect(text).toContain("Player A (guitar)");
    expect(text).toContain("*Pressing:* Mute · 2011 · GB · Vinyl");
    expect(text).not.toContain("may not match");
  });

  it("labels approximate results and prepends a summary line", () => {
    const blocks = knowledge.knowledgeBlocks(
      {
        personnel: [{ role: "producer", name: "P" }],
        approximate: true,
        fetchedAtMs: Date.now(),
      },
      "A producer-driven cut.",
    );
    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text).toContain("may not match this exact recording");
    expect(text).toContain("_A producer-driven cut._");
  });

  it("returns [] when there is nothing worth showing", () => {
    expect(
      knowledge.knowledgeBlocks({
        personnel: [],
        approximate: true,
        fetchedAtMs: Date.now(),
      }),
    ).toEqual([]);
  });
});

describe("summaryIsGrounded", () => {
  const k = {
    personnel: [
      { role: "producer", name: "Quincy Jones" },
      { role: "guitar", name: "Steve Lukather" },
    ],
    pressing: { label: "Epic", year: 1982, country: "US" },
    approximate: false,
    fetchedAtMs: Date.now(),
  };

  it("accepts a sentence built only from the supplied facts", () => {
    expect(
      knowledge.summaryIsGrounded(
        "Produced by Quincy Jones with Steve Lukather on guitar.",
        spTrack,
        k,
      ),
    ).toBe(true);
  });

  it("rejects a sentence that introduces a name not in the facts", () => {
    expect(
      knowledge.summaryIsGrounded(
        "Produced by Quincy Jones and engineered by Bruce Swedien.",
        spTrack,
        k,
      ),
    ).toBe(false);
  });

  it("allows the track title/artist and sentence-initial capitalization", () => {
    expect(
      knowledge.summaryIsGrounded(
        "Midnight City came out on Epic in 1982.",
        spTrack,
        k,
      ),
    ).toBe(true);
  });
});
