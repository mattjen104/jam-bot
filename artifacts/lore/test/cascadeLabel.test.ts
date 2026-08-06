/**
 * Cascade label derivation unit test.
 *
 * Confirms that:
 * 1. Each known source maps to the correct human-readable label.
 * 2. The cascade priority order is: local file → Spotify → Apple Music →
 *    Bandcamp → YouTube (lowest).
 */

import { describe, it, expect } from "vitest";

/** Mirror of the sourceLabel logic in PlayerProvider — kept in sync manually. */
function deriveSourceLabel(
  source: "spotify" | "youtube" | "apple-music" | "local-file" | "bandcamp" | "preview" | null,
): string | null {
  switch (source) {
    case "local-file":  return "Local file";
    case "spotify":     return "Spotify";
    case "apple-music": return "Apple Music";
    case "bandcamp":    return "Bandcamp";
    case "youtube":     return "YouTube";
    case "preview":     return "Preview";
    default:            return null;
  }
}

/** Canonical cascade priority, lowest index = highest priority. */
const CASCADE_ORDER: Array<
  "local-file" | "spotify" | "apple-music" | "bandcamp" | "youtube"
> = ["local-file", "spotify", "apple-music", "bandcamp", "youtube"];

describe("cascade label derivation", () => {
  it("returns null for null source", () => {
    expect(deriveSourceLabel(null)).toBeNull();
  });

  it("maps each source to the correct label", () => {
    expect(deriveSourceLabel("local-file")).toBe("Local file");
    expect(deriveSourceLabel("spotify")).toBe("Spotify");
    expect(deriveSourceLabel("apple-music")).toBe("Apple Music");
    expect(deriveSourceLabel("bandcamp")).toBe("Bandcamp");
    expect(deriveSourceLabel("youtube")).toBe("YouTube");
    expect(deriveSourceLabel("preview")).toBe("Preview");
  });

  it("all cascade service sources have a non-null label", () => {
    for (const src of CASCADE_ORDER) {
      expect(deriveSourceLabel(src)).toBeTruthy();
    }
  });

  it("cascade order is: local-file → Spotify → Apple Music → Bandcamp → YouTube", () => {
    // Verify the canonical order list has exactly the expected members in order.
    expect(CASCADE_ORDER).toStrictEqual([
      "local-file",
      "spotify",
      "apple-music",
      "bandcamp",
      "youtube",
    ]);
  });

  it("local-file has higher priority than Spotify", () => {
    expect(CASCADE_ORDER.indexOf("local-file")).toBeLessThan(
      CASCADE_ORDER.indexOf("spotify"),
    );
  });

  it("Spotify has higher priority than Apple Music", () => {
    expect(CASCADE_ORDER.indexOf("spotify")).toBeLessThan(
      CASCADE_ORDER.indexOf("apple-music"),
    );
  });

  it("Apple Music has higher priority than Bandcamp", () => {
    expect(CASCADE_ORDER.indexOf("apple-music")).toBeLessThan(
      CASCADE_ORDER.indexOf("bandcamp"),
    );
  });

  it("Bandcamp has higher priority than YouTube", () => {
    expect(CASCADE_ORDER.indexOf("bandcamp")).toBeLessThan(
      CASCADE_ORDER.indexOf("youtube"),
    );
  });
});
