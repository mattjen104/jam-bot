// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  creditRoleGroup,
  parseRecordingCredits,
  parseRecordingReleaseFacts,
} from "@workspace/song-enrichment";
import { aggregateAlbumStatus } from "../src/routes/me/credits.js";

describe("MusicBrainz kept-credit parsing", () => {
  it("treats mixed unavailable/complete/pending/partial album tracks as partial", () => {
    expect(
      aggregateAlbumStatus(["unavailable", "complete", "pending", "partial"], true),
    ).toBe("partial");
    expect(aggregateAlbumStatus(["unavailable"], false)).toBe("unavailable");
  });

  it("retains every linked work instead of silently choosing the first", () => {
    const result = parseRecordingCredits("recording-1", {
      relations: [
        {
          type: "performance",
          work: { id: "work-a", title: "Original composition" },
        },
        {
          type: "performance",
          work: { id: "work-b", title: "Translated arrangement" },
        },
        { type: "performance", work: { id: "work-a", title: "Duplicate" } },
      ],
    });
    expect(result.workIds).toEqual(["work-a", "work-b"]);
    expect(result.works).toEqual([
      { id: "work-a", title: "Original composition" },
      { id: "work-b", title: "Translated arrangement" },
    ]);
  });

  it("retains MusicBrainz person/group identity and exact instruments when available", () => {
    const result = parseRecordingCredits("recording-typed", {
      relations: [
        {
          type: "instrument",
          attributes: ["pedal steel guitar"],
          artist: { id: "person-1", name: "Player", type: "Person" },
        },
        {
          type: "producer",
          artist: { id: "group-1", name: "Production Team", type: "Group" },
        },
      ],
    });
    expect(result.personnel).toEqual([
      {
        role: "pedal steel guitar",
        name: "Player",
        artistId: "person-1",
        artistKind: "person",
      },
      {
        role: "producer",
        name: "Production Team",
        artistId: "group-1",
        artistKind: "group",
      },
    ]);
  });

  it("keeps labels attached to their concrete release/edition", () => {
    const result = parseRecordingReleaseFacts({
      releases: [
        {
          id: "release-original",
          title: "Original edition",
          date: "1997-05-21",
          "release-group": { id: "group-1" },
          "label-info": [
            {
              "catalog-number": "CAT-1",
              label: { id: "label-a", name: "Original Records" },
            },
          ],
        },
        {
          id: "release-reissue",
          title: "Remastered edition",
          date: "2024-01-01",
          "release-group": { id: "group-1" },
          "label-info": [
            {
              "catalog-number": "CAT-24",
              label: { id: "label-b", name: "Reissue Records" },
            },
          ],
        },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      releaseId: "release-original",
      releaseGroupId: "group-1",
      labels: [{ labelId: "label-a", catalogNumber: "CAT-1" }],
    });
    expect(result[1]).toMatchObject({
      releaseId: "release-reissue",
      labels: [{ labelId: "label-b", catalogNumber: "CAT-24" }],
    });
  });

  it("maps normalized role groups without making text-only names canonical", () => {
    expect(creditRoleGroup("producer")).toBe("production");
    expect(creditRoleGroup("mixing engineer")).toBe("engineering");
    expect(creditRoleGroup("composer")).toBe("writing");
    expect(creditRoleGroup("synthesizer")).toBe("performers");
    expect(creditRoleGroup("publisher")).toBe("other");
  });
});