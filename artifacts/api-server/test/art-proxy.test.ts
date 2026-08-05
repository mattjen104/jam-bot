/**
 * Art proxy fallback tests — confirms the /art endpoint always falls back to
 * a 302 redirect to the original src when Object Storage is unreachable or
 * the origin fetch fails, so album covers never disappear from the UI.
 *
 * Covered scenarios:
 *   1. Cache miss + origin 404      → 302 to original src
 *   2. Cache miss + GCS write error → still serves the image bytes (write is
 *                                     fire-and-forget, failure is silent)
 *   3. Cache read failure (GCS down)→ falls through to origin fetch, serves
 *                                     image bytes (storage error doesn't 302)
 *   4. Cache hit                    → serves bytes with immutable headers
 *   5. Missing src param            → 400
 *   6. SSRF-blocked src             → 302 to original src (not an error page)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── module mocks — must come before any import that pulls artStorage/share ──

vi.mock("../src/lib/artStorage.js", () => ({
  artGet: vi.fn(),
  artPut: vi.fn(),
}));

vi.mock("../src/lore/share.js", () => ({
  isSafeArtworkUrl: vi.fn(),
}));

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Import after mocks are wired
import { artGet, artPut } from "../src/lib/artStorage.js";
import { isSafeArtworkUrl } from "../src/lore/share.js";
import artRouter from "../src/routes/art.js";

const artGetMock = vi.mocked(artGet);
const artPutMock = vi.mocked(artPut);
const isSafeMock = vi.mocked(isSafeArtworkUrl);

// Tiny express app that mounts the router the same way the real server does.
const app = express();
app.use(artRouter);

const SPOTIFY_URL =
  "https://i.scdn.co/image/ab67616d0000b273abc123";
const PROXY_PATH = `/art?src=${encodeURIComponent(SPOTIFY_URL)}`;

/** Build a minimal fetch Response stub for a successful image fetch. */
function makeFetchResponse(
  opts: { status?: number; contentType?: string; body?: Buffer } = {},
) {
  const { status = 200, contentType = "image/jpeg", body = Buffer.from("imgdata") } =
    opts;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (h: string) => {
        if (h === "content-type") return contentType;
        if (h === "location") return null;
        return null;
      },
    },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  artPutMock.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — cache miss + origin 404 → 302 redirect
// ─────────────────────────────────────────────────────────────────────────────
describe("cache miss + origin 404", () => {
  it("redirects to the original Spotify CDN URL so the browser still loads the image", async () => {
    artGetMock.mockResolvedValue(null); // cache miss
    isSafeMock.mockResolvedValue(true);
    // Origin returns 404
    fetchMock.mockResolvedValue(makeFetchResponse({ status: 404 }));

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SPOTIFY_URL);
  });

  it("redirects to the original src URL — no error page is served", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse({ status: 500 }));

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(302);
    // The Location header is the fallback target — the browser resolves it
    expect(res.headers.location).toBe(SPOTIFY_URL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — cache miss + GCS write failure → image bytes still served
// ─────────────────────────────────────────────────────────────────────────────
describe("cache miss + GCS write failure", () => {
  it("serves the fetched image even when artPut rejects", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse());
    // Simulate a storage write failure (artPut is best-effort and never throws
    // externally, but we verify the route survives even if it did)
    artPutMock.mockRejectedValue(new Error("GCS unavailable"));

    const res = await request(app).get(PROXY_PATH);

    // Image bytes are returned regardless of write failure
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(res.headers["x-art-proxy"]).toBe("miss");
  });

  it("sets immutable Cache-Control so the browser won't re-fetch", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse());
    artPutMock.mockRejectedValue(new Error("GCS unavailable"));

    const res = await request(app).get(PROXY_PATH);

    expect(res.headers["cache-control"]).toMatch(/immutable/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — cache read failure (GCS down) → falls through, serves image
// ─────────────────────────────────────────────────────────────────────────────
describe("cache read failure (GCS unreachable)", () => {
  it("falls through to origin fetch and serves the image bytes", async () => {
    // artGet throws as if GCS is completely down
    artGetMock.mockRejectedValue(new Error("GCS connection refused"));
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse());

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
  });

  it("redirects to original src when origin also fails after a storage error", async () => {
    artGetMock.mockRejectedValue(new Error("GCS connection refused"));
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse({ status: 503 }));

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SPOTIFY_URL);
  });

  it("redirects to original src when origin fetch itself throws (network error)", async () => {
    artGetMock.mockRejectedValue(new Error("GCS connection refused"));
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockRejectedValue(new Error("network error"));

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SPOTIFY_URL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — cache hit → bytes served, no origin fetch
// ─────────────────────────────────────────────────────────────────────────────
describe("cache hit", () => {
  it("serves cached bytes with immutable headers and x-art-proxy: hit", async () => {
    const cachedData = Buffer.from("cached-image-bytes");
    artGetMock.mockResolvedValue({
      data: cachedData,
      contentType: "image/jpeg",
    });

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(200);
    expect(res.headers["x-art-proxy"]).toBe("hit");
    expect(res.headers["cache-control"]).toMatch(/immutable/);
    expect(Buffer.from(res.body)).toEqual(cachedData);
    // Origin should never be called on a cache hit
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5 — missing src param
// ─────────────────────────────────────────────────────────────────────────────
describe("missing src param", () => {
  it("returns 400 when src is absent", async () => {
    const res = await request(app).get("/art");
    expect(res.status).toBe(400);
  });

  it("returns 400 when src is empty string", async () => {
    const res = await request(app).get("/art?src=");
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7 — exact Cache-Control and X-Art-Proxy header assertions
// ─────────────────────────────────────────────────────────────────────────────
describe("Cache-Control and X-Art-Proxy headers", () => {
  const EXACT_CACHE_CONTROL = "public, max-age=31536000, immutable";

  it("cache HIT: sets exact Cache-Control immutable string", async () => {
    artGetMock.mockResolvedValue({
      data: Buffer.from("cached-image-bytes"),
      contentType: "image/jpeg",
    });

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(EXACT_CACHE_CONTROL);
  });

  it("cache HIT: sets X-Art-Proxy: hit", async () => {
    artGetMock.mockResolvedValue({
      data: Buffer.from("cached-image-bytes"),
      contentType: "image/jpeg",
    });

    const res = await request(app).get(PROXY_PATH);

    expect(res.headers["x-art-proxy"]).toBe("hit");
  });

  it("cache MISS: sets exact Cache-Control immutable string", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse());

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(EXACT_CACHE_CONTROL);
  });

  it("cache MISS: sets X-Art-Proxy: miss", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse());

    const res = await request(app).get(PROXY_PATH);

    expect(res.headers["x-art-proxy"]).toBe("miss");
  });

  it("regression: weakening the IMMUTABLE constant is caught immediately", async () => {
    // Both hit and miss must carry the same unmodified constant
    artGetMock.mockResolvedValue({
      data: Buffer.from("img"),
      contentType: "image/png",
    });
    const hitRes = await request(app).get(PROXY_PATH);

    vi.clearAllMocks();
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse({ contentType: "image/png" }));
    artPutMock.mockResolvedValue(undefined);
    const missRes = await request(app).get(PROXY_PATH);

    expect(hitRes.headers["cache-control"]).toBe(EXACT_CACHE_CONTROL);
    expect(missRes.headers["cache-control"]).toBe(EXACT_CACHE_CONTROL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6 — SSRF-blocked URL → 302, not an error page
// ─────────────────────────────────────────────────────────────────────────────
describe("SSRF-blocked src", () => {
  it("redirects to the blocked src rather than returning an error body", async () => {
    artGetMock.mockResolvedValue(null);
    // isSafeArtworkUrl returns false for a private IP URL
    isSafeMock.mockResolvedValue(false);

    const privateUrl = "http://169.254.169.254/metadata";
    const path = `/art?src=${encodeURIComponent(privateUrl)}`;

    const res = await request(app).get(path);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(privateUrl);
    // The browser will just 404 on a private IP, which is safe
  });
});
