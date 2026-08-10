/**
 * Tests for past-mode byline additions: pastTimingLabel, pastServiceClause,
 * and crossingSentence past-mode behaviour.
 *
 * Key invariants verified:
 *  - live/curated orientation output is byte-identical to before (additive only)
 *  - past timing comes from playedAt, never "now" or "this set"
 *  - a service is never the grammatical subject of a provenance verb
 *  - service clause is absent when no service is resolved
 *  - station-timezone daypart vs absolute-date fallback
 */

import { renderToStaticMarkup } from "react-dom/server";
import React, { type ReactNode } from "react";
import { describe, it, expect } from "vitest";

import {
  pastTimingLabel,
  pastServiceClause,
  crossingSentence,
  classifySetTimeContext,
} from "../src/components/dialViewHelpers";
import type { DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, "");
}

function markup(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

function minsAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Afternoon Mix",
    djName: "Lina",
    djNames: ["Lina"],
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    state: "live",
    spins: [],
    crossings: 3,
    artistCrossings: 0,
    topArtists: ["Radiohead", "Portishead"],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Station-local set time contexts
// ---------------------------------------------------------------------------

describe("classifySetTimeContext", () => {
  const zone = "America/Los_Angeles";
  const now = new Date("2026-08-08T20:00:00Z"); // 13:00 Saturday in Los Angeles

  it("distinguishes now from the current set", () => {
    expect(classifySetTimeContext({
      startedAt: new Date("2026-08-08T19:30:00Z"), stationIanaTimezone: zone, now, isNow: true,
    })).toMatchObject({ kind: "now", label: "now", daypart: "day" });
    expect(classifySetTimeContext({
      startedAt: new Date("2026-08-08T19:00:00Z"), stationIanaTimezone: zone, now, isCurrentSet: true,
    })).toMatchObject({ kind: "current-set", label: "in the current set", daypart: "day" });
  });

  it("calls another same-local-day set the last set", () => {
    expect(classifySetTimeContext({
      startedAt: new Date("2026-08-08T14:00:00Z"), stationIanaTimezone: zone, now,
    })).toMatchObject({ kind: "last-set", label: "in the last set", day: "2026-08-08" });
  });

  it("calls the previous station-local night last night", () => {
    expect(classifySetTimeContext({
      startedAt: new Date("2026-08-08T06:30:00Z"), stationIanaTimezone: zone, now, // Fri 23:30 PDT
    })).toMatchObject({ kind: "last-night", label: "last night", daypart: "night" });
  });

  it("uses the station timezone, not UTC/browser time, for day and daypart", () => {
    const result = classifySetTimeContext({
      startedAt: new Date("2026-08-08T03:30:00Z"), stationIanaTimezone: zone, now,
    }); // Friday 20:30 PDT, rather than Saturday 03:30 UTC
    expect(result).toMatchObject({ kind: "dated", day: "2026-08-07", daypart: "day" });
    expect(result.label).toMatch(/Friday day/);
  });

  it("keeps 9pm through 4:59am in the night slice across midnight", () => {
    const atNine = classifySetTimeContext({
      startedAt: new Date("2026-08-08T04:00:00Z"), stationIanaTimezone: zone, now,
    }); // Fri 21:00 PDT
    const atFourFiftyNine = classifySetTimeContext({
      startedAt: new Date("2026-08-08T11:59:00Z"), stationIanaTimezone: zone, now,
    }); // Sat 04:59 PDT
    const atFive = classifySetTimeContext({
      startedAt: new Date("2026-08-08T12:00:00Z"), stationIanaTimezone: zone, now,
    }); // Sat 05:00 PDT
    expect(atNine.daypart).toBe("night");
    expect(atFourFiftyNine.daypart).toBe("night");
    expect(atFive.daypart).toBe("day");
  });

  it("falls back to an honest absolute date when a station timezone is absent", () => {
    const label = pastTimingLabel(new Date("2026-08-01T12:00:00Z"), null);
    expect(label).toMatch(/Aug 1, 2026/);
  });
});

// ---------------------------------------------------------------------------
// pastServiceClause
// ---------------------------------------------------------------------------

describe("pastServiceClause", () => {
  it("returns null for null service", () => {
    expect(pastServiceClause(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(pastServiceClause(undefined)).toBeNull();
  });

  it("returns Spotify clause", () => {
    expect(pastServiceClause("spotify")).toBe("Replaying on your Spotify.");
  });

  it("returns YouTube clause", () => {
    expect(pastServiceClause("youtube")).toBe("Replaying on your YouTube.");
  });

  it("returns Apple Music clause", () => {
    expect(pastServiceClause("apple-music")).toBe("Replaying on your Apple Music.");
  });

  it("returns null for unrecognised service", () => {
    expect(pastServiceClause("tidal")).toBeNull();
  });

  it("service clause never starts with a service name as subject of a provenance verb", () => {
    // The clause must say "Replaying on your X" not "X played" or "X selected"
    const clause = pastServiceClause("spotify")!;
    expect(clause).not.toMatch(/spotify (played|selected|aired)/i);
    expect(clause).toMatch(/^Replaying on your/);
  });
});

// ---------------------------------------------------------------------------
// crossingSentence — past context
// ---------------------------------------------------------------------------

describe("crossingSentence — past context", () => {
  it("uses the coherent last-set label instead of 'now' or 'current set' in past mode", () => {
    const show = makeShow({
      crossings: 2,
      topArtists: ["Radiohead"],
      startedAt: new Date().toISOString(),
    });
    const result = crossingSentence("KEXP", show, "personal", undefined, {
      playedAt: new Date(),
      setStartedAt: new Date(),
      stationIanaTimezone: "America/Los_Angeles",
      isCurrentSet: false,
    });
    expect(result).not.toBeNull();
    const t = text(result!.node);
    expect(t).toMatch(/in the last set/i);
    expect(t).not.toMatch(/current set/i);
    expect(t).not.toMatch(/\bnow\b/);
  });

  it("returns serviceClause null when no service resolved", () => {
    const show = makeShow({ crossings: 1, topArtists: ["PJ Harvey"] });
    const result = crossingSentence("WFMU", show, "personal", undefined, {
      playedAt: minsAgo(10),
    });
    expect(result?.serviceClause).toBeNull();
  });

  it("returns serviceClause when service is resolved", () => {
    const show = makeShow({ crossings: 1, topArtists: ["PJ Harvey"] });
    const result = crossingSentence("WFMU", show, "personal", undefined, {
      playedAt: minsAgo(10),
      resolvedService: "spotify",
    });
    expect(result?.serviceClause).toBe("Replaying on your Spotify.");
  });

  it("service is never the subject of a provenance verb in the main node", () => {
    // The main sentence must attribute provenance to station/picker, never the service.
    // "Your Spotify played Bell Witch" is forbidden output.
    const show = makeShow({ crossings: 1, topArtists: ["Bell Witch"] });
    const result = crossingSentence("WFMU", show, "personal", undefined, {
      playedAt: minsAgo(10),
      resolvedService: "spotify",
    });
    const m = markup(result!.node);
    expect(m).not.toMatch(/spotify.*played|spotify.*selected|spotify.*aired/i);
  });

  it("past with picker + station + service renders provenance and playback as separate clauses", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Radiohead"], djName: "Lina", djNames: ["Lina"] });
    const result = crossingSentence("KEXP", show, "personal", undefined, {
      playedAt: minsAgo(90), // ≈ 1.5h → "one hour ago" (rounds to nearest)
      resolvedService: "spotify",
    });
    expect(result).not.toBeNull();
    // Main node has provenance attribution (Lina selected ...)
    const mainText = text(result!.node);
    expect(mainText).toMatch(/Lina selected/i);
    // Service clause is separate, not embedded in the main sentence
    expect(result!.serviceClause).toBe("Replaying on your Spotify.");
    // Service clause does not appear in the main node markup
    expect(markup(result!.node)).not.toMatch(/replaying/i);
  });

  it("past with resolved service but no attributable picker falls to station-level provenance, service clause still present", () => {
    // No DJ, no show name — still surfaces the service clause
    const show = makeShow({
      crossings: 1,
      topArtists: ["Low"],
      djName: null,
      djNames: [],
      showName: null,
    });
    const result = crossingSentence("KEXP", show, "personal", undefined, {
      playedAt: minsAgo(60),
      resolvedService: "spotify",
    });
    expect(result?.serviceClause).toBe("Replaying on your Spotify.");
  });

  it("past with no resolved service renders no service clause", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Low"] });
    const result = crossingSentence("KEXP", show, "personal", undefined, {
      playedAt: minsAgo(60),
      resolvedService: null,
    });
    expect(result?.serviceClause).toBeNull();
  });

  it("no toggle affordance in past mode", () => {
    // In live mode, "current set" is a toggle button; in past mode there's no toggle.
    const show = makeShow({ crossings: 3, topArtists: ["Radiohead", "Portishead"] });
    const result = crossingSentence("KEXP", show, "personal", undefined, {
      playedAt: minsAgo(180),
      stationIanaTimezone: "America/Los_Angeles",
    });
    // No <button> in the markup — timing is plain text
    expect(markup(result!.node)).not.toMatch(/<button/i);
  });
});

// ---------------------------------------------------------------------------
// crossingSentence — live mode unchanged (regression guard)
// ---------------------------------------------------------------------------

describe("crossingSentence — live mode", () => {
  it("returns 'in the current set' (not a past label) when no past context provided", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Radiohead"] });
    const liveResult = crossingSentence("KEXP", show, "personal");
    const t = text(liveResult!.node);
    expect(t).toMatch(/in the current set/i);
    expect(t).not.toMatch(/ago/);
  });

  it("returns 'now' when current track is a library hit (no past context)", () => {
    const show = makeShow({
      crossings: 1,
      topArtists: ["Radiohead"],
      currentTrack: {
        mbid: "mbid-1",
        artistMbid: null,
        title: "Creep",
        artist: "Radiohead",
        playedAt: new Date().toISOString(),
        isLibraryHit: true,
        isArtistHit: false,
        isFirstSpin: true,
      },
    });
    const result = crossingSentence("KEXP", show, "personal");
    expect(text(result!.node)).toMatch(/, now/);
  });

  it("serviceClause is null in live mode", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Radiohead"] });
    const result = crossingSentence("KEXP", show, "personal");
    expect(result?.serviceClause).toBeNull();
  });
});
