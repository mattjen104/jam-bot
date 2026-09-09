import { describe, expect, it } from "vitest";
import {
  parseReleaseGroupRelease,
  parseReleaseTracklist,
} from "@workspace/song-enrichment";

describe("MusicBrainz canonical album ordering", () => {
  it("sorts shuffled media and tracks by their canonical positions", () => {
    const parsed = parseReleaseTracklist({
      id: "release-id",
      title: "Ordered Album",
      media: [
        {
          position: 2,
          tracks: [
            { position: 2, recording: { id: "disc-2-track-2", title: "Fourth" } },
            { position: 1, recording: { id: "disc-2-track-1", title: "Third" } },
          ],
        },
        {
          position: 1,
          tracks: [
            { position: 2, recording: { id: "disc-1-track-2", title: "Second" } },
            { position: 1, recording: { id: "disc-1-track-1", title: "First" } },
          ],
        },
      ],
    });

    expect(parsed?.tracks.map((track) => track.recordingId)).toEqual([
      "disc-1-track-1",
      "disc-1-track-2",
      "disc-2-track-1",
      "disc-2-track-2",
    ]);
    expect(parsed?.tracks.map((track) => track.position)).toEqual([1, 2, 3, 4]);
  });

  it("chooses the earliest official release from the exact release group", () => {
    expect(parseReleaseGroupRelease({
      releases: [
        { id: "bootleg", status: "Bootleg", date: "1970-01-01" },
        { id: "later-official", status: "Official", date: "1971-04-02" },
        { id: "first-official", status: "Official", date: "1971-03-01" },
      ],
    })).toBe("first-official");
  });
});