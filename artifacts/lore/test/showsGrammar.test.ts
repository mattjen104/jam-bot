/**
 * Unit tests for the Shows lens date and sentence grammar.
 *
 * Covers:
 *   - showsDateLabel: "tonight", "tomorrow", weekday, "March 14", "March 14, 2026"
 *   - showsSentence: artist leads, venue/date byline, null on past events
 */

import { describe, it, expect } from "vitest";
import { showsDateLabel, showsSentence } from "../src/components/dialViewHelpers";

// Fix "now" to a Tuesday 2026-08-11 for deterministic tests
const NOW = new Date(2026, 7, 11, 14, 0, 0); // Tue 11 Aug 2026, 14:00 local

describe("showsDateLabel", () => {
  it('returns "tonight" for today\'s event', () => {
    expect(showsDateLabel("2026-08-11", NOW)).toBe("tonight");
  });

  it('returns "tomorrow" for a next-day event', () => {
    expect(showsDateLabel("2026-08-12", NOW)).toBe("tomorrow");
  });

  it("returns the weekday for events within the next 7 days", () => {
    expect(showsDateLabel("2026-08-13", NOW)).toBe("Thursday");
    expect(showsDateLabel("2026-08-17", NOW)).toBe("Monday");
  });

  it("returns 'Month Day' for events this year beyond 7 days", () => {
    const label = showsDateLabel("2026-09-20", NOW);
    expect(label).toBe("September 20");
  });

  it("returns 'Month Day, Year' for events in a different year", () => {
    const label = showsDateLabel("2027-03-14", NOW);
    expect(label).toBe("March 14, 2027");
  });

  it("returns null for past events", () => {
    expect(showsDateLabel("2026-08-10", NOW)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(showsDateLabel(null, NOW)).toBeNull();
  });

  it("returns null for a malformed date string", () => {
    expect(showsDateLabel("not-a-date", NOW)).toBeNull();
    expect(showsDateLabel("2026/08/15", NOW)).toBeNull();
  });
});

describe("showsSentence", () => {
  const baseEvent = {
    artistName: "Fleetwood Mac",
    eventDate: "2026-08-13", // Thursday
    venueName: "Crystal Ballroom",
    venueCity: "Portland",
    venueRegion: "OR",
    ticketUrl: "https://example.com/tickets",
  };

  it("builds a named-venue sentence", () => {
    const result = showsSentence(baseEvent, NOW);
    expect(result).not.toBeNull();
    expect(result!.dateLabel).toBe("Thursday");
    // The sentence renders React nodes; spot-check the dateLabel return
  });

  it("uses city+region when no venue name is set", () => {
    const result = showsSentence({ ...baseEvent, venueName: null }, NOW);
    expect(result).not.toBeNull();
    expect(result!.dateLabel).toBe("Thursday");
  });

  it("uses city only when no region is set", () => {
    const result = showsSentence({ ...baseEvent, venueName: null, venueRegion: null }, NOW);
    expect(result).not.toBeNull();
  });

  it("returns null for a past event date", () => {
    const result = showsSentence({ ...baseEvent, eventDate: "2026-08-10" }, NOW);
    expect(result).toBeNull();
  });

  it("returns null when the artist name is empty/whitespace", () => {
    const result = showsSentence({ ...baseEvent, artistName: "  " }, NOW);
    expect(result).toBeNull();
  });

  it("returns null when the artist name is a MISSING_LIVE_VALUE sentinel", () => {
    const result = showsSentence({ ...baseEvent, artistName: "Unknown" }, NOW);
    expect(result).toBeNull();
  });

  it("returns null when the eventDate is null", () => {
    const result = showsSentence({ ...baseEvent, eventDate: null }, NOW);
    expect(result).toBeNull();
  });
});
