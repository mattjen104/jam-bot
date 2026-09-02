// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseRecordingSearch } from "@workspace/song-enrichment";

describe("parseRecordingSearch", () => {
  it("selects the highest-scoring recording instead of trusting response order", () => {
    const result = parseRecordingSearch({
      recordings: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          score: 91,
          title: "Lower-confidence result",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          score: 99,
          title: "Best result",
        },
      ],
    });

    expect(result).toMatchObject({
      recordingId: "22222222-2222-4222-8222-222222222222",
      score: 99,
      title: "Best result",
    });
  });

  it("uses the recording id as a stable tie-break", () => {
    const result = parseRecordingSearch({
      recordings: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          score: 95,
          title: "Second by id",
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          score: 95,
          title: "First by id",
        },
      ],
    });

    expect(result?.recordingId).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });
});