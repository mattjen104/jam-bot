import { describe, it, expect } from "vitest";
import {
  classifySourceCoverage,
  isTestLikeStation,
  isRealRosterStation,
  type CoverageInput,
} from "../src/lore/source-coverage.js";
import {
  ICY_REPAIR_STATIONS,
  SEED_STATIONS,
} from "../src/lore/seed.js";
import { VERIFIED_STATION_SOURCE_PROBES } from "../src/lore/source-probe-migration.js";

/**
 * Pure classification tests for the source-coverage ledger — no DB, no
 * network. Covers every class, the fingerprint-candidate derivation, and the
 * test/placeholder + longtail exclusion rules.
 */

const NOW = new Date("2026-08-19T12:00:00Z");

function baseInput(
  overrides: Partial<CoverageInput["station"]> = {},
): CoverageInput {
  return {
    station: {
      id: 1,
      slug: "wxyz",
      nowPlayingSource: null,
      streamUrl: "https://stream.example.com/wxyz",
      hidden: false,
      ...overrides,
    },
    latestUsableSpin: null,
    rbHealth: null,
    probe: null,
    now: NOW,
  };
}

describe("classifySourceCoverage", () => {
  it("healthy: configured source with a fresh usable spin", () => {
    const v = classifySourceCoverage(
      baseInput({ nowPlayingSource: "radio_browser_icy" }),
    );
    const withSpin: CoverageInput = {
      ...v && baseInput({ nowPlayingSource: "radio_browser_icy" }),
      latestUsableSpin: {
        source: "radio_browser_icy",
        observedAt: new Date(NOW.getTime() - 30_000), // within 2×30s cadence
      },
    };
    const out = classifySourceCoverage(withSpin);
    expect(out.class).toBe("healthy");
    expect(out.fingerprintCandidate).toBe(false);
  });

  it("healthy: ICY source with a recently-answering health row but no fresh spin (talk/between tracks)", () => {
    const out = classifySourceCoverage({
      ...baseInput({ nowPlayingSource: "radio_browser_icy" }),
      rbHealth: {
        icyStatus: "active",
        lastStreamTitle: null,
        lastSuccessAt: new Date(NOW.getTime() - 60_000),
      },
    });
    expect(out.class).toBe("healthy");
  });

  it("recoverable: no source configured but a stream exists and no probe yet", () => {
    const out = classifySourceCoverage(baseInput());
    expect(out.class).toBe("recoverable");
    expect(out.fingerprintCandidate).toBe(false);
    expect(out.guidance).toMatch(/probe/i);
  });

  it("recoverable: probe verified a usable pair on a source-less station", () => {
    const out = classifySourceCoverage({
      ...baseInput(),
      probe: { outcome: "usable_pair", probedAt: NOW },
    });
    expect(out.class).toBe("recoverable");
    expect(out.fingerprintCandidate).toBe(false);
  });

  it("recoverable: configured source went stale but stream may still publish metadata", () => {
    const out = classifySourceCoverage({
      ...baseInput({ nowPlayingSource: "spinitron_web" }),
      latestUsableSpin: {
        source: "spinitron_web",
        observedAt: new Date(NOW.getTime() - 6 * 60 * 60_000), // long past stale
      },
    });
    expect(out.class).toBe("recoverable");
  });

  it("no_source: probe found blank/junk metadata — residual fingerprint candidate when on-air", () => {
    const out = classifySourceCoverage({
      ...baseInput(),
      probe: { outcome: "blank_metadata", probedAt: NOW },
    });
    expect(out.class).toBe("no_source");
    expect(out.fingerprintCandidate).toBe(true);
    expect(out.guidance).toMatch(/fingerprint/i);
  });

  it("no_source: probe found the surface does not expose track metadata", () => {
    const out = classifySourceCoverage({
      ...baseInput(),
      probe: { outcome: "unsupported", probedAt: NOW },
    });
    expect(out.class).toBe("no_source");
    expect(out.fingerprintCandidate).toBe(true);
  });

  it("unavailable: probe could not reach the stream at all", () => {
    const out = classifySourceCoverage({
      ...baseInput(),
      probe: { outcome: "unreachable", probedAt: NOW },
    });
    expect(out.class).toBe("unavailable");
    expect(out.fingerprintCandidate).toBe(false);
  });

  it("unavailable: source configured, never produced, and no stream to probe", () => {
    const out = classifySourceCoverage(
      baseInput({ nowPlayingSource: "spinitron_web", streamUrl: "" }),
    );
    expect(out.class).toBe("unavailable");
    expect(out.fingerprintCandidate).toBe(false);
  });

  it("no_source: no source and no stream — nothing to probe or fingerprint", () => {
    const out = classifySourceCoverage(baseInput({ streamUrl: "" }));
    expect(out.class).toBe("no_source");
    expect(out.fingerprintCandidate).toBe(false);
  });

  it("live spin evidence outranks an older adverse probe", () => {
    const out = classifySourceCoverage({
      ...baseInput({ nowPlayingSource: "radio_browser_icy" }),
      latestUsableSpin: {
        source: "radio_browser_icy",
        observedAt: new Date(NOW.getTime() - 10_000),
      },
      probe: { outcome: "unreachable", probedAt: new Date(NOW.getTime() - 3600_000) },
    });
    expect(out.class).toBe("healthy");
  });
});

describe("verified station source audit seed", () => {
  const auditedSlugs = ["dublab", "rinse-fm", "balamii", "wbgo"] as const;
  const expectedClasses = {
    dublab: "no_source",
    "rinse-fm": "no_source",
    balamii: "unavailable",
    wbgo: "recoverable",
  } as const;

  it("reproduces the audited ledger classes without runtime-only evidence", () => {
    for (const slug of auditedSlugs) {
      const station = SEED_STATIONS.find((candidate) => candidate.slug === slug);
      const probe = VERIFIED_STATION_SOURCE_PROBES.find(
        (candidate) => candidate.slug === slug,
      );
      expect(station, `missing seed station ${slug}`).toBeDefined();
      expect(probe, `missing seed probe ${slug}`).toBeDefined();

      const verdict = classifySourceCoverage({
        station: {
          id: 1,
          slug,
          nowPlayingSource: station!.nowPlayingSource ?? null,
          streamUrl: station!.streamUrl ?? null,
          hidden: station!.hidden ?? false,
        },
        latestUsableSpin: null,
        rbHealth: null,
        probe: {
          outcome: probe!.outcome,
          probedAt: probe!.probedAt,
        },
        now: NOW,
      });
      expect(verdict.class, slug).toBe(expectedClasses[slug]);
    }
  });

  it("retires Balamii from playback and polling while retaining dead-URL provenance", () => {
    const balamii = SEED_STATIONS.find((station) => station.slug === "balamii")!;
    expect(balamii.streamUrl).toBe("");
    expect(balamii.nowPlayingSource).toBeNull();
    expect(balamii.nowPlayingConfig).toMatchObject({
      knownUnavailable: true,
      retiredStreamUrl: "https://balamii.out.airtime.pro/balamii_a",
    });
  });

  it("keeps the verified Dublab, Rinse, and WBGO URLs wired for repair", () => {
    const bySlug = new Map(SEED_STATIONS.map((station) => [station.slug, station]));
    expect(bySlug.get("dublab")?.streamUrl).toBe(
      "https://dublab.out.airtime.pro:8000/dublab_a",
    );
    expect(bySlug.get("rinse-fm")?.streamUrl).toBe(
      "https://admin.stream.rinse.fm/proxy/rinse_uk/stream",
    );
    expect(bySlug.get("wbgo")?.streamUrl).toBe(
      "https://ais-sa8.cdnstream1.com/3629_128.mp3",
    );
    expect(ICY_REPAIR_STATIONS).toContainEqual({
      slug: "wbgo",
      callsign: "WBGO",
      streamUrl: "https://ais-sa8.cdnstream1.com/3629_128.mp3",
    });
  });
});

describe("isTestLikeStation", () => {
  it("flags test-* slugs", () => {
    expect(
      isTestLikeStation({ slug: "test-cross-sta-4de10519", streamUrl: "" }),
    ).toBe(true);
  });

  it("flags tNN- and tc- prefixed slugs", () => {
    expect(
      isTestLikeStation({ slug: "t67-4fdb1912-normal", streamUrl: "" }),
    ).toBe(true);
    expect(
      isTestLikeStation({ slug: "tc-blend-station-41cdebf5", streamUrl: "" }),
    ).toBe(true);
  });

  it("flags the literal placeholder slug", () => {
    expect(isTestLikeStation({ slug: "slug", streamUrl: "" })).toBe(true);
  });

  it("flags reserved non-public stream hosts regardless of slug", () => {
    expect(
      isTestLikeStation({
        slug: "artist-frequency-ce48e653",
        streamUrl: "http://example.invalid/frequency",
      }),
    ).toBe(true);
    expect(
      isTestLikeStation({
        slug: "thin-enq-st-f3ab3835",
        streamUrl: "http://thin-enq.test",
      }),
    ).toBe(true);
  });

  it("does not flag real stations", () => {
    expect(
      isTestLikeStation({
        slug: "dublab",
        streamUrl: "https://dublab.out.airtime.pro/dublab_a",
      }),
    ).toBe(false);
    expect(isTestLikeStation({ slug: "chmr", streamUrl: "" })).toBe(false);
  });

  it("does not crash on unparseable stream URLs", () => {
    expect(isTestLikeStation({ slug: "wxyz", streamUrl: "not a url" })).toBe(
      false,
    );
  });
});

describe("isRealRosterStation", () => {
  it("excludes longtail discoveries", () => {
    expect(
      isRealRosterStation({
        slug: "rb-abc123",
        streamUrl: "https://real.example.org/s",
        tier: "longtail",
      }),
    ).toBe(false);
  });

  it("excludes test-like rows even at flagship tier", () => {
    expect(
      isRealRosterStation({
        slug: "test-wp-61c9ce71",
        streamUrl: "http://example.invalid/wp",
        tier: "flagship",
      }),
    ).toBe(false);
  });

  it("includes real flagship stations", () => {
    expect(
      isRealRosterStation({
        slug: "kexp",
        streamUrl: "https://kexp.streamguys1.com/kexp160.aac",
        tier: "flagship",
      }),
    ).toBe(true);
  });
});
