import { describe, it, expect, vi, afterEach } from "vitest";

// Real classifyIntent (no mock). The deterministic fast path must resolve
// these without ever hitting the network — we stub fetch to throw so any
// LLM call would fail the test loudly.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyIntent deterministic fast path", () => {
  it("routes a plain tour request to intent=tour without calling the LLM", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must not be hit on the fast path"));
    const { classifyIntent } = await import("../src/llm/openrouter.js");

    const res = await classifyIntent("give us a tour of Motown");
    expect(res.intent).toBe("tour");
    expect(res.query).toBe("Motown");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes a counted tour request (a 5-track tour of dub) on the fast path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must not be hit on the fast path"));
    const { classifyIntent } = await import("../src/llm/openrouter.js");

    const res = await classifyIntent("give us a 5-track tour of dub");
    expect(res.intent).toBe("tour");
    expect(res.query).toBe("dub");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes 'walk us through X' to intent=tour on the fast path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must not be hit on the fast path"));
    const { classifyIntent } = await import("../src/llm/openrouter.js");

    const res = await classifyIntent("walk us through Bowie's Berlin era");
    expect(res.intent).toBe("tour");
    expect(res.query).toBe("Bowie's Berlin era");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
