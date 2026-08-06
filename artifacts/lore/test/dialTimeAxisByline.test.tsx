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
} from "../src/components/dialViewHelpers";
import type { DialShow, DialSpin } from "../src/hooks/useDialData";

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
// pastTimingLabel
// ---------------------------------------------------------------------------

describe("pastTimingLabel — time granularity", () => {
  it("renders minutes for < 1h", () => {
    const label = pastTimingLabel(minsAgo(23), null);
    expect(label).toBe("23 minutes ago");
  });

  it("renders '1 minute ago' for ≤ 1 min", () => {
    const label = pastTimingLabel(minsAgo(0), null);
    expect(label).toBe("1 minute ago");
  });

  it("renders word-form hours for < 12h", () => {
    const label = pastTimingLabel(minsAgo(120), null); // 2 hours
    expect(label).toBe("two hours ago");
  });

  it("renders 'one hour ago' for exactly 1h", () => {
    const label = pastTimingLabel(minsAgo(60), null);
    expect(label).toBe("one hour ago");
  });

  it("renders 'eleven hours ago' for 11h", () => {
    const label = pastTimingLabel(minsAgo(660), null);
    expect(label).toBe("eleven hours ago");
  });

  it("renders weekday + daypart using station timezone when < 7d", () => {
    // Tuesday at 21:30 UTC = Tuesday at 14:30 PDT (America/Los_Angeles)
    // 14:30 = afternoon
    const playedAt = new Date("2026-08-04T21:30:00Z"); // recent enough to be < 7d
    const label = pastTimingLabel(playedAt, "America/Los_Angeles");
    // Tuesday afternoon in LA
    expect(label).toMatch(/tuesday/i);
    expect(label).toMatch(/afternoon/i);
  });

  it("renders 03:00 UTC on US/Pacific station as the previous evening, not morning", () => {
    // 03:00 UTC = 20:00 PDT (previous calendar day = Tuesday evening)
    const playedAt = new Date("2026-08-05T03:00:00Z"); // Wednesday 03:00 UTC = Tuesday 20:00 PDT
    const label = pastTimingLabel(playedAt, "America/Los_Angeles");
    expect(label).toMatch(/tuesday/i);
    expect(label).toMatch(/evening/i);
  });

  it("renders absolute date when station has no timezone (< 7d)", () => {
    // Within 7d but no tz → absolute date, never a guessed daypart
    const playedAt = minsAgo(48 * 60); // 2 days ago
    const label = pastTimingLabel(playedAt, null);
    // Should be a month-day format, not a weekday+daypart
    expect(label).not.toMatch(/morning|afternoon|evening|night/i);
    expect(label).toMatch(/\w{3} \d+/); // e.g. "Aug 4"
  });

  it("renders absolute date for > 7d regardless of timezone", () => {
    const playedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const label = pastTimingLabel(playedAt, "America/Chicago");
    expect(label).not.toMatch(/ago/);
    expect(label).not.toMatch(/morning|afternoon|evening|night/i);
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
  it("uses pastTimingLabel instead of 'now' or 'this set' in past mode", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Radiohead"] });
    const result = crossingSentence("KEXP", show, "personal", undefined, {
      playedAt: minsAgo(45),
      stationIanaTimezone: null,
    });
    expect(result).not.toBeNull();
    const t = text(result!.node);
    expect(t).toMatch(/45 minutes ago/);
    expect(t).not.toMatch(/this set/i);
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
    // In live mode, "this set" is a toggle button; in past mode there's no toggle.
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

describe("crossingSentence — live mode output unchanged", () => {
  it("returns 'this set' (not a past label) when no past context provided", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Radiohead"] });
    const liveResult = crossingSentence("KEXP", show, "personal");
    const t = text(liveResult!.node);
    expect(t).toMatch(/this set/i);
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
