import { describe, it, expect } from "vitest";
import { SEED_STATIONS } from "../src/lore/seed.js";
import { stationArchiveUrl } from "../src/lore/adapters.js";

/**
 * Pure (no-DB) tests for the three Spinitron cohort batches added in the
 * verified roster expansion:
 *
 *  Cohort 1 — freeform/experimental (10 stations, sort 600–645)
 *  Cohort 2 — jazz (4 stations, sort 700–715)
 *  Cohort 3 — Canadian Spinitron additions (3 stations, sort 906–908)
 *
 * Also tests:
 *  - Slug uniqueness across the full SEED_STATIONS array.
 *  - The late-key-upgrade contract: every spinitron_web station carries its
 *    callsign in nowPlayingConfig, which is the anchor the key-upgrade pass
 *    in seedSpinitronRoster() uses to switch the row to the full adapter.
 *  - Archive calendar URL construction for representative callsigns.
 */

// ── Station slugs by cohort ──────────────────────────────────────────────

const FREEFORM_SLUGS = [
  "whpk", // University of Chicago
  "wesu", // Wesleyan University
  "wzbc", // Boston College
  "wrct", // Carnegie Mellon University
  "kxlu", // Loyola Marymount University
  "wbrs", // Brandeis University
  "wmfo", // Tufts University
  "wxdu", // Duke University
  "wrir", // Richmond Independent Radio
  "wicb", // Ithaca College
] as const;

const JAZZ_SLUGS = [
  "wbgo", // Newark Public Radio
  "kcsm", // College of San Mateo
  "wpfw", // Pacifica Foundation, Washington DC
  "wdiy", // WDIY, Lehigh Valley
] as const;

const CANADIAN_SPINITRON_SLUGS = [
  "ckua", // CKUA Radio Network, Alberta
  "cjsf", // Simon Fraser University
  "chuo", // University of Ottawa
] as const;

// CKCU was upgraded from nowPlayingSource:null (ICY) to spinSource (Spinitron).
const CKCU_UPGRADED = ["ckcu"] as const;

const ALL_NEW_SLUGS = [
  ...FREEFORM_SLUGS,
  ...JAZZ_SLUGS,
  ...CANADIAN_SPINITRON_SLUGS,
  ...CKCU_UPGRADED,
] as const;

// ── Slug uniqueness ───────────────────────────────────────────────────────

describe("SEED_STATIONS slug uniqueness", () => {
  it("has no duplicate slugs in the full curated array", () => {
    const slugs = SEED_STATIONS.map((s) => s.slug);
    const unique = new Set(slugs);
    const duplicates = slugs.filter((slug, i) => slugs.indexOf(slug) !== i);
    expect(
      duplicates,
      `duplicate slugs detected: ${duplicates.join(", ")}`,
    ).toHaveLength(0);
    expect(unique.size).toBe(slugs.length);
  });

  it("every new station slug appears exactly once", () => {
    for (const slug of ALL_NEW_SLUGS) {
      const matches = SEED_STATIONS.filter((s) => s.slug === slug);
      expect(matches, `slug '${slug}' should appear exactly once`).toHaveLength(1);
    }
  });
});

// ── Required metadata on new stations ────────────────────────────────────

describe("new Spinitron cohort metadata completeness", () => {
  it("every new station has name, org, country, homepageUrl, and stationClass", () => {
    for (const slug of ALL_NEW_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug);
      expect(station, `missing station: ${slug}`).toBeDefined();
      expect(station!.name, `${slug} missing name`).toBeTruthy();
      expect(station!.org, `${slug} missing org`).toBeTruthy();
      expect(station!.country, `${slug} missing country`).toBeTruthy();
      expect(station!.homepageUrl, `${slug} missing homepageUrl`).toBeTruthy();
      expect(station!.stationClass, `${slug} stationClass`).toBe("community");
    }
  });

  it("every new station has a numeric sortOrder", () => {
    for (const slug of ALL_NEW_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug);
      expect(typeof station!.sortOrder, `${slug} sortOrder type`).toBe("number");
      expect(station!.sortOrder, `${slug} sortOrder > 0`).toBeGreaterThan(0);
    }
  });

  it("freeform cohort 1 sort orders are in range 600–649", () => {
    for (const slug of FREEFORM_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      expect(station.sortOrder, `${slug} sort order`).toBeGreaterThanOrEqual(600);
      expect(station.sortOrder, `${slug} sort order`).toBeLessThan(650);
    }
  });

  it("jazz cohort 2 sort orders are in range 700–749", () => {
    for (const slug of JAZZ_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      expect(station.sortOrder, `${slug} sort order`).toBeGreaterThanOrEqual(700);
      expect(station.sortOrder, `${slug} sort order`).toBeLessThan(750);
    }
  });

  it("Canadian Spinitron cohort 3 sort orders are in range 906–910", () => {
    for (const slug of CANADIAN_SPINITRON_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      expect(station.sortOrder, `${slug} sort order`).toBeGreaterThanOrEqual(906);
      expect(station.sortOrder, `${slug} sort order`).toBeLessThanOrEqual(910);
    }
  });
});

// ── Spinitron source wiring ───────────────────────────────────────────────

// spinSource() routing after the Spinitron-presence allowlist fix:
//  - allowlisted callsigns (confirmed hosted on spinitron.com) → spinitron_web
//  - non-allowlisted with a verified ICY-capable stream → radio_browser_icy
//  - non-allowlisted without one → null (honest silence, no 404-ing scrape)
// (any of them upgrade to "spinitron" when a SPINITRON_KEY_* env is set)
const ALLOWLISTED_SLUGS = ["wzbc", "wbrs", "wmfo"] as const;
const ICY_FALLBACK_SLUGS = ["whpk", "wxdu", "wicb", "wdiy", "ckcu"] as const;
const NULL_SOURCE_SLUGS = [
  "wesu", "wrct", "kxlu", "wrir",
  "wbgo", "kcsm", "wpfw",
  "ckua", "cjsf", "chuo",
] as const;

describe("new Spinitron stations: nowPlayingSource and nowPlayingConfig", () => {
  it("allowlisted callsigns use spinitron or spinitron_web as nowPlayingSource", () => {
    for (const slug of ALLOWLISTED_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      expect(
        ["spinitron", "spinitron_web"],
        `${slug} nowPlayingSource`,
      ).toContain(station.nowPlayingSource);
    }
  });

  it("non-allowlisted callsigns with an ICY-capable stream fall back to radio_browser_icy", () => {
    for (const slug of ICY_FALLBACK_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      expect(
        ["spinitron", "radio_browser_icy"],
        `${slug} nowPlayingSource`,
      ).toContain(station.nowPlayingSource);
      if (station.nowPlayingSource === "radio_browser_icy") {
        const config = station.nowPlayingConfig as Record<string, unknown>;
        expect(
          typeof config?.streamUrl,
          `${slug} nowPlayingConfig.streamUrl`,
        ).toBe("string");
      }
    }
  });

  it("non-allowlisted callsigns without an ICY stream get NO now-playing source", () => {
    for (const slug of NULL_SOURCE_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      expect(
        ["spinitron", null],
        `${slug} nowPlayingSource`,
      ).toContain(station.nowPlayingSource ?? null);
    }
  });

  it("the three cohort groups exactly cover ALL_NEW_SLUGS", () => {
    const covered = new Set<string>([
      ...ALLOWLISTED_SLUGS,
      ...ICY_FALLBACK_SLUGS,
      ...NULL_SOURCE_SLUGS,
    ]);
    expect([...covered].sort()).toEqual([...ALL_NEW_SLUGS].sort());
  });

  it("every new Spinitron station has a callsign in nowPlayingConfig", () => {
    for (const slug of ALL_NEW_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      const config = station.nowPlayingConfig as Record<string, unknown>;
      expect(
        typeof config?.callsign,
        `${slug} nowPlayingConfig.callsign type`,
      ).toBe("string");
      expect(config.callsign, `${slug} nowPlayingConfig.callsign`).toBeTruthy();
    }
  });

  it("callsign in nowPlayingConfig is uppercase (Spinitron convention)", () => {
    for (const slug of ALL_NEW_SLUGS) {
      const station = SEED_STATIONS.find((s) => s.slug === slug)!;
      const config = station.nowPlayingConfig as Record<string, unknown>;
      const callsign = config.callsign as string;
      expect(callsign, `${slug} callsign should be uppercase`).toBe(
        callsign.toUpperCase(),
      );
    }
  });

  it("CKCU: nowPlayingConfig carries callsign CKCU (ICY fallback keeps the archive link)", () => {
    const ckcu = SEED_STATIONS.find((s) => s.slug === "ckcu")!;
    const config = ckcu.nowPlayingConfig as Record<string, unknown>;
    expect(config.callsign).toBe("CKCU");
    expect(["spinitron", "radio_browser_icy"]).toContain(ckcu.nowPlayingSource);
  });
});

// ── Late key upgrade contract ─────────────────────────────────────────────

describe("late key upgrade contract (spinitron_web → spinitron)", () => {
  it("every spinitron_web station in SEED_STATIONS carries a callsign in nowPlayingConfig", () => {
    // When a SPINITRON_KEY_<CALLSIGN> env var is later added and seedStations()
    // reruns, the key-upgrade pass in seedSpinitronRoster() finds the row by
    // slug and switches nowPlayingSource from spinitron_web to spinitron without
    // creating a duplicate. The callsign is the anchor for that lookup.
    const webStations = SEED_STATIONS.filter(
      (s) => s.nowPlayingSource === "spinitron_web",
    );
    for (const station of webStations) {
      const config = station.nowPlayingConfig as Record<string, unknown>;
      expect(
        typeof config?.callsign,
        `${station.slug} nowPlayingConfig.callsign`,
      ).toBe("string");
      expect(config.callsign, `${station.slug} callsign truthy`).toBeTruthy();
    }
  });

  it("every spinitron station has apiKey + callsign + stationHandle in nowPlayingConfig", () => {
    // When the key IS present, spinSource returns the full three-field config
    // that the spinitron history adapter expects.
    const keyStations = SEED_STATIONS.filter(
      (s) => s.nowPlayingSource === "spinitron",
    );
    for (const station of keyStations) {
      const config = station.nowPlayingConfig as Record<string, unknown>;
      expect(typeof config?.callsign, `${station.slug} callsign`).toBe("string");
      expect(typeof config?.stationHandle, `${station.slug} stationHandle`).toBe(
        "string",
      );
      // apiKey is the resolved env value — non-empty in any spinitron station.
      expect(typeof config?.apiKey, `${station.slug} apiKey`).toBe("string");
      expect(config.apiKey, `${station.slug} apiKey truthy`).toBeTruthy();
    }
  });
});

// ── Archive calendar URL construction ────────────────────────────────────

describe("stationArchiveUrl for new Spinitron callsigns", () => {
  const DATE = "2026-08-08";

  it.each([
    // Freeform cohort 1
    ["WHPK", "https://spinitron.com/WHPK/calendar/date/2026-08-08"],
    ["WESU", "https://spinitron.com/WESU/calendar/date/2026-08-08"],
    ["WZBC", "https://spinitron.com/WZBC/calendar/date/2026-08-08"],
    ["WRCT", "https://spinitron.com/WRCT/calendar/date/2026-08-08"],
    ["KXLU", "https://spinitron.com/KXLU/calendar/date/2026-08-08"],
    ["WBRS", "https://spinitron.com/WBRS/calendar/date/2026-08-08"],
    ["WMFO", "https://spinitron.com/WMFO/calendar/date/2026-08-08"],
    ["WXDU", "https://spinitron.com/WXDU/calendar/date/2026-08-08"],
    ["WRIR", "https://spinitron.com/WRIR/calendar/date/2026-08-08"],
    ["WICB", "https://spinitron.com/WICB/calendar/date/2026-08-08"],
    // Jazz cohort 2
    ["WBGO", "https://spinitron.com/WBGO/calendar/date/2026-08-08"],
    ["KCSM", "https://spinitron.com/KCSM/calendar/date/2026-08-08"],
    ["WPFW", "https://spinitron.com/WPFW/calendar/date/2026-08-08"],
    ["WDIY", "https://spinitron.com/WDIY/calendar/date/2026-08-08"],
    // Canadian cohort 3
    ["CKUA", "https://spinitron.com/CKUA/calendar/date/2026-08-08"],
    ["CJSF", "https://spinitron.com/CJSF/calendar/date/2026-08-08"],
    ["CHUO", "https://spinitron.com/CHUO/calendar/date/2026-08-08"],
    ["CKCU", "https://spinitron.com/CKCU/calendar/date/2026-08-08"],
  ])(
    "callsign %s → correct Spinitron calendar URL",
    (callsign, expectedUrl) => {
      expect(
        stationArchiveUrl("spinitron", DATE, { stationHandle: callsign }),
      ).toBe(expectedUrl);
    },
  );

  it("returns null when stationHandle is absent (consistent with existing behaviour)", () => {
    expect(stationArchiveUrl("spinitron_web", DATE)).toBeNull();
    expect(stationArchiveUrl("spinitron", DATE)).toBeNull();
    expect(stationArchiveUrl("spinitron", DATE, {})).toBeNull();
  });
});
