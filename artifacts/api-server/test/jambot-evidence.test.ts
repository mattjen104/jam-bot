import { describe, expect, it, vi } from "vitest";
import { resolveJamBotEvidence } from "../src/lore/jambot-evidence.js";

function resolution(
  confidence: "isrc" | "text" | "unresolved",
  mbid: string | null,
) {
  return {
    mbid,
    confidence,
    title: "Song",
    artist: "Artist",
    fromCache: false,
  } as const;
}

describe("JamBot canonical evidence enrichment", () => {
  it("persists an ISRC-confidence recording through Lore's canonical upsert", async () => {
    const resolve = vi.fn().mockResolvedValue(resolution("isrc", "mbid-1"));
    const upsert = vi.fn().mockResolvedValue(null);

    const result = await resolveJamBotEvidence({
      isrc: "USABC1234567",
      title: "Song",
      artist: "Artist",
    }, { resolve, upsert });

    expect(resolve).toHaveBeenCalledWith(
      "Artist",
      "Song",
      undefined,
      { isrc: "USABC1234567" },
    );
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      mbid: "mbid-1",
      confidence: "isrc",
    }));
    expect(result?.mbid).toBe("mbid-1");
  });

  it.each([
    ["weak text fallback", resolution("text", "mbid-weak")],
    ["provider failure", resolution("unresolved", null)],
  ])("does not persist a %s", async (_label, candidate) => {
    const upsert = vi.fn();
    const result = await resolveJamBotEvidence({
      isrc: "USABC1234567",
      title: "Song",
      artist: "Artist",
    }, {
      resolve: vi.fn().mockResolvedValue(candidate),
      upsert,
    });

    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});