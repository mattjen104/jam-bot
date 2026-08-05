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
 *   4. Cache hit                    → serves bytes with stale-while-revalidate headers
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

  it("sets stale-while-revalidate Cache-Control so browsers re-check after a day", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue(makeFetchResponse());
    artPutMock.mockRejectedValue(new Error("GCS unavailable"));

    const res = await request(app).get(PROXY_PATH);

    expect(res.headers["cache-control"]).toMatch(/stale-while-revalidate/);
    expect(res.headers["cache-control"]).not.toMatch(/immutable/);
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
  it("serves cached bytes with stale-while-revalidate headers and x-art-proxy: hit", async () => {
    const cachedData = Buffer.from("cached-image-bytes");
    artGetMock.mockResolvedValue({
      data: cachedData,
      contentType: "image/jpeg",
    });

    const res = await request(app).get(PROXY_PATH);

    expect(res.status).toBe(200);
    expect(res.headers["x-art-proxy"]).toBe("hit");
    expect(res.headers["cache-control"]).toMatch(/stale-while-revalidate/);
    expect(res.headers["cache-control"]).not.toMatch(/immutable/);
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
  const EXACT_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

  it("cache HIT: sets exact Cache-Control stale-while-revalidate string", async () => {
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

  it("cache MISS: sets exact Cache-Control stale-while-revalidate string", async () => {
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

  it("regression: changing the CACHE_CONTROL constant is caught immediately", async () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7 — 3-hop redirect chain → image is served successfully
// ─────────────────────────────────────────────────────────────────────────────
describe("3-hop redirect chain", () => {
  it("follows up to 3 redirects and serves the image on the 4th fetch", async () => {
    artGetMock.mockResolvedValue(null); // cache miss
    isSafeMock.mockResolvedValue(true); // all hops are safe

    const url1 = "https://i.scdn.co/image/hop1";
    const url2 = "https://i.scdn.co/image/hop2";
    const url3 = "https://i.scdn.co/image/hop3";
    const url4 = "https://i.scdn.co/image/final";
    const imageBody = Buffer.from("real-image-data");

    // Three redirect responses, then a final 200 image
    fetchMock
      .mockResolvedValueOnce({
        status: 301,
        ok: false,
        headers: {
          get: (h: string) =>
            h === "location" ? url2 : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce({
        status: 301,
        ok: false,
        headers: {
          get: (h: string) =>
            h === "location" ? url3 : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce({
        status: 301,
        ok: false,
        headers: {
          get: (h: string) =>
            h === "location" ? url4 : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce(
        makeFetchResponse({ status: 200, body: imageBody }),
      );

    const path = `/art?src=${encodeURIComponent(url1)}`;
    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(res.headers["x-art-proxy"]).toBe("miss");
    // fetch was called 4 times: hop1→hop2→hop3→final
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("calls isSafeArtworkUrl on every hop URL, not just the first", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);

    const url1 = "https://i.scdn.co/image/hop1";
    const url2 = "https://i.scdn.co/image/hop2";
    const url3 = "https://i.scdn.co/image/hop3";
    const imageBody = Buffer.from("img");

    fetchMock
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: { get: (h: string) => (h === "location" ? url2 : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: { get: (h: string) => (h === "location" ? url3 : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce(makeFetchResponse({ status: 200, body: imageBody }));

    const path = `/art?src=${encodeURIComponent(url1)}`;
    await request(app).get(path);

    // isSafeArtworkUrl must be called for url1, url2, and url3 individually
    // (the outer guard in the route handler calls it for url1, then
    //  fetchFromOrigin calls it again for url1 on hop 0, url2 on hop 1, url3 on hop 2)
    const checkedUrls = isSafeMock.mock.calls.map((c) => c[0]);
    expect(checkedUrls).toContain(url1);
    expect(checkedUrls).toContain(url2);
    expect(checkedUrls).toContain(url3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8 — 5-hop redirect chain → 302 fallback fires, no error or hang
// ─────────────────────────────────────────────────────────────────────────────
describe("5-hop redirect chain (exceeds limit)", () => {
  it("returns 302 to the original src when the chain exceeds 4 hops", async () => {
    artGetMock.mockResolvedValue(null); // cache miss
    isSafeMock.mockResolvedValue(true); // all hops are safe

    const url1 = "https://i.scdn.co/image/chain1";

    // Return redirects indefinitely — only 4 will ever be consumed
    fetchMock.mockImplementation((_url: string, _opts?: unknown) => {
      const calledUrl = _url as string;
      const nextIdx = fetchMock.mock.calls.length; // 1-based after this call
      const nextUrl = `https://i.scdn.co/image/chain${nextIdx + 1}`;
      return Promise.resolve({
        status: 301,
        ok: false,
        headers: {
          get: (h: string) => (h === "location" ? nextUrl : null),
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      });
    });

    const path = `/art?src=${encodeURIComponent(url1)}`;
    const res = await request(app).get(path);

    // The hop limit exhausts before reaching a 200 — must fall back gracefully
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(url1); // fallback is always the original src
    // Exactly 4 fetch calls were made (hop 0..3), then the loop gave up
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not throw or hang when the chain is longer than the hop limit", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);

    // Simulate an infinite redirect loop — proxy must not hang
    let hopCount = 0;
    fetchMock.mockImplementation(() => {
      hopCount++;
      return Promise.resolve({
        status: 302,
        ok: false,
        headers: {
          get: (h: string) =>
            h === "location"
              ? `https://i.scdn.co/image/loop${hopCount + 1}`
              : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      });
    });

    const path = `/art?src=${encodeURIComponent(SPOTIFY_URL)}`;
    // Should resolve promptly without hanging
    const res = await request(app).get(path);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SPOTIFY_URL);
    // Hard cap: fetch called no more than 4 times
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9 — SSRF guard fires on an intermediate redirect hop
// ─────────────────────────────────────────────────────────────────────────────
describe("SSRF guard on intermediate redirect hops", () => {
  it("returns 302 when the 2nd URL in the chain fails the SSRF guard", async () => {
    artGetMock.mockResolvedValue(null);

    const safeUrl = "https://i.scdn.co/image/safe-start";
    const unsafeUrl = "http://169.254.169.254/metadata"; // private IP — SSRF target

    // First call (outer route guard + fetchFromOrigin hop 0) is safe;
    // second call (fetchFromOrigin hop 1, checking the redirect target) is unsafe
    isSafeMock
      .mockResolvedValueOnce(true) // outer route guard for safeUrl
      .mockResolvedValueOnce(true) // fetchFromOrigin hop 0: safeUrl
      .mockResolvedValueOnce(false); // fetchFromOrigin hop 1: unsafeUrl blocked

    fetchMock.mockResolvedValueOnce({
      status: 301,
      ok: false,
      headers: {
        get: (h: string) => (h === "location" ? unsafeUrl : null),
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const path = `/art?src=${encodeURIComponent(safeUrl)}`;
    const res = await request(app).get(path);

    // The SSRF block on the intermediate hop must trigger a 302 fallback
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(safeUrl);
    // The unsafe URL was never fetched
    const fetchedUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(fetchedUrls).not.toContain(unsafeUrl);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10 — redirect chain ending in text/html → 302, artPut never called
// ─────────────────────────────────────────────────────────────────────────────
describe("redirect chain ending in non-image content-type", () => {
  it("returns 302 when the final URL returns text/html (e.g. an expired Spotify link page)", async () => {
    artGetMock.mockResolvedValue(null); // cache miss
    isSafeMock.mockResolvedValue(true); // all hops pass the SSRF guard

    const initialUrl = "https://i.scdn.co/image/expired-link";
    const finalUrl = "https://accounts.spotify.com/link-expired";

    // One redirect to the final URL, which returns text/html
    fetchMock
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: {
          get: (h: string) => (h === "location" ? finalUrl : null),
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce(
        makeFetchResponse({ status: 200, contentType: "text/html; charset=utf-8" }),
      );

    const path = `/art?src=${encodeURIComponent(initialUrl)}`;
    const res = await request(app).get(path);

    // Non-image content-type must be rejected — fall back to 302, not 200
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(initialUrl);
    // artPut must never be called — corrupt content must not enter the cache
    expect(artPutMock).not.toHaveBeenCalled();
  });

  it("returns 302 and skips artPut when the redirect target returns text/plain", async () => {
    artGetMock.mockResolvedValue(null);
    isSafeMock.mockResolvedValue(true);

    const initialUrl = "https://i.scdn.co/image/some-cover";
    const finalUrl = "https://cdn.example.com/error.txt";

    fetchMock
      .mockResolvedValueOnce({
        status: 301,
        ok: false,
        headers: {
          get: (h: string) => (h === "location" ? finalUrl : null),
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce(
        makeFetchResponse({ status: 200, contentType: "text/plain" }),
      );

    const path = `/art?src=${encodeURIComponent(initialUrl)}`;
    const res = await request(app).get(path);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(initialUrl);
    expect(artPutMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 11 — body size guard (>8 MB or 0 bytes) → 302 fallback
// ─────────────────────────────────────────────────────────────────────────────
describe("body size guard", () => {
  it("returns 302 when the origin response body exceeds 8 MB", async () => {
    artGetMock.mockResolvedValue(null); // cache miss
    isSafeMock.mockResolvedValue(true);

    // Build a buffer that is exactly 1 byte over the 8 MB limit
    const oversizedBody = Buffer.alloc(8_000_001, 0x42);
    fetchMock.mockResolvedValue(makeFetchResponse({ body: oversizedBody }));

    const res = await request(app).get(PROXY_PATH);

    // fetchFromOrigin returns null for oversized buffers; route must 302
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SPOTIFY_URL);
    // Nothing should be written to the cache
    expect(artPutMock).not.toHaveBeenCalled();
  });

  it("returns 302 when the origin response body is empty (0 bytes)", async () => {
    artGetMock.mockResolvedValue(null); // cache miss
    isSafeMock.mockResolvedValue(true);

    fetchMock.mockResolvedValue(makeFetchResponse({ body: Buffer.alloc(0) }));

    const res = await request(app).get(PROXY_PATH);

    // Empty body is treated the same as a fetch failure
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SPOTIFY_URL);
    expect(artPutMock).not.toHaveBeenCalled();
  });
});
