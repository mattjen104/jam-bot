// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  auditSoundtapIdentity,
  parseSoundtapStations,
  rankAbsentCandidates,
  recommendFromComparableEvidence,
  selectVerifiedSoundtapMatches,
} from "../../src/scripts/audit-soundtap-schedules.js";
import {
  canStartMonitoredTrial,
  isMonitoredTrialStation,
  monitoredTrialFromConfig,
} from "../../src/lore/monitored-trial.js";
import { parseArgs } from "../../src/scripts/refresh-soundtap-schedules.js";

const station = {
  id: 1,
  slug: "station-kabc",
  name: "KABC — Community Radio",
  org: null,
  homepageUrl: "https://station.example",
  scheduleUrl: null,
  config: null,
};

describe("Soundtap evidence-based identity audit", () => {
  it("normalizes Australia without matching the short US alias inside it", () => {
    const [australian] = parseSoundtapStations(
      "[4ZZZ](https://soundtap.fm/stations/4zzz)\n\nAustralia\n",
    );
    const [austin] = parseSoundtapStations(
      "[Community Station](https://soundtap.fm/stations/austin)\n\nAustin, Texas\n",
    );
    expect(australian?.country).toBe("AU");
    expect(austin?.country).toBeNull();
  });

  it("matches a callsign only when corroborated by geography", () => {
    const soundtap = parseSoundtapStations(
      "[KABC – Community Radio](https://soundtap.fm/stations/different-slug)\n\nUnited States\n",
    );
    const result = selectVerifiedSoundtapMatches(soundtap, [{ ...station, country: "US" }]);

    expect(result.shared).toEqual([
      expect.objectContaining({
        confidence: "medium",
        station: expect.objectContaining({ id: station.id }),
      }),
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  it("does not verify a single-token callsign without corroboration", () => {
    const source = parseSoundtapStations(
      "[KABC](https://soundtap.fm/stations/kabc)\n",
    );
    expect(auditSoundtapIdentity(source, [station]).absent).toHaveLength(1);
  });

  it("quarantines callsign collisions rather than choosing a candidate", () => {
    const soundtap = parseSoundtapStations(
      "[KABC](https://soundtap.fm/stations/kabc)\n\nUnited States\n",
    );
    const result = selectVerifiedSoundtapMatches(soundtap, [
      { ...station, country: "US" },
      { ...station, id: 2, slug: "another-kabc", country: "US" },
    ]);

    expect(result.shared).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
  });

  it.each([
    ["dublab", "Dublab"],
    ["thelotradio", "The Lot Radio"],
    ["worldwidefm", "Worldwide FM"],
    ["bytefm", "ByteFM"],
  ])("recognizes international branded station %s", (slug, name) => {
    const source = parseSoundtapStations(
      `[${name}](https://soundtap.fm/stations/${slug})\n\nGermany\n`,
    );
    const result = auditSoundtapIdentity(source, [
      { ...station, id: 9, slug: `lore-${slug}`, name, org: name, country: "DE" },
    ]);
    expect(result.branded).toHaveLength(1);
    expect(result.absent).toEqual([]);
  });

  it("quarantines a stale or conflicting official domain", () => {
    const source = [{
      ...parseSoundtapStations(
        "[dublab](https://soundtap.fm/stations/dublab)\n\nUnited States\n",
      )[0]!,
      officialUrl: "https://dublab.com",
    }];
    const result = auditSoundtapIdentity(source, [{
      ...station,
      name: "dublab",
      org: "dublab",
      country: "US",
      homepageUrl: "https://impostor.example",
    }]);
    expect(result.shared).toEqual([]);
    expect(result.ambiguous[0]?.reason).toBe("conflicting_identity_evidence");
  });

  it("does not triple-count a callsign-shaped label and config", () => {
    const source = parseSoundtapStations(
      "[KABC](https://soundtap.fm/stations/kabc)\n",
    );
    const result = auditSoundtapIdentity(source, [{
      ...station,
      name: "KABC",
      config: { callsign: "KABC" },
    }]);
    expect(result.shared).toEqual([]);
    expect(result.absent).toHaveLength(1);
  });

  it("quarantines a conflicting plausible candidate even beside a clean one", () => {
    const source = [{
      ...parseSoundtapStations(
        "[dublab](https://soundtap.fm/stations/dublab)\n\nUnited States\n",
      )[0]!,
      officialUrl: "https://dublab.com",
    }];
    const result = auditSoundtapIdentity(source, [
      { ...station, name: "dublab", country: "US", homepageUrl: "https://dublab.com" },
      { ...station, id: 2, name: "dublab", country: "US", homepageUrl: "https://wrong.example" },
    ]);
    expect(result.shared).toEqual([]);
    expect(result.ambiguous[0]?.reason).toBe("conflicting_identity_evidence");
  });

  it("keeps multiply-conflicting plausible identities quarantined regardless of net score", () => {
    const source = [{
      ...parseSoundtapStations(
        "[KABC](https://soundtap.fm/stations/kabc)\n\nUnited States\n",
      )[0]!,
      officialUrl: "https://kabc.example",
      streamUrl: "https://audio.kabc.example/live",
    }];
    const result = auditSoundtapIdentity(source, [
      {
        ...station,
        country: "US",
        homepageUrl: "https://kabc.example",
        streamUrl: "https://audio.kabc.example/live",
      },
      {
        ...station,
        id: 2,
        country: "DE",
        homepageUrl: "https://wrong.example",
        streamUrl: "https://wrong.example/live",
      },
    ]);
    expect(result.shared).toEqual([]);
    expect(result.ambiguous[0]?.reason).toBe("conflicting_identity_evidence");
    expect(result.ambiguous[0]?.candidates).toHaveLength(2);
  });

  it("quarantines duplicate stream identities", () => {
    const source = [{
      ...parseSoundtapStations(
        "[Station International](https://soundtap.fm/stations/international)\n\nFrance\n",
      )[0]!,
      streamUrl: "https://audio.example/live",
    }];
    const duplicate = {
      ...station,
      name: "Station International",
      org: "Station International",
      country: "FR",
      streamUrl: "https://audio.example/live",
    };
    const result = auditSoundtapIdentity(source, [
      duplicate,
      { ...duplicate, id: 2, slug: "duplicate" },
    ]);
    expect(result.shared).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
  });

  it("keeps evidence-insufficient absent candidates out of trials", () => {
    const source = parseSoundtapStations(
      "[ByteFM](https://soundtap.fm/stations/bytefm)\n\nGermany\n",
    );
    expect(rankAbsentCandidates(source)[0]).toMatchObject({
      readiness: "needs_first_party_evidence",
      score: 0,
    });
  });
});

describe("Soundtap monitored trial bounds", () => {
  it("requires explicit apply acknowledgement without selecting schedule refreshes", () => {
    expect(() => parseArgs(["--trial=candidate"])).toThrow(
      "--trial is state-changing and requires --apply",
    );
    expect(parseArgs(["--apply", "--trial=candidate"])).toMatchObject({
      apply: true,
      trialSlug: "candidate",
    });
  });
  it("only starts trials from explicitly pre-staged hidden candidates", () => {
    expect(canStartMonitoredTrial({
      hidden: false,
      active: true,
      crossingEligible: true,
      homepageUrl: "https://station.example",
      streamUrl: "https://stream.example/live",
      nowPlayingSource: "radio_browser_icy",
    })).toBe(false);
    expect(canStartMonitoredTrial({
      hidden: true,
      active: false,
      crossingEligible: false,
      homepageUrl: "https://station.example",
      streamUrl: "https://stream.example/live",
      nowPlayingSource: "radio_browser_icy",
    })).toBe(true);
  });

  it("allows a listener-hidden active trial only inside a seven-day window", () => {
    const now = new Date("2026-09-04T00:00:00Z");
    const config = {
      monitoredTrial: {
        kind: "soundtap_candidate",
        startedAt: "2026-09-03T00:00:00Z",
        endsAt: "2026-09-10T00:00:00Z",
      },
    };
    expect(monitoredTrialFromConfig(config, now)).not.toBeNull();
    expect(isMonitoredTrialStation({
      hidden: true, active: true, nowPlayingConfig: config,
    }, now)).toBe(true);
    expect(isMonitoredTrialStation({
      hidden: false, active: true, nowPlayingConfig: config,
    }, now)).toBe(false);
  });

  it("rejects expired and overlong trial markers", () => {
    expect(monitoredTrialFromConfig({
      monitoredTrial: {
        kind: "soundtap_candidate",
        startedAt: "2026-09-01T00:00:00Z",
        endsAt: "2026-09-09T00:00:01Z",
      },
    }, new Date("2026-09-04T00:00:00Z"))).toBeNull();
  });
});

describe("comparable recommendation window", () => {
  it("keeps insufficient evidence inconclusive", () => {
    expect(recommendFromComparableEvidence({
      spins: 19, resolved: 19, recordings: 19, artists: 19,
    }).recommendation).toBe("trial");
  });

  it("keeps a busy partial trial inconclusive until its full window ends", () => {
    expect(recommendFromComparableEvidence({
      spins: 25, resolved: 20, recordings: 18, artists: 15,
    }, false)).toMatchObject({
      recommendation: "trial",
      reason: "monitored observation window is not complete",
    });
  });

  it("retains and rejects only from sufficient Lore observations", () => {
    expect(recommendFromComparableEvidence({
      spins: 25, resolved: 20, recordings: 18, artists: 15,
    }).recommendation).toBe("retain");
    expect(recommendFromComparableEvidence({
      spins: 25, resolved: 0, recordings: 0, artists: 12,
    }).recommendation).toBe("reject");
  });
});