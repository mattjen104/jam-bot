import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({
  listOptOuts: vi.fn(() => []),
  recentPlayed: vi.fn(() => [
    {
      id: 1,
      track_id: "sp-valid-1",
      title: "Track One",
      artist: "Artist One",
      played_at: "2026-09-25 20:00:00",
      requested_by_slack_user: null,
    },
    {
      id: 2,
      track_id: "sp-valid-2",
      title: "Track Two",
      artist: "Artist Two",
      played_at: "2026-09-25 19:00:00",
      requested_by_slack_user: null,
    },
  ]),
  searchPlayedByTitleOrArtist: vi.fn(() => []),
  playedInRange: vi.fn(() => []),
  playedByRequester: vi.fn(() => []),
  lastPlayedByTrackId: vi.fn(),
}));

const { askLLMForSet } = await import("../src/memory.js");
const { config } = await import("../src/config.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("memory-set model contract", () => {
  it("uses the configured reply model and filters invented and duplicate track ids", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                summary: "A short history-backed set.",
                track_ids: [
                  "sp-valid-1",
                  "not-in-history",
                  "sp-valid-1",
                  "sp-valid-2",
                ],
              }),
            },
          }],
        }),
        { status: 200 },
      ),
    );

    await expect(askLLMForSet("play me a set")).resolves.toEqual({
      summary: "A short history-backed set.",
      trackIds: ["sp-valid-1", "sp-valid-2"],
    });

    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe(config.OPENROUTER_MODEL);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});