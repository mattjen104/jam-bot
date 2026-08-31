// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importAppleMusicLibrary,
  type AppleMusicClientConfig,
} from "../src/lib/appleMusicReplay";

const config: AppleMusicClientConfig = {
  configured: true,
  developerToken: "public-developer-token",
  appName: "Lore",
  storefront: "us",
};

function song(id: string) {
  return {
    id,
    attributes: {
      name: `Song ${id}`,
      artistName: "Artist",
      albumName: "Album",
      isrc: `ISRC${id}`,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.MusicKit;
});

describe("Apple Music library importer", () => {
  it("authorizes, scans pages, uploads batches, and finalizes once", async () => {
    const authorize = vi.fn().mockResolvedValue("music-user-token");
    const music = vi.fn()
      .mockResolvedValueOnce({ data: { data: [song("1"), song("2")], next: "/next" } })
      .mockResolvedValueOnce({ data: { data: [song("3")] } });
    window.MusicKit = {
      configure: vi.fn(),
      getInstance: () => ({ authorize, isAuthorized: false, api: { music } }),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ received: 2, resolved: 1, total: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ received: 1, resolved: 1, total: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ complete: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pages: 2, received: 3, resolved: 2, unresolved: 1, total: 3, complete: true,
      }), { status: 200 }));

    const progress = await importAppleMusicLibrary(config, { pageLimit: 2 });

    expect(authorize).toHaveBeenCalledOnce();
    expect(music).toHaveBeenNthCalledWith(1, "/v1/me/library/songs", { limit: 2, offset: 0 });
    expect(music).toHaveBeenNthCalledWith(2, "/v1/me/library/songs", { limit: 2, offset: 2 });
    expect(progress).toMatchObject({ received: 3, resolved: 2, total: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('"complete":true');
  });

  it("does not finalize a partial batch and remains safe to retry", async () => {
    window.MusicKit = {
      configure: vi.fn(),
      getInstance: () => ({
        authorize: vi.fn().mockResolvedValue("token"),
        isAuthorized: false,
        api: { music: vi.fn().mockResolvedValue({ data: { data: [song("1")] } }) },
      }),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        received: 1,
        failures: [{ index: 0, reason: "temporary database failure" }],
      }), { status: 207 }),
    );

    await expect(importAppleMusicLibrary(config)).rejects.toThrow("need a retry");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});