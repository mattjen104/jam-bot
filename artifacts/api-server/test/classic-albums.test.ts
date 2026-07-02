import { describe, it, expect } from "vitest";
import {
  parseReleaseSearch,
  parseReleaseTracklist,
} from "@workspace/song-enrichment";
import {
  parseCaptionXml,
  claimIsGrounded,
  completedSlugs,
  CLASSIC_ALBUMS_EPISODES,
  type CaptionCue,
} from "../src/lore/classic-albums.js";

describe("parseReleaseSearch", () => {
  it("prefers official releases over higher-scored non-official ones", () => {
    const id = parseReleaseSearch({
      releases: [
        { id: "bootleg-1", score: 100, status: "Bootleg" },
        { id: "official-1", score: 95, status: "Official" },
      ],
    });
    expect(id).toBe("official-1");
  });

  it("falls back to highest score when nothing is official", () => {
    const id = parseReleaseSearch({
      releases: [
        { id: "a", score: 70 },
        { id: "b", score: 90 },
      ],
    });
    expect(id).toBe("b");
  });

  it("returns null on an empty or malformed body", () => {
    expect(parseReleaseSearch({})).toBeNull();
    expect(parseReleaseSearch({ releases: [] })).toBeNull();
    expect(parseReleaseSearch(null)).toBeNull();
  });
});

describe("parseReleaseTracklist", () => {
  const body = {
    id: "rel-1",
    title: "Rio",
    date: "1982-05-10",
    "artist-credit": [{ name: "Duran Duran", artist: { id: "aa-1", name: "Duran Duran" } }],
    media: [
      {
        tracks: [
          { recording: { id: "rec-1", title: "Rio", length: 337000 } },
          { recording: { id: "rec-2", title: "My Own Way" } },
        ],
      },
      {
        tracks: [{ recording: { id: "rec-3", title: "Last Chance on the Stairway" } }],
      },
    ],
  };

  it("flattens multi-disc media into one ordered tracklist", () => {
    const out = parseReleaseTracklist(body);
    expect(out).not.toBeNull();
    expect(out!.releaseTitle).toBe("Rio");
    expect(out!.year).toBe(1982);
    expect(out!.tracks.map((t) => t.position)).toEqual([1, 2, 3]);
    expect(out!.tracks[2]!.recordingId).toBe("rec-3");
  });

  it("falls back to the release artist credit per track", () => {
    const out = parseReleaseTracklist(body);
    expect(out!.tracks[0]!.artist).toBe("Duran Duran");
    expect(out!.tracks[0]!.artistMbid).toBe("aa-1");
  });

  it("keeps recording duration when present", () => {
    const out = parseReleaseTracklist(body);
    expect(out!.tracks[0]!.durationMs).toBe(337000);
    expect(out!.tracks[1]!.durationMs).toBeUndefined();
  });

  it("returns null when there are no usable tracks", () => {
    expect(parseReleaseTracklist({ id: "x", title: "Y", media: [] })).toBeNull();
    expect(parseReleaseTracklist(null)).toBeNull();
  });
});

describe("parseCaptionXml", () => {
  it("parses the classic text/start/dur format", () => {
    const xml =
      '<transcript><text start="1.4" dur="2.0">Nick came up with the &amp;quot;riff&quot;</text>' +
      '<text start="4.0" dur="1.5">on the Jupiter&#39;8</text></transcript>';
    const cues = parseCaptionXml(xml);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.tSec).toBe(1);
    expect(cues[1]!.text).toContain("Jupiter'8");
  });

  it("parses the srv3 p/t/d millisecond format", () => {
    const xml =
      '<timedtext><body><p t="12000" d="3000">We recorded it in <s>one</s> take</p>' +
      '<p t="15500" d="2000">at AIR Studios</p></body></timedtext>';
    const cues = parseCaptionXml(xml);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.tSec).toBe(12);
    expect(cues[0]!.text).toBe("We recorded it in one take");
    expect(cues[1]!.tSec).toBe(16);
  });

  it("drops empty cues and returns [] for junk", () => {
    expect(parseCaptionXml("<p t=\"1\" d=\"2\"></p>")).toEqual([]);
    expect(parseCaptionXml("not xml at all")).toEqual([]);
  });
});

describe("claimIsGrounded", () => {
  const cues: CaptionCue[] = [
    { tSec: 10, text: "Nick played the arpeggio on the Roland Jupiter 8" },
    { tSec: 14, text: "and Andy doubled it with a guitar harmonic" },
    { tSec: 300, text: "completely unrelated chatter about touring" },
  ];

  it("accepts a claim whose content words appear near its cited moment", () => {
    expect(
      claimIsGrounded(
        "Nick played the arpeggio on a Roland Jupiter 8 synthesizer",
        cues,
        12,
      ),
    ).toBe(true);
  });

  it("rejects a fabricated claim not supported by the window", () => {
    expect(
      claimIsGrounded(
        "The orchestra recorded strings at Abbey Road with George Martin",
        cues,
        12,
      ),
    ).toBe(false);
  });

  it("rejects a claim citing a moment with no nearby transcript", () => {
    expect(
      claimIsGrounded("Nick played the arpeggio on the Jupiter 8", cues, 900),
    ).toBe(false);
  });

  it("rejects claims too short to verify", () => {
    expect(claimIsGrounded("It was great", cues, 12)).toBe(false);
  });

  it("rejects a claim whose number is not in the transcript, even at high word overlap", () => {
    // Adversarial paraphrase: shares almost every content word with the cue
    // but swaps the synth model number — a fabricated specific must not pass.
    expect(
      claimIsGrounded(
        "Nick played the arpeggio on the Roland Jupiter 4",
        cues,
        12,
      ),
    ).toBe(false);
  });

  it("rejects a claim that invents a year the speaker never said", () => {
    expect(
      claimIsGrounded(
        "Nick played the arpeggio on the Roland Jupiter 8 in 1981",
        cues,
        12,
      ),
    ).toBe(false);
  });

  it("accepts a claim whose numbers all appear in the window", () => {
    const dated: CaptionCue[] = [
      { tSec: 10, text: "we cut the whole thing in 1982 at AIR Studios" },
      { tSec: 13, text: "the single went to number 2 in America" },
    ];
    expect(
      claimIsGrounded(
        "The single was cut in 1982 at AIR Studios and reached number 2 in America",
        dated,
        11,
      ),
    ).toBe(true);
  });
});

describe("completedSlugs ledger", () => {
  it("reads slugs from a picker sourceRef", () => {
    expect(completedSlugs({ completedSlugs: ["rio", "rumours"] })).toEqual([
      "rio",
      "rumours",
    ]);
  });

  it("treats a missing/blank ledger as nothing completed (partial ingest retries)", () => {
    expect(completedSlugs(null)).toEqual([]);
    expect(completedSlugs(undefined)).toEqual([]);
    expect(completedSlugs({})).toEqual([]);
    expect(completedSlugs("garbage")).toEqual([]);
  });

  it("ignores non-string entries defensively", () => {
    expect(completedSlugs({ completedSlugs: ["rio", 7, null] })).toEqual([
      "rio",
    ]);
  });
});

describe("CLASSIC_ALBUMS_EPISODES seed", () => {
  it("has unique slugs", () => {
    const slugs = CLASSIC_ALBUMS_EPISODES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("only references official clips with plausible video ids", () => {
    for (const ep of CLASSIC_ALBUMS_EPISODES) {
      for (const clip of ep.clips ?? []) {
        expect(clip.videoId).toMatch(/^[\w-]{11}$/);
        expect(clip.trackTitle.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
