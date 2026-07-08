import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  probeStream,
  extractBitrate,
  extractCodec,
  applyHealthResult,
  runHealthSweep,
} from "../src/lore/stream-health.js";
import type { Station } from "@workspace/db";

// ---------------------------------------------------------------------------
// extractBitrate
// ---------------------------------------------------------------------------

describe("extractBitrate", () => {
  it("reads icy-br header as kbps", () => {
    const h = new Headers({ "icy-br": "128" });
    expect(extractBitrate(h)).toBe(128);
  });

  it("returns null when icy-br is absent", () => {
    expect(extractBitrate(new Headers())).toBeNull();
  });

  it("returns null for non-numeric icy-br", () => {
    const h = new Headers({ "icy-br": "not-a-number" });
    expect(extractBitrate(h)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractCodec
// ---------------------------------------------------------------------------

describe("extractCodec", () => {
  it("detects AAC from content-type", () => {
    const h = new Headers({ "content-type": "audio/aac" });
    expect(extractCodec(h)).toBe("AAC");
  });

  it("detects MP3 from mpeg content-type", () => {
    const h = new Headers({ "content-type": "audio/mpeg" });
    expect(extractCodec(h)).toBe("MP3");
  });

  it("detects OGG", () => {
    const h = new Headers({ "content-type": "audio/ogg" });
    expect(extractCodec(h)).toBe("OGG");
  });

  it("returns null for unknown content-type", () => {
    const h = new Headers({ "content-type": "application/octet-stream" });
    expect(extractCodec(h)).toBeNull();
  });

  it("returns null when content-type is absent", () => {
    expect(extractCodec(new Headers())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// probeStream (mocked fetch)
// ---------------------------------------------------------------------------

describe("probeStream", () => {
  it("returns alive=true with bitrate and codec on 200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "icy-br": "192", "content-type": "audio/aac" }),
    } as unknown as Response);

    const result = await probeStream("https://stream.example.com/live", {
      fetchFn: mockFetch as typeof fetch,
    });
    expect(result.alive).toBe(true);
    expect(result.bitrateKbps).toBe(192);
    expect(result.codec).toBe("AAC");
  });

  it("returns alive=false on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      headers: new Headers(),
    } as unknown as Response);

    const result = await probeStream("https://stream.example.com/live", {
      fetchFn: mockFetch as typeof fetch,
    });
    expect(result.alive).toBe(false);
  });

  it("returns alive=false on network error (never throws)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await probeStream("https://dead.example.com/live", {
      fetchFn: mockFetch as typeof fetch,
    });
    expect(result.alive).toBe(false);
    expect(result.bitrateKbps).toBeNull();
    expect(result.codec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyHealthResult — 3-strike demotion state machine
// ---------------------------------------------------------------------------

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    slug: "test-station",
    name: "Test Station",
    streamUrl: "https://stream.example.com/live",
    streamFormat: "mp3",
    streamQuality: null,
    mode: "live",
    org: null,
    country: null,
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    nowPlayingSource: null,
    nowPlayingConfig: null,
    stationClass: "curated",
    lastSeenCursor: null,
    backfillCursor: null,
    backfillDone: false,
    attribution: true,
    sortOrder: 0,
    source: "radio_browser",
    tier: "longtail",
    tags: ["jazz"],
    lastAliveAt: null,
    resolutionRate: null,
    clickcount: 100,
    votes: 10,
    bitrate: 128,
    codec: "MP3",
    healthFailures: 0,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Station;
}

// Mock db so tests are pure-unit (no real DB connection needed)
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
  };
});

describe("applyHealthResult — success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets healthFailures to 0 and sets lastAliveAt on success", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ healthFailures: 2 });
    await applyHealthResult(station, { alive: true, bitrateKbps: 128, codec: "MP3" });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs).toMatchObject({ healthFailures: 0 });
    expect(setArgs.lastAliveAt).toBeInstanceOf(Date);
  });

  it("promotes inactive longtail station that meets quality gate", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ active: false, tier: "longtail", healthFailures: 0, bitrate: null });
    await applyHealthResult(station, { alive: true, bitrateKbps: 128, codec: "MP3" });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs.active).toBe(true);
  });

  it("does NOT promote longtail below minimum bitrate", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ active: false, tier: "longtail", bitrate: null });
    // Simulate health check reporting bitrate below threshold (e.g. 32 kbps)
    await applyHealthResult(station, { alive: true, bitrateKbps: 32, codec: "MP3" });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    // active should NOT be set to true (field absent from the update)
    expect(setArgs.active).toBeUndefined();
  });
});

describe("applyHealthResult — 3-strike demotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments healthFailures on failure", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ healthFailures: 1 });
    await applyHealthResult(station, { alive: false, bitrateKbps: null, codec: null });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs.healthFailures).toBe(2);
  });

  it("demotes active longtail station after 3 consecutive failures", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ healthFailures: 2, active: true, tier: "longtail" });
    await applyHealthResult(station, { alive: false, bitrateKbps: null, codec: null });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs.active).toBe(false);
    expect(setArgs.healthFailures).toBe(3);
  });

  it("does NOT demote flagship station even after 3 failures", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ healthFailures: 2, active: true, tier: "flagship" });
    await applyHealthResult(station, { alive: false, bitrateKbps: null, codec: null });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    // active must NOT appear in the update (flagship never demoted)
    expect(setArgs.active).toBeUndefined();
  });

  it("does NOT demote longtail station at 2 failures (threshold is 3)", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ healthFailures: 1, active: true, tier: "longtail" });
    await applyHealthResult(station, { alive: false, bitrateKbps: null, codec: null });

    const setCall = (db.update as ReturnType<typeof vi.fn>)().set as ReturnType<typeof vi.fn>;
    const setArgs = setCall.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs.active).toBeUndefined();
    expect(setArgs.healthFailures).toBe(2);
  });
});
