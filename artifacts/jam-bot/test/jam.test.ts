import { describe, it, expect } from "vitest";

// The test env (test/setup.ts) intentionally leaves SPOTIFY_TOKEN_RELAY_URL /
// SPOTIFY_TOKEN_RELAY_SECRET unset, so the internal-token fetch throws — which
// is exactly the "relay unreachable / unconfigured" case isJamActive must
// fail SAFE on.
describe("isJamActive", () => {
  it("fails quiet (returns false, never throws) when the relay is unconfigured", async () => {
    const { isJamActive } = await import("../src/spotify/jam.js");
    await expect(isJamActive()).resolves.toBe(false);
  });
});
