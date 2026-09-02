import { describe, expect, it } from "vitest";
import {
  classifyMetadataQuality,
  sourceCapabilityFor,
} from "../src/lore/metadata-quality.js";
import { classifyRuntimeHealth } from "../src/lore/source-coverage.js";

describe("metadata quality vocabulary", () => {
  it("separates empty, incomplete, junk, and usable metadata", () => {
    expect(classifyMetadataQuality(null, null).outcome).toBe("empty_metadata");
    expect(classifyMetadataQuality("Nina Simone", null).outcome).toBe(
      "incomplete_pair",
    );
    expect(
      classifyMetadataQuality("Commercial", "break").outcome,
    ).toBe("junk_metadata");
    expect(
      classifyMetadataQuality("Nina Simone", "Sinnerman").outcome,
    ).toBe("usable_pair");
  });

  it("keeps source capability separate from runtime outcomes", () => {
    expect(sourceCapabilityFor("kexp_api")).toBe("complete_history");
    expect(sourceCapabilityFor("station_page")).toBe("current_track_api");
    expect(sourceCapabilityFor("radio_browser_icy")).toBe(
      "interval_only_stream",
    );
    expect(sourceCapabilityFor("radio_browser_icy", "watcher")).toBe(
      "persistent_icy_watcher",
    );
    expect(sourceCapabilityFor("radio_browser_icy", "multiplex")).toBe(
      "multiplexed_metadata",
    );
    expect(sourceCapabilityFor(null)).toBe("unsupported");
  });

  it("gives every runtime state an explicit operator classification", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    expect(
      classifyRuntimeHealth({
        source: "station_page",
        hasStream: true,
        quality: {
          lastOutcome: "usable_pair",
          lastAttemptAt: now,
          lastUsableAt: now,
          lastDetail: null,
        },
        latestUsableAt: null,
        now,
      }).health,
    ).toBe("healthy");
    expect(
      classifyRuntimeHealth({
        source: "station_page",
        hasStream: true,
        quality: {
          lastOutcome: "empty_metadata",
          lastAttemptAt: now,
          lastUsableAt: null,
          lastDetail: "Empty response",
        },
        latestUsableAt: null,
        now,
      }).health,
    ).toBe("recoverable");
    expect(
      classifyRuntimeHealth({
        source: null,
        hasStream: false,
        quality: null,
        latestUsableAt: null,
        now,
      }).health,
    ).toBe("unsupported");
    expect(
      classifyRuntimeHealth({
        source: "station_page",
        hasStream: true,
        quality: {
          lastOutcome: "response_error",
          lastAttemptAt: now,
          lastUsableAt: null,
          lastDetail: "503",
        },
        latestUsableAt: null,
        now,
      }).health,
    ).toBe("failing");
  });
});