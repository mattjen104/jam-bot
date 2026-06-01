import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signAcrRequest, parseAcrResponse } from "../src/turntable/acrcloud.js";

describe("ACRCloud request signing", () => {
  it("signs the canonical string with HMAC-SHA1 + base64", () => {
    const { signature, stringToSign } = signAcrRequest({
      accessKey: "AK",
      accessSecret: "SECRET",
      timestamp: 1700000000,
    });
    expect(stringToSign).toBe(
      ["POST", "/v1/identify", "AK", "audio", "1", "1700000000"].join("\n"),
    );
    // Independently recompute the expected signature.
    const expected = createHmac("sha1", "SECRET")
      .update(Buffer.from(stringToSign, "utf-8"))
      .digest("base64");
    expect(signature).toBe(expected);
  });

  it("is deterministic for the same inputs and changes with the timestamp", () => {
    const a = signAcrRequest({
      accessKey: "AK",
      accessSecret: "S",
      timestamp: 1,
    });
    const b = signAcrRequest({
      accessKey: "AK",
      accessSecret: "S",
      timestamp: 1,
    });
    const c = signAcrRequest({
      accessKey: "AK",
      accessSecret: "S",
      timestamp: 2,
    });
    expect(a.signature).toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });
});

describe("ACRCloud response parsing", () => {
  it("parses a successful match into our shape", () => {
    const match = parseAcrResponse({
      status: { code: 0, msg: "Success" },
      metadata: {
        music: [
          {
            acrid: "abc123",
            title: "Midnight City",
            artists: [{ name: "M83" }],
            album: { name: "Hurry Up, We're Dreaming" },
            external_ids: { isrc: "GBUM71200001" },
            play_offset_ms: 42000,
            score: 96,
          },
        ],
      },
    });
    expect(match).toEqual({
      acrid: "abc123",
      title: "Midnight City",
      artist: "M83",
      album: "Hurry Up, We're Dreaming",
      isrc: "GBUM71200001",
      playOffsetMs: 42000,
      score: 96,
    });
  });

  it("joins multiple artists and tolerates a missing ISRC/offset", () => {
    const match = parseAcrResponse({
      status: { code: 0 },
      metadata: {
        music: [
          {
            acrid: "x",
            title: "Song",
            artists: [{ name: "A" }, { name: "B" }],
          },
        ],
      },
    });
    expect(match?.artist).toBe("A, B");
    expect(match?.isrc).toBeUndefined();
    expect(match?.playOffsetMs).toBe(0);
  });

  it("returns null on the explicit no-result code 1001", () => {
    expect(
      parseAcrResponse({ status: { code: 1001, msg: "No result" } }),
    ).toBeNull();
  });

  it("returns null when success but metadata is empty", () => {
    expect(
      parseAcrResponse({ status: { code: 0 }, metadata: { music: [] } }),
    ).toBeNull();
  });

  it("throws on other (error) status codes", () => {
    expect(() =>
      parseAcrResponse({ status: { code: 3001, msg: "Invalid signature" } }),
    ).toThrow(/3001/);
  });
});
