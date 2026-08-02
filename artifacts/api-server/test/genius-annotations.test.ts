// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();
const insert = vi.fn();
const dbMock = { select, insert };

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("@workspace/song-enrichment", () => ({
  fetchGeniusSongId: vi.fn(),
  fetchGeniusReferents: vi.fn(),
  geniusEnabled: vi.fn(),
}));

const enrichment = await import("@workspace/song-enrichment");
const {
  geniusFragmentReceipt,
  ingestGeniusAnnotations,
  normalizeGeniusFragment,
  projectFragment,
} = await import("../src/lore/genius-annotations.js");

describe("Genius fragment privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes deterministically before hashing and measuring", () => {
    const fragment = "  Café—NOISE! \n  café-noise  ";
    expect(normalizeGeniusFragment(fragment)).toBe("cafe noise cafe noise");
    expect(geniusFragmentReceipt(fragment)).toEqual({
      hash: "b0b4a6117a95b89f40c3aa1fcd0443f577db11b73beccf3a726dd649508480b7",
      len: 21,
    });
    expect(geniusFragmentReceipt(fragment)).toEqual(geniusFragmentReceipt(fragment));
  });

  it("keeps the raw fragment only in the projection input", () => {
    expect(
      projectFragment("the sun rises", [{ offsetMs: 12_000, text: "The sun rises" }]),
    ).toBe(12_000);
  });

  it("projects in memory and persists only the receipt fields", async () => {
    vi.mocked(enrichment.geniusEnabled).mockReturnValue(true);
    vi.mocked(enrichment.fetchGeniusSongId).mockResolvedValue(42);
    vi.mocked(enrichment.fetchGeniusReferents).mockResolvedValue([
      {
        geniusAnnotationId: 7,
        fragment: "the sun rises",
        geniusUrl: "https://genius.com/annotation/7",
        verified: true,
        voteCount: 12,
      },
    ]);

    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: async () => [{ title: "Sun", artist: "Artist", isrc: null }],
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: async () => [{ offsetMs: 12_000, text: "The sun rises" }],
          }),
        }),
      });
    insert.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        expect(values).toMatchObject({
          fragmentHash: geniusFragmentReceipt("the sun rises").hash,
          fragmentLen: geniusFragmentReceipt("the sun rises").len,
          anchorType: "timestamp",
          offsetMs: 12_000,
          geniusUrl: "https://genius.com/annotation/7",
        });
        expect(values).not.toHaveProperty("fragment");
        return { onConflictDoNothing: async () => ({ rowCount: 1 }) };
      },
    });

    await expect(ingestGeniusAnnotations("recording-1")).resolves.toBe(1);
    expect(insert).toHaveBeenCalledOnce();
  });
});