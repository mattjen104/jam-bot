import { describe, expect, it } from "vitest";
import { normalizeImageRows } from "../src/lore/image-llm.js";
import { decodeImage } from "../src/routes/me/library.js";

function pngBase64(width = 2, height = 3): string {
  const bytes = Buffer.alloc(24);
  bytes[0] = 0x89;
  bytes.write("PNG", 1, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

describe("normalizeImageRows", () => {
  it("keeps clear tracks, strips fences, and removes duplicate rows", () => {
    const rows = normalizeImageRows(`\`\`\`json
      [
        {"artist":"Fleetwood Mac","title":"Go Your Own Way","confidence":0.98},
        {"artist":"fleetwood mac","title":"go your own way","confidence":0.95},
        {"artist":"The Beatles","title":"Hey Jude","confidence":"0.91"}
      ]
    \`\`\``);
    expect(rows).toEqual([
      { artist: "Fleetwood Mac", title: "Go Your Own Way", confidence: 0.98 },
      { artist: "The Beatles", title: "Hey Jude", confidence: 0.91 },
    ]);
  });

  it("filters low-confidence rows, UI labels, malformed rows, and empty text", () => {
    const rows = normalizeImageRows(JSON.stringify([
      { artist: "Artist", title: "Title", confidence: 1 },
      { artist: "A", title: "Song", confidence: 0.99 },
      { artist: "Artist", title: "Maybe Song", confidence: 0.64 },
      { artist: "Real Artist", title: "", confidence: 1 },
      "not a row",
    ]));
    expect(rows).toEqual([]);
  });

  it("distinguishes a valid unreadable screenshot from malformed provider output", () => {
    expect(normalizeImageRows("[]")).toEqual([]);
    expect(() => normalizeImageRows("not json")).toThrow(/malformed JSON/i);
    expect(() => normalizeImageRows("{}")).toThrow(/non-list/i);
  });

  it("rejects confidence values outside the provider contract", () => {
    expect(normalizeImageRows(JSON.stringify([
      { artist: "Artist", title: "Song", confidence: -1 },
      { artist: "Artist", title: "Song 2", confidence: 1.1 },
      { artist: "Artist", title: "Song 3", confidence: null },
    ]))).toEqual([]);
  });
});

describe("decodeImage", () => {
  it("accepts bounded PNG data and reads dimensions", () => {
    const result = decodeImage({ mediaType: "image/png", data: pngBase64() });
    expect(result).toMatchObject({ mediaType: "image/png", bytes: 24 });
    expect("error" in result).toBe(false);
  });

  it("rejects unsupported types, invalid base64, oversized data, and unreadable dimensions", () => {
    expect(decodeImage({ mediaType: "image/svg+xml", data: pngBase64() })).toMatchObject({ error: expect.stringMatching(/unsupported/i) });
    expect(decodeImage({ mediaType: "image/png", data: "not base64!" })).toMatchObject({ error: expect.stringMatching(/base64/i) });
    expect(decodeImage({ mediaType: "image/png", data: Buffer.alloc(24).toString("base64") })).toMatchObject({ error: expect.stringMatching(/dimensions/i) });
    expect(decodeImage({ mediaType: "image/png", data: Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64") })).toMatchObject({ error: expect.stringMatching(/large/i) });
  });
});