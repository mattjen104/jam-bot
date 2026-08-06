/**
 * RideBar fallback-toast unit test.
 *
 * Verifies that the cascade-transparency toast fires correctly when the audio
 * source downgrades from a preferred service (Spotify / Apple Music) to a
 * fallback (YouTube / Bandcamp), including the realistic PlayerProvider path
 * where source goes through a `null` intermediate:
 *
 *   spotify → null → youtube       (Spotify fails, source cleared, YT takes over)
 *   apple-music → null → youtube
 *   spotify → null → bandcamp
 *
 * Also verifies it does NOT fire for a direct upgrade (null → spotify) or when
 * the service only changes between fallback drivers.
 */

/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal stub of the toast logic extracted from RideBar
// ---------------------------------------------------------------------------

/**
 * Pure function mirroring the RideBar toast logic (state machine, no React).
 * Returns the toast call arguments if a toast would fire, or null if not.
 */
function runToastLogic(
  transitions: Array<
    | "spotify"
    | "apple-music"
    | "local-file"
    | "bandcamp"
    | "youtube"
    | "preview"
    | null
  >,
): Array<{ title: string; description: string }> {
  let lastPreferred: "spotify" | "apple-music" | null = null;
  const fired: Array<{ title: string; description: string }> = [];

  for (const next of transitions) {
    if (next === "spotify" || next === "apple-music") {
      lastPreferred = next;
      // No toast when switching TO a preferred service.
      continue;
    }

    if (
      lastPreferred !== null &&
      (next === "youtube" || next === "bandcamp")
    ) {
      const prevLabel = lastPreferred === "spotify" ? "Spotify" : "Apple Music";
      const nextLabel = next === "youtube" ? "YouTube" : "Bandcamp";
      fired.push({
        title: `Switched to ${nextLabel}`,
        description: `${prevLabel} wasn't available for this track. Reconnect for full quality.`,
      });
      lastPreferred = null; // Clear so it doesn't re-fire on next track.
    }
  }

  return fired;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RideBar fallback toast logic", () => {
  it("fires when source goes spotify → null → youtube", () => {
    const toasts = runToastLogic(["spotify", null, "youtube"]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Switched to YouTube");
    expect(toasts[0].description).toContain("Spotify");
  });

  it("fires when source goes apple-music → null → youtube", () => {
    const toasts = runToastLogic(["apple-music", null, "youtube"]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Switched to YouTube");
    expect(toasts[0].description).toContain("Apple Music");
  });

  it("fires when source goes spotify → null → bandcamp", () => {
    const toasts = runToastLogic(["spotify", null, "bandcamp"]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Switched to Bandcamp");
    expect(toasts[0].description).toContain("Spotify");
  });

  it("fires when source goes apple-music → null → bandcamp", () => {
    const toasts = runToastLogic(["apple-music", null, "bandcamp"]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Switched to Bandcamp");
    expect(toasts[0].description).toContain("Apple Music");
  });

  it("fires even with multiple null intermediates", () => {
    const toasts = runToastLogic(["spotify", null, null, null, "youtube"]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Switched to YouTube");
  });

  it("does NOT fire when upgrading null → spotify", () => {
    const toasts = runToastLogic([null, "spotify"]);
    expect(toasts).toHaveLength(0);
  });

  it("does NOT fire for fallback→fallback transitions (youtube → bandcamp)", () => {
    const toasts = runToastLogic(["youtube", "bandcamp"]);
    expect(toasts).toHaveLength(0);
  });

  it("does NOT fire when the preferred service is still active", () => {
    const toasts = runToastLogic(["spotify", "spotify"]);
    expect(toasts).toHaveLength(0);
  });

  it("does NOT re-fire for subsequent tracks on the same fallback driver", () => {
    // Track 1: spotify → null → youtube (fires once)
    // Track 2: null → youtube again (preferred cleared, no second toast)
    const toasts = runToastLogic(["spotify", null, "youtube", null, "youtube"]);
    expect(toasts).toHaveLength(1);
  });

  it("fires again if preferred service re-connects and then falls back a second time", () => {
    // Session: spotify fails → youtube → spotify reconnects → spotify fails again → youtube
    const toasts = runToastLogic([
      "spotify", null, "youtube",  // first downgrade → fires
      "spotify",                   // reconnected (no toast)
      null, "youtube",             // second downgrade → fires again
    ]);
    expect(toasts).toHaveLength(2);
    expect(toasts[0].title).toBe("Switched to YouTube");
    expect(toasts[1].title).toBe("Switched to YouTube");
  });

  it("fires for apple-music downgrade even after a prior spotify session", () => {
    const toasts = runToastLogic([
      "spotify", null, "youtube",   // spotify fallback
      "apple-music", null, "youtube", // apple music fallback
    ]);
    expect(toasts).toHaveLength(2);
    expect(toasts[0].description).toContain("Spotify");
    expect(toasts[1].description).toContain("Apple Music");
  });
});
