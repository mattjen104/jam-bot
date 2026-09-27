import { describe, expect, it, vi } from "vitest";

describe("reply model configuration", () => {
  it("defaults fresh installs to the evaluated model and preserves explicit overrides", async () => {
    const previous = process.env.OPENROUTER_MODEL;
    try {
      delete process.env.OPENROUTER_MODEL;
      vi.resetModules();
      const defaults = await import("../src/config.js");
      expect(defaults.DEFAULT_OPENROUTER_MODEL).toBe("anthropic/claude-sonnet-4");
      expect(defaults.config.OPENROUTER_MODEL).toBe(
        defaults.DEFAULT_OPENROUTER_MODEL,
      );

      process.env.OPENROUTER_MODEL = "openai/gpt-4.1-mini";
      vi.resetModules();
      const overridden = await import("../src/config.js");
      expect(overridden.config.OPENROUTER_MODEL).toBe("openai/gpt-4.1-mini");
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_MODEL;
      else process.env.OPENROUTER_MODEL = previous;
      vi.resetModules();
    }
  });
});