import { describe, it, expect, beforeEach } from "vitest";
import { acquire, release, _testOnly_getCount, _testOnly_reset } from "../src/lore/sseConnectionTracker.js";

describe("sseConnectionTracker", () => {
  beforeEach(() => {
    _testOnly_reset();
  });

  it("allows connections up to the configured cap", () => {
    const ip = "10.0.0.1";
    // Open 10 connections — all should succeed
    for (let i = 0; i < 10; i++) {
      expect(acquire(ip)).toBe(true);
    }
    expect(_testOnly_getCount(ip)).toBe(10);
  });

  it("rejects the 11th connection from the same IP", () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 10; i++) {
      acquire(ip);
    }
    // 11th attempt must be rejected
    expect(acquire(ip)).toBe(false);
    // 12th attempt also rejected
    expect(acquire(ip)).toBe(false);
    // Count must not grow past the cap
    expect(_testOnly_getCount(ip)).toBe(10);
  });

  it("allows a new connection after one is released", () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 10; i++) {
      acquire(ip);
    }
    // At cap — reject
    expect(acquire(ip)).toBe(false);

    // Release one slot
    release(ip);
    expect(_testOnly_getCount(ip)).toBe(9);

    // Now one more should be accepted
    expect(acquire(ip)).toBe(true);
    expect(_testOnly_getCount(ip)).toBe(10);
  });

  it("does not affect other IPs", () => {
    const ipA = "10.0.0.4";
    const ipB = "10.0.0.5";
    for (let i = 0; i < 10; i++) {
      acquire(ipA);
    }
    // ipA is at cap; ipB should still be open
    expect(acquire(ipB)).toBe(true);
    expect(_testOnly_getCount(ipB)).toBe(1);
  });

  it("removes the key when count reaches zero", () => {
    const ip = "10.0.0.6";
    acquire(ip);
    release(ip);
    expect(_testOnly_getCount(ip)).toBe(0);
  });

  it("release is safe when no slot was held", () => {
    // Should not throw
    expect(() => release("10.0.0.99")).not.toThrow();
  });
});
