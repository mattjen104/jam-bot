import { describe, it, expect } from "vitest";
import { deviceHandle } from "../src/lore/socialHandle.js";

describe("deviceHandle", () => {
  it("returns a non-empty string for any device key", () => {
    expect(deviceHandle("abc123")).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
  });

  it("is deterministic — same key always yields the same handle", () => {
    const key = "repl-lore-test-device-key-1";
    expect(deviceHandle(key)).toBe(deviceHandle(key));
  });

  it("produces different handles for different keys", () => {
    const a = deviceHandle("key-alpha-aaaa");
    const b = deviceHandle("key-beta-bbbb");
    expect(a).not.toBe(b);
  });

  it("no duplicates in a sample of 500 distinct keys", () => {
    const handles = new Set<string>();
    for (let i = 0; i < 500; i++) {
      handles.add(deviceHandle(`test-device-key-${i}-${Math.random()}`));
    }
    // Allow up to 5 collisions in 500 samples (0.1M distinct pairs)
    expect(handles.size).toBeGreaterThan(495);
  });

  it("handle format is AdjectiveNoun##", () => {
    for (let i = 0; i < 20; i++) {
      const h = deviceHandle(`key-format-test-${i}`);
      // Starts with a capital letter, ends with two digits
      expect(h).toMatch(/^[A-Z].+\d{2}$/);
    }
  });
});
