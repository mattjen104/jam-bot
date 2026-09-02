import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNowPlayingAdapter } from "../src/lore/adapters.js";

vi.mock("../src/lore/icy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lore/icy.js")>()),
  fetchIcyMetadata: vi.fn(),
}));

const NTS_CONFIG = {
  streamUrl: "https://stream-relay-geo.ntslive.net/stream",
  fallbackSource: "nts_live",
  channel: "1",
};

function liveResponse() {
  return new Response(
    JSON.stringify({
      results: [
        {
          channel_name: "1",
          now: {
            broadcast_title: "Floating Points",
            embeds: { details: { name: "Sam Shepherd" } },
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("NTS ICY adapter", () => {
  let fetchIcyMetadata: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const icy = await import("../src/lore/icy.js");
    fetchIcyMetadata = icy.fetchIcyMetadata as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => liveResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs ICY artist/title while keeping NTS live show attribution", async () => {
    fetchIcyMetadata.mockResolvedValue({
      ok: true,
      streamTitle: "Alice Coltrane - Journey in Satchidananda",
      icyMetaint: 16384,
    });

    const adapter = getNowPlayingAdapter("radio_browser_icy");
    await expect(adapter?.(NTS_CONFIG)).resolves.toEqual({
      rawArtist: "Alice Coltrane",
      rawTitle: "Journey in Satchidananda",
      show: { name: "Floating Points", djName: "Sam Shepherd" },
    });
  });

  it("does not turn the NTS live show into a track when ICY is unreachable", async () => {
    fetchIcyMetadata.mockResolvedValue({
      ok: false,
      kind: "transient_error",
      message: "connect timeout",
    });

    const adapter = getNowPlayingAdapter("radio_browser_icy");
    await expect(adapter?.(NTS_CONFIG)).resolves.toBeNull();
  });
});