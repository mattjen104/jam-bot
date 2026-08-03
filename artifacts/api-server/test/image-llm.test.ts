import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import express from "express";
import { configureImageExtractor, resetImageExtractor, normalizeImageRows } from "../src/lore/image-llm.js";
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

// ---------------------------------------------------------------------------
// Endpoint-level tests: POST /me/library/extract-images
//
// Spins up a minimal Express server with the library router so the full
// request → decode → extractWithTimeout → normalizeImageRows → response
// pipeline is exercised, including error paths that only surface through the
// endpoint (provider timeout, malformed JSON from provider, mixed batches).
// ---------------------------------------------------------------------------

let serverUrl = "";
let endpointServer: ReturnType<typeof createServer> | null = null;

beforeAll(async () => {
  const { default: libraryRouter } = await import("../src/routes/me/library.js");
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use(libraryRouter);
  endpointServer = createServer(app);
  await new Promise<void>((resolve) => endpointServer!.listen(0, "127.0.0.1", resolve));
  const addr = endpointServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (endpointServer) {
    await new Promise<void>((resolve) => endpointServer!.close(() => resolve()));
  }
});

afterEach(() => {
  resetImageExtractor();
});

function postImages(images: unknown[]) {
  return fetch(`${serverUrl}/me/library/extract-images`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images }),
  });
}

describe("POST /me/library/extract-images — provider errors", () => {
  it("returns an error result when the extractor rejects (simulates provider timeout)", async () => {
    configureImageExtractor(() => Promise.reject(new Error("OCR provider timed out")));

    const res = await postImages([{ mediaType: "image/png", data: pngBase64() }]);

    expect(res.status).toBe(200);
    const body = await res.json() as { results: Record<string, unknown>[] };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ index: 0, status: "error", error: "OCR provider timed out" });
  });

  it("returns an error result when the extractor returns malformed JSON", async () => {
    configureImageExtractor(() => Promise.resolve("this is definitely not json {{{"));

    const res = await postImages([{ mediaType: "image/png", data: pngBase64() }]);

    expect(res.status).toBe(200);
    const body = await res.json() as { results: Record<string, unknown>[] };
    expect(body.results[0]).toMatchObject({
      index: 0,
      status: "error",
      error: expect.stringMatching(/malformed/i),
    });
  });

  it("returns an error result when the extractor returns a non-list (e.g. plain object)", async () => {
    configureImageExtractor(() => Promise.resolve('{"artist":"Oops","title":"Not a list"}'));

    const res = await postImages([{ mediaType: "image/png", data: pngBase64() }]);

    expect(res.status).toBe(200);
    const body = await res.json() as { results: Record<string, unknown>[] };
    expect(body.results[0]).toMatchObject({
      index: 0,
      status: "error",
      error: expect.stringMatching(/non-list/i),
    });
  });
});

describe("POST /me/library/extract-images — mixed batch", () => {
  it("returns both a success and an error result — no result is dropped", async () => {
    let call = 0;
    configureImageExtractor(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          JSON.stringify([{ artist: "Fleetwood Mac", title: "Dreams", confidence: 0.97 }]),
        );
      }
      return Promise.reject(new Error("OCR provider timed out"));
    });

    const res = await postImages([
      { mediaType: "image/png", data: pngBase64() },
      { mediaType: "image/png", data: pngBase64() },
    ]);

    expect(res.status).toBe(200);
    const body = await res.json() as { results: Record<string, unknown>[] };
    expect(body.results).toHaveLength(2);

    const okResult = body.results.find((r) => r["status"] === "ok");
    const errResult = body.results.find((r) => r["status"] === "error");

    expect(okResult).toMatchObject({ index: 0, status: "ok" });
    expect(Array.isArray((okResult as Record<string, unknown>)["tracks"])).toBe(true);
    expect(((okResult as Record<string, unknown>)["tracks"] as unknown[]).length).toBe(1);

    expect(errResult).toMatchObject({ index: 1, status: "error", error: "OCR provider timed out" });
  });

  it("treats a decode error for one image as an error result without aborting others", async () => {
    configureImageExtractor(() =>
      Promise.resolve(JSON.stringify([{ artist: "Boards of Canada", title: "Roygbiv", confidence: 0.9 }])),
    );

    // First image has an unsupported media type — decodeImage returns an error
    // before the extractor is ever called; the second image is valid.
    const res = await postImages([
      { mediaType: "image/svg+xml", data: pngBase64() },
      { mediaType: "image/png", data: pngBase64() },
    ]);

    expect(res.status).toBe(200);
    const body = await res.json() as { results: Record<string, unknown>[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toMatchObject({ index: 0, status: "error" });
    expect(body.results[1]).toMatchObject({ index: 1, status: "ok" });
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