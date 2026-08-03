import { describe, expect, it, vi } from "vitest";
import { replayAttribution } from "../src/lore/replay-materialization.js";
import { AppleMusicConnector } from "../src/lore/appleMusicConnect.js";
import { TidalConnector } from "../src/lore/tidalConnect.js";

describe("Ghost Replay playlist materialization", () => {
  it("uses the required station, picker, and date attribution", () => {
    expect(replayAttribution({
      station: "KEXP",
      picker: "DJ Riz",
      date: "2026-08-03",
    })).toEqual({
      name: "KEXP · DJ Riz · 2026-08-03",
      description: "As broadcast on KEXP, DJ Riz's set, 2026-08-03 — via Lore",
    });
  });

  it("uses a database-level active-job uniqueness guard for duplicate submits", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/lore/replay-resolution-migration.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain("replay_materialization_jobs_active_uq");
    expect(source).toMatch(/WHERE status IN \('pending', 'running'\)/);
  });

  it("keeps the provider entry receipt in manifest order and classifies permanent misses", async () => {
    const connector = new AppleMusicConnector();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const result = await connector.addPlaylistTracks("user-token", "playlist", [
      { position: 0, recordingMbid: "a", externalId: "apple-a", url: "https://music.apple.com/a", title: "A", artist: "Artist A" },
      { position: 2, recordingMbid: "c", externalId: "apple-c", url: "https://music.apple.com/c", title: "C", artist: "Artist C" },
      { position: 5, recordingMbid: "f", externalId: "apple-f", url: "https://music.apple.com/f", title: "F", artist: "Artist F" },
    ]);
    expect(result).toEqual([
      { position: 0, status: "accepted", retryable: false },
      { position: 2, status: "missing", retryable: false, error: "Apple Music track 3 failed (404)" },
      { position: 5, status: "accepted", retryable: false },
    ]);
    vi.unstubAllGlobals();
  });

  it("marks bounded provider failures retryable without substituting a track", async () => {
    const connector = new TidalConnector();
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const [result] = await connector.addPlaylistTracks("user-token", "playlist", [
      { position: 4, recordingMbid: "e", externalId: "tidal-e", url: "https://tidal.com/e", title: "E", artist: "Artist E" },
    ]);
    expect(result).toEqual({
      position: 4,
      status: "rejected",
      retryable: true,
      error: "Tidal track 5 failed (429)",
    });
    vi.unstubAllGlobals();
  });
});