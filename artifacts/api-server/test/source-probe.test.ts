import { describe, it, expect } from "vitest";
import {
  probeStationPublicMetadata,
  radiojarStreamId,
  type ProbeDeps,
} from "../src/lore/source-probe.js";
import type { IcyFetchResult } from "../src/lore/icy.js";

/**
 * Probe behavior across the representative source classes — all network
 * access is faked through the injectable ProbeDeps seams.
 *
 * The core contract under test: a probe only reports `usable_pair` when the
 * public surface actually supplied a real artist+title pair. Reachable audio,
 * an ICY header alone, blank/junk values, and show-only metadata never count.
 */

function icyOk(streamTitle: string | null): IcyFetchResult {
  return { ok: true, streamTitle, icyMetaint: 16000 };
}

function deps(overrides: Partial<ProbeDeps>): ProbeDeps {
  return {
    fetchIcy: async () => ({ ok: false, kind: "transient_error" }),
    resolveUrl: async (url: string) => url,
    fetchJson: async () => {
      throw new Error("no fetchJson fake installed");
    },
    ...overrides,
  };
}

const STATION = {
  id: 1,
  slug: "wxyz",
  streamUrl: "https://stream.example.com/wxyz",
  nowPlayingSource: null,
  nowPlayingConfig: {},
};

describe("probeStationPublicMetadata — ICY", () => {
  it("usable_pair when the stream publishes a real artist+title", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({ fetchIcy: async () => icyOk("Nina Simone - Sinnerman") }),
    );
    expect(out?.kind).toBe("icy");
    expect(out?.outcome).toBe("usable_pair");
    expect(out?.sampleArtist).toBe("Nina Simone");
    expect(out?.sampleTitle).toBe("Sinnerman");
  });

  it("records the redirect-resolved direct stream URL on a usable probe", async () => {
    const direct = "http://direct.cdn.example:8000/wxyz-128";
    const out = await probeStationPublicMetadata(
      STATION,
      deps({
        fetchIcy: async () => icyOk("A - B"),
        resolveUrl: async () => direct,
      }),
    );
    expect(out?.outcome).toBe("usable_pair");
    expect(out?.resolvedUrl).toBe(direct);
  });

  it("falls back to the probed URL when redirect resolution fails", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({
        fetchIcy: async () => icyOk("A - B"),
        resolveUrl: async () => {
          throw new Error("dns blew up");
        },
      }),
    );
    expect(out?.outcome).toBe("usable_pair");
    expect(out?.resolvedUrl).toBe(STATION.streamUrl);
  });

  it("blank_metadata when ICY answers with an empty StreamTitle", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({ fetchIcy: async () => icyOk(null) }),
    );
    expect(out?.outcome).toBe("blank_metadata");
  });

  it("blank_metadata for a title-only value (incomplete / show-level metadata)", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({ fetchIcy: async () => icyOk("Morning Jazz Hour with Priya") }),
    );
    expect(out?.outcome).toBe("blank_metadata");
  });

  it("blank_metadata for junk values (station break labels)", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({ fetchIcy: async () => icyOk("Commercial - break") }),
    );
    expect(out?.outcome).toBe("blank_metadata");
  });

  it("unsupported when the server does not honour ICY metadata", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({
        fetchIcy: async () => ({
          ok: false,
          kind: "icy_unsupported",
          message: "no icy-metaint header",
        }),
      }),
    );
    expect(out?.outcome).toBe("unsupported");
    expect(out?.detail).toMatch(/icy-metaint/);
  });

  it("unreachable on transient network failure", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({
        fetchIcy: async () => ({
          ok: false,
          kind: "transient_error",
          message: "connect timeout",
        }),
      }),
    );
    expect(out?.outcome).toBe("unreachable");
    expect(out?.detail).toMatch(/timeout/);
  });

  it("returns null when there is no stream URL and no supported platform", async () => {
    const out = await probeStationPublicMetadata(
      { ...STATION, streamUrl: "" },
      deps({}),
    );
    expect(out).toBeNull();
  });

  it("unreachable when the probe exceeds its overall time budget (hung socket/lookup)", async () => {
    const out = await probeStationPublicMetadata(
      STATION,
      deps({
        // Simulates a pre-socket hang (e.g. a stalled DNS resolution) that
        // the ICY connect/read timers never get a chance to cover.
        fetchIcy: () => new Promise<IcyFetchResult>(() => {}),
        budgetMs: 50,
      }),
    );
    expect(out?.outcome).toBe("unreachable");
    expect(out?.detail).toMatch(/time budget/);
  });
});

describe("probeStationPublicMetadata — Radiojar platform", () => {
  const JAR = {
    ...STATION,
    streamUrl: "https://stream.radiojar.com/78cxy6wkxtzuv",
  };

  it("usable_pair when the platform endpoint carries artist+title", async () => {
    const out = await probeStationPublicMetadata(
      JAR,
      deps({
        fetchJson: async () => ({ artist: "Yussef Dayes", title: "Blackfriars" }),
      }),
    );
    expect(out?.kind).toBe("radiojar");
    expect(out?.outcome).toBe("usable_pair");
    expect(out?.sampleArtist).toBe("Yussef Dayes");
  });

  it("blank_metadata for a stale public feed (endpoint answers, no current track)", async () => {
    const out = await probeStationPublicMetadata(
      JAR,
      deps({ fetchJson: async () => ({ artist: "", title: "" }) }),
    );
    expect(out?.outcome).toBe("blank_metadata");
  });

  it("blank_metadata when only one field is published (show-only value)", async () => {
    const out = await probeStationPublicMetadata(
      JAR,
      deps({ fetchJson: async () => ({ artist: "Saria" }) }),
    );
    expect(out?.outcome).toBe("blank_metadata");
  });

  it("unreachable when the platform endpoint errors", async () => {
    const out = await probeStationPublicMetadata(
      JAR,
      deps({
        fetchJson: async () => {
          throw new Error("503 Service Unavailable");
        },
      }),
    );
    expect(out?.outcome).toBe("unreachable");
    expect(out?.detail).toMatch(/503/);
  });

  it("config streamId wins over URL derivation", async () => {
    let fetched = "";
    const station = {
      ...JAR,
      nowPlayingConfig: { streamId: "configured-id" },
    };
    await probeStationPublicMetadata(
      station,
      deps({
        fetchJson: async (url: string) => {
          fetched = url;
          return {};
        },
      }),
    );
    expect(fetched).toContain("/api/stations/configured-id/");
  });
});

describe("radiojarStreamId", () => {
  it("derives the stream id from a radiojar.com stream URL", () => {
    expect(
      radiojarStreamId({
        ...STATION,
        streamUrl: "https://stream.radiojar.com/78cxy6wkxtzuv",
      }),
    ).toBe("78cxy6wkxtzuv");
  });

  it("returns null for non-radiojar stations", () => {
    expect(radiojarStreamId(STATION)).toBeNull();
  });
});
