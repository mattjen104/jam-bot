// @vitest-environment jsdom
/**
 * Press sentence grammar — artist leads, source is the byline object,
 * date reads naturally, no song titles ever.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { pressSentence, pressDateLabel, type PressMentionLike } from "../src/components/dialViewHelpers";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function mention(overrides: Partial<PressMentionLike> = {}): PressMentionLike {
  return {
    artistName: "Fleetwood Mac",
    kind: "list_entry",
    sourceLabel: "Pitchfork — Best Albums of 1977",
    context: null,
    occurredAt: "2023-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function textOf(node: React.ReactNode): string {
  const { container } = render(<>{node}</>);
  return container.textContent ?? "";
}

describe("pressDateLabel", () => {
  it("today within 24h", () => {
    expect(pressDateLabel("2026-08-14T02:00:00.000Z", NOW)).toBe("today");
  });
  it("this week within 7 days", () => {
    expect(pressDateLabel("2026-08-10T00:00:00.000Z", NOW)).toBe("this week");
  });
  it("this month within 31 days", () => {
    expect(pressDateLabel("2026-07-20T00:00:00.000Z", NOW)).toBe("this month");
  });
  it("month name within the same year", () => {
    expect(pressDateLabel("2026-03-05T00:00:00.000Z", NOW)).toBe("in March");
  });
  it("bare year for older mentions", () => {
    expect(pressDateLabel("2023-06-01T00:00:00.000Z", NOW)).toBe("in 2023");
  });
  it("null for undated or invalid", () => {
    expect(pressDateLabel(null, NOW)).toBeNull();
    expect(pressDateLabel("not-a-date", NOW)).toBeNull();
  });
});

describe("pressSentence", () => {
  it("list entries read 'made [Source] in [year]'", () => {
    const text = textOf(pressSentence(mention(), NOW));
    expect(text).toBe("Fleetwood Mac, from your Library, made Pitchfork — Best Albums of 1977 in 2023.");
  });

  it("picks read 'picked by [Source]'", () => {
    const text = textOf(pressSentence(mention({
      kind: "pick",
      sourceLabel: "Bandcamp Daily",
      occurredAt: "2026-08-13T00:00:00.000Z",
    }), NOW));
    expect(text).toBe("Fleetwood Mac, from your Library, picked by Bandcamp Daily this week.");
  });

  it("track claims read 'covered by [Source]'", () => {
    const text = textOf(pressSentence(mention({
      kind: "track_claim",
      sourceLabel: "Classic Albums: Rumours",
      occurredAt: "2026-07-25T00:00:00.000Z",
    }), NOW));
    expect(text).toBe("Fleetwood Mac, from your Library, covered by Classic Albums: Rumours this month.");
  });

  it("omits the date clause when undated", () => {
    const text = textOf(pressSentence(mention({ occurredAt: null }), NOW));
    expect(text).toBe("Fleetwood Mac, from your Library, made Pitchfork — Best Albums of 1977.");
  });

  it("returns null without an artist — no subject, no sentence", () => {
    expect(pressSentence(mention({ artistName: null }), NOW)).toBeNull();
    expect(pressSentence(mention({ artistName: "  " }), NOW)).toBeNull();
  });

  it("never includes song titles (artist-level crossing only)", () => {
    // The mention shape has no title field at all; verify the context string
    // is NOT rendered into the sentence (it lives on the row's byline).
    const text = textOf(pressSentence(mention({ context: "Dreams (2004 Remaster)" }), NOW));
    expect(text).not.toContain("Dreams");
  });

  it("artist renders at full display weight (fdrow__artist)", () => {
    const { container } = render(<>{pressSentence(mention(), NOW)}</>);
    const b = container.querySelector("b.fdrow__artist");
    expect(b?.textContent).toBe("Fleetwood Mac");
    const src = container.querySelector("span.fdrow__show");
    expect(src?.textContent).toBe("Pitchfork — Best Albums of 1977");
  });
});
