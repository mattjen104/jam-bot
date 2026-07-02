import { describe, expect, it } from "vitest";
import { djFollowId, parseDjFollowId } from "../src/lib/local";
import { groupCredits, pressingLine } from "../src/components/NowPlaying";
import type { Credit, TrackKnowledge } from "@workspace/api-client-react";

describe("DJ follow ids", () => {
  it("round-trips a station slug and DJ name", () => {
    const id = djFollowId("kexp", "Larry Mizell, Jr.");
    expect(id).toBe("kexp::Larry Mizell, Jr.");
    expect(parseDjFollowId(id)).toEqual({
      stationSlug: "kexp",
      djName: "Larry Mizell, Jr.",
    });
  });

  it("keeps DJ names containing the separator intact", () => {
    const parsed = parseDjFollowId("wfmu::DJ :: Weirdo");
    expect(parsed).toEqual({ stationSlug: "wfmu", djName: "DJ :: Weirdo" });
  });

  it("rejects malformed ids instead of guessing", () => {
    expect(parseDjFollowId("no-separator")).toBeNull();
    expect(parseDjFollowId("::leading")).toBeNull();
    expect(parseDjFollowId("trailing::")).toBeNull();
  });
});

describe("groupCredits", () => {
  const credits: Credit[] = [
    { role: "producer", name: "Quincy Jones" },
    { role: "composer", name: "Michael Jackson" },
    { role: "lyricist", name: "Michael Jackson" },
    { role: "engineer", name: "Bruce Swedien" },
    { role: "lead vocals", name: "Michael Jackson" },
    { role: "guitar", name: "David Williams" },
  ];

  it("buckets producers, writers, engineers, and performers", () => {
    const rows = groupCredits(credits);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.names]));
    expect(byLabel["Produced by"]).toBe("Quincy Jones");
    expect(byLabel["Written by"]).toBe("Michael Jackson");
    expect(byLabel["Engineered by"]).toBe("Bruce Swedien");
    expect(byLabel["Performed by"]).toContain("Michael Jackson (lead vocals)");
    expect(byLabel["Performed by"]).toContain("David Williams (guitar)");
  });

  it("dedupes a person credited with the same role twice", () => {
    const rows = groupCredits([
      { role: "producer", name: "Nile Rodgers" },
      { role: "co-producer", name: "Nile Rodgers" },
    ]);
    expect(rows).toEqual([{ label: "Produced by", names: "Nile Rodgers" }]);
  });

  it("returns no rows for empty personnel", () => {
    expect(groupCredits([])).toEqual([]);
  });
});

describe("pressingLine", () => {
  const base: TrackKnowledge = {
    personnel: [],
    relationships: [],
    approximate: false,
    fetchedAtMs: 0,
  };

  it("joins label, year, and country", () => {
    expect(
      pressingLine({
        ...base,
        pressing: { label: "Epic", year: 1980, country: "US" },
      }),
    ).toBe("Epic · 1980 · US");
  });

  it("returns null when there is no pressing", () => {
    expect(pressingLine(base)).toBeNull();
  });
});
