import { afterEach, describe, expect, it } from "vitest";
import {
  deleteSongShareMessage,
  ingestSongShareMessage,
  querySongShares,
} from "../src/slack/song-shares.js";
import { answerSongShareQuestion } from "../src/slack/song-share-answers.js";

const CHANNEL = "C_TEST_CHANNEL";
const TRACK = "4uLU6hMCjMI75M1A2tKUQC";

afterEach(() => {
  // Keep this suite isolated without depending on the global test DB being empty.
  for (const messageTs of ["1700000000.000001", "1700000000.000002", "1700000000.000003"]) {
    deleteSongShareMessage(CHANNEL, messageTs);
  }
});

describe("attributed Slack song-share ledger", () => {
  it("keeps the same song attributed to distinct speakers and dedupes event replay", () => {
    const first = {
      channel: CHANNEL,
      ts: "1700000000.000001",
      thread_ts: "1700000000.000001",
      user: "USPEAKER1",
      text: `This one! <https://open.spotify.com/track/${TRACK}?si=tracking|Track title>`,
    };
    const second = {
      channel: CHANNEL,
      ts: "1700000000.000002",
      user: "USPEAKER2",
      text: `Also love it: https://open.spotify.com/track/${TRACK}`,
    };

    expect(ingestSongShareMessage(first)).toBe(1);
    expect(ingestSongShareMessage(first)).toBe(1);
    expect(ingestSongShareMessage(second)).toBe(1);

    const shares = querySongShares({ canonicalId: TRACK });
    expect(shares).toHaveLength(2);
    expect(shares.map((share) => share.slack_user_id).sort()).toEqual([
      "USPEAKER1",
      "USPEAKER2",
    ]);
    expect(shares[0]?.canonical_url).toBe(`https://open.spotify.com/track/${TRACK}`);
  });

  it("replaces an edited message and strips links/Slack markup from bounded context", () => {
    const message = {
      channel: CHANNEL,
      ts: "1700000000.000001",
      thread_ts: "1700000000.000003",
      user: "UEDITOR",
      text: `Before <@U_OTHER> https://open.spotify.com/track/${TRACK} after <script> ${"x".repeat(500)}`,
    };
    expect(ingestSongShareMessage(message)).toBe(1);
    const originalContext = querySongShares({ slackUserId: "UEDITOR" })[0]?.context ?? "";
    expect(originalContext).not.toContain("https://");
    expect(originalContext).not.toContain("U_OTHER");
    expect(originalContext.length).toBeLessThanOrEqual(240);
    expect(
      ingestSongShareMessage({
        ...message,
        text: "Edited: https://music.apple.com/us/song/example/123456789",
      }),
    ).toBe(1);

    expect(querySongShares({ canonicalId: TRACK })).toHaveLength(0);
    const edited = querySongShares({ slackUserId: "UEDITOR" });
    expect(edited).toHaveLength(1);
    expect(edited[0]?.link_type).toBe("apple_song");
    expect(edited[0]?.canonical_id).toBe("us:123456789");
    expect(edited[0]?.context).toBe("Edited:");
  });

  it("supports canonical IDs for album, YouTube video, and MusicBrainz links", () => {
    const result = ingestSongShareMessage({
      channel: CHANNEL,
      ts: "1700000000.000001",
      user: "ULINKER",
      text: [
        "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=abc",
        "https://music.apple.com/us/album/example-album/123456789?i=987654321",
        "https://music.apple.com/us/album/another-album/123456788",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc",
        "https://musicbrainz.org/recording/123e4567-e89b-42d3-a456-426614174000",
        "https://musicbrainz.org/release/123e4567-e89b-42d3-a456-426614174001",
      ].join(" "),
    });
    expect(result).toBe(6);
    expect(querySongShares({ slackUserId: "ULINKER" }).map((s) => s.link_type).sort()).toEqual([
      "apple_album",
      "apple_song",
      "musicbrainz_recording",
      "musicbrainz_release",
      "spotify_album",
      "youtube_video",
    ]);
  });

  it("ignores unsupported URLs and rejects messages outside the configured channel or without a user ID", () => {
    expect(
      ingestSongShareMessage({
        channel: CHANNEL,
        ts: "1700000000.000001",
        user: "ULINKER",
        text: "https://example.com/song https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4",
      }),
    ).toBe(0);
    expect(
      ingestSongShareMessage({
        channel: "C_OTHER",
        ts: "1700000000.000002",
        user: "ULINKER",
        text: `https://open.spotify.com/track/${TRACK}`,
      }),
    ).toBe(0);
    expect(
      ingestSongShareMessage({
        channel: CHANNEL,
        ts: "1700000000.000003",
        text: `https://open.spotify.com/track/${TRACK}`,
      }),
    ).toBe(0);
    expect(querySongShares({ canonicalId: TRACK })).toHaveLength(0);
  });

  it("deletes every link attributed to a deleted message", () => {
    expect(
      ingestSongShareMessage({
        channel: CHANNEL,
        ts: "1700000000.000001",
        user: "UDELETE",
        text: `https://open.spotify.com/track/${TRACK} https://music.youtube.com/watch?v=dQw4w9WgXcQ`,
      }),
    ).toBe(2);
    expect(deleteSongShareMessage(CHANNEL, "1700000000.000001")).toBe(2);
    expect(querySongShares({ slackUserId: "UDELETE" })).toHaveLength(0);
  });

  it("answers who shared a link and preserves each speaker's own words", async () => {
    ingestSongShareMessage({
      channel: CHANNEL, ts: "1700000000.000001", user: "USPEAKER1",
      text: `This is perfect: https://open.spotify.com/track/${TRACK}?si=tracking`,
    });
    ingestSongShareMessage({
      channel: CHANNEL, ts: "1700000000.000002", user: "USPEAKER2",
      text: `I like the drums: https://open.spotify.com/track/${TRACK}`,
    });
    const answer = await answerSongShareQuestion(
      `Who shared https://open.spotify.com/track/${TRACK}?`,
      async (id) => id === "USPEAKER1" ? "Alice" : "Bob",
    );
    expect(answer).toContain("Alice shared");
    expect(answer).toContain("Bob shared");
    expect(answer).toContain("This is perfect");
    expect(answer).toContain("I like the drums");
    expect(answer).not.toContain("?si=tracking");
    expect(answer).toContain("not anyone's personal taste");
    expect(await answerSongShareQuestion("What did Alice say about this song?", async () => "Alice"))
      .toContain("Paste a supported song link");
    expect(await answerSongShareQuestion("Who shared that track?", async () => "Alice"))
      .toContain("Paste a supported song link");
    expect(await answerSongShareQuestion(
      `What did Alice say about https://open.spotify.com/track/${TRACK}?`,
      async () => "Alice",
    )).toContain("Mention the person");
    const aliceOnly = await answerSongShareQuestion(
      `What did <@USPEAKER1> say about https://open.spotify.com/track/${TRACK}?`,
      async (id) => id === "USPEAKER1" ? "Alice" : "Bob",
    );
    expect(aliceOnly).toContain("Alice shared");
    expect(aliceOnly).not.toContain("Bob shared");
    expect(await answerSongShareQuestion(
      "Who shared https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ1?",
      async () => "Alice",
    )).toContain("haven't recorded a matching song link");
    expect(await answerSongShareQuestion("What did we play in Jam?", async () => "Alice")).toBeNull();
  });
});