import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  getAppleMusicDeveloperToken,
  _resetTokenCacheForTesting,
} from "../src/lore/appleMusic.js";

// ---------------------------------------------------------------------------
// Generate a real P-256 key pair once for the whole suite.  The private key
// is never sent anywhere — it is only used to sign JWTs locally so the
// module's crypto path executes without stubs.
// ---------------------------------------------------------------------------
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Keep a snapshot of the real env so we can restore it after each test.
const ORIGINAL_ENV = process.env;

function setAppleMusicEnv() {
  process.env = {
    ...ORIGINAL_ENV,
    APPLE_MUSIC_TEAM_ID: "TESTTEAM1",
    APPLE_MUSIC_KEY_ID: "TESTKEYID1",
    // PEM key contains real newlines — the module's replace(/\\n/g,"\n") is a
    // no-op here, which is correct; we're testing with the already-formatted key.
    APPLE_MUSIC_PRIVATE_KEY: TEST_PRIVATE_KEY,
  };
}

beforeEach(() => {
  setAppleMusicEnv();
  _resetTokenCacheForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.useRealTimers();
  _resetTokenCacheForTesting();
});

describe("getAppleMusicDeveloperToken — cache refresh boundary", () => {
  it("returns null when Apple Music credentials are absent", () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APPLE_MUSIC_TEAM_ID;
    expect(getAppleMusicDeveloperToken()).toBeNull();
  });

  it("returns a JWT string when credentials are present", () => {
    const token = getAppleMusicDeveloperToken();
    expect(token).not.toBeNull();
    // A JWT has exactly three base64url segments separated by dots.
    expect(token!.split(".")).toHaveLength(3);
  });

  it("returns the cached token on consecutive calls within the TTL", () => {
    const first = getAppleMusicDeveloperToken();
    // Advance 4 minutes — well within the 60-min TTL and outside the 6-min refresh margin.
    vi.setSystemTime(Date.now() + 4 * 60 * 1000);
    const second = getAppleMusicDeveloperToken();
    expect(second).toBe(first);
  });

  it("still serves the cached token when more than 6 minutes of TTL remain", () => {
    const first = getAppleMusicDeveloperToken();
    // Advance 50 minutes — token expires at 60 min, so 10 min remain (> 6-min margin).
    vi.setSystemTime(Date.now() + 50 * 60 * 1000);
    const second = getAppleMusicDeveloperToken();
    expect(second).toBe(first);
  });

  it("mints a fresh token once the cache enters the 6-minute refresh window", () => {
    const first = getAppleMusicDeveloperToken();
    // Advance to 54 min 1 s — only 5 min 59 s remain, inside the 6-min margin.
    vi.setSystemTime(Date.now() + (54 * 60 + 1) * 1000);
    const second = getAppleMusicDeveloperToken();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("mints a fresh token after the previous one fully expires", () => {
    const first = getAppleMusicDeveloperToken();
    // Jump past the 60-min TTL entirely.
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    const second = getAppleMusicDeveloperToken();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("the refreshed token encodes an expiry 60 minutes from the new mint time", () => {
    // Advance into the refresh window so a new token is minted.
    vi.setSystemTime(Date.now() + (54 * 60 + 1) * 1000);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = getAppleMusicDeveloperToken()!;
    const payloadJson = Buffer.from(token.split(".")[1]!, "base64url").toString();
    const payload = JSON.parse(payloadJson) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(60 * 60);
    // The iat should be within a second of the faked "now".
    expect(Math.abs(payload.iat - nowSeconds)).toBeLessThanOrEqual(1);
  });
});
