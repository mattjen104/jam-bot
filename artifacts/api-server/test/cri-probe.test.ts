import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lore/icy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/icy.js")>();
  return {
    ...actual,
    fetchIcyMetadata: vi.fn(),
  };
});

import { fetchIcyMetadata } from "../src/lore/icy.js";
import { probeCriStream } from "../src/lore/cri-probe.js";

const fetchIcyMetadataMock = vi.mocked(fetchIcyMetadata);

describe("probeCriStream", () => {
  beforeEach(() => {
    fetchIcyMetadataMock.mockReset();
  });

  it("classifies a blank metadata block as not promotable", async () => {
    fetchIcyMetadataMock.mockResolvedValue({
      ok: true,
      streamTitle: " - ",
      icyMetaint: 16_000,
    });

    await expect(probeCriStream("https://radio.example/stream")).resolves.toEqual({
      icyStatus: "no",
      currentArtist: null,
      currentTitle: null,
      stationLabel: null,
    });
  });

  it("keeps a station/archive label separate from track metadata", async () => {
    fetchIcyMetadataMock.mockResolvedValue({
      ok: true,
      streamTitle: "WFMU Station ID — Archive",
      icyMetaint: 16_000,
    });

    await expect(probeCriStream("https://radio.example/stream")).resolves.toEqual({
      icyStatus: "no",
      currentArtist: null,
      currentTitle: null,
      stationLabel: "WFMU Station ID — Archive",
    });
  });

  it("marks a usable artist/title metadata block as promotable", async () => {
    fetchIcyMetadataMock.mockResolvedValue({
      ok: true,
      streamTitle: "Nina Simone - Sinnerman",
      icyMetaint: 16_000,
    });

    await expect(probeCriStream("https://radio.example/stream")).resolves.toEqual({
      icyStatus: "yes",
      currentArtist: "Nina Simone",
      currentTitle: "Sinnerman",
      stationLabel: null,
    });
  });
});