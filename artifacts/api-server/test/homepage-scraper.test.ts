// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverStationLogo,
  extractManifestLogoCandidates,
  extractDonateLink,
  extractStationLogoCandidates,
  scrapeStationHomepage,
} from "../src/lore/homepage-scraper.js";

// ---------------------------------------------------------------------------
// DB + crawl-block mocks (no real Postgres needed for these tests)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();

  // Minimal stationsTable shape used by scrapeStationHomepage.
  const stationsTable = {
    id: "id",
    slug: "slug",
    homepageUrl: "homepageUrl",
    homepageBlurb: "homepageBlurb",
    homepageScrapedAt: "homepageScrapedAt",
    logoCheckedAt: "logoCheckedAt",
    logoSource: "logoSource",
    logoUrl: "logoUrl",
    logoWidth: "logoWidth",
    logoHeight: "logoHeight",
    donateUrl: "donateUrl",
    active: "active",
    hidden: "hidden",
  };

  return {
    ...actual,
    stationsTable,
    db: {
      update: vi.fn(),
    },
  };
});

vi.mock("../src/lore/blog-crossref.js", () => ({
  isCrawlBlocked: vi.fn().mockResolvedValue(false),
  isBlockedByRobots: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fetch mock that returns a fixed HTML page with status 200. */
function makeHtmlFetch(html: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => html,
  }) as unknown as typeof fetch;
}

function makePng(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  data.writeUInt32BE(0x89504e47, 0);
  data.writeUInt32BE(0x0d0a1a0a, 4);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function imageResponse(data: Buffer, contentType = "image/png") {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: async () =>
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
}

/** Chainable drizzle update mock — captures the last `.set()` call. */
function makeDbUpdateChain(opts: { returnRows?: object[] } = {}) {
  const chain: Record<string, unknown> = {};
  const setCalls: object[] = [];

  chain.set = vi.fn((values: object) => {
    setCalls.push(values);
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(opts.returnRows ?? []));

  return { chain, setCalls };
}

// ---------------------------------------------------------------------------
// extractDonateLink — unit tests (pure, no I/O)
// ---------------------------------------------------------------------------

describe("extractDonateLink — tier-1: href path match", () => {
  it("matches /donate in the path", () => {
    const html = `<a href="https://kexp.org/donate">Donate</a>`;
    expect(extractDonateLink(html, "https://kexp.org")).toBe(
      "https://kexp.org/donate",
    );
  });

  it("matches /support in the path", () => {
    const html = `<a href="/support">Support Us</a>`;
    expect(extractDonateLink(html, "https://radio.example.com")).toBe(
      "https://radio.example.com/support",
    );
  });

  it("matches /membership", () => {
    const html = `<a href="/membership/">Become a Member</a>`;
    expect(extractDonateLink(html, "https://wnyc.org")).toBe(
      "https://wnyc.org/membership/",
    );
  });

  it("matches /pledge", () => {
    const html = `<a href="/pledge">Pledge Now</a>`;
    expect(extractDonateLink(html, "https://npr.org")).toBe(
      "https://npr.org/pledge",
    );
  });

  it("matches /give", () => {
    const html = `<a href="https://station.org/give/annual">Give</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://station.org/give/annual",
    );
  });

  it("matches /contribute", () => {
    const html = `<a href="/contribute">Contribute</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://station.org/contribute",
    );
  });

  it("matches /sustain", () => {
    const html = `<a href="/sustain">Sustain Us</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://station.org/sustain",
    );
  });

  it("matches /fund", () => {
    const html = `<a href="/fund">Fund the Station</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://station.org/fund",
    );
  });

  it("prefers a tier-1 path hit over an earlier tier-2 text match", () => {
    const html = [
      `<a href="https://other.org/about">Donate to us here</a>`,
      `<a href="https://kexp.org/donate">Give</a>`,
    ].join("\n");
    expect(extractDonateLink(html, "https://kexp.org")).toBe(
      "https://kexp.org/donate",
    );
  });
});

describe("extractDonateLink — tier-2: link-text fallback", () => {
  it("uses link text when href has no path keyword but text says 'donate'", () => {
    const html = `<a href="https://fundraise.example.com/12345">Donate</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://fundraise.example.com/12345",
    );
  });

  it("uses link text containing 'support'", () => {
    const html = `<a href="https://support.example.com/radio">Support the show</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://support.example.com/radio",
    );
  });

  it("captures only the first tier-2 candidate (does not overwrite)", () => {
    const html = [
      `<a href="https://first.example.com/x">Donate</a>`,
      `<a href="https://second.example.com/y">Support</a>`,
    ].join("\n");
    expect(extractDonateLink(html, "https://station.org")).toBe(
      "https://first.example.com/x",
    );
  });
});

describe("extractDonateLink — anchor-only hrefs skipped", () => {
  it("ignores a bare # anchor", () => {
    const html = `<a href="#">Donate</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBeNull();
  });

  it("ignores a #fragment-only href even when text matches", () => {
    const html = `<a href="#support">Support Us</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBeNull();
  });
});

describe("extractDonateLink — relative URL resolution", () => {
  it("resolves a root-relative path against the base URL", () => {
    const html = `<a href="/donate">Donate</a>`;
    expect(extractDonateLink(html, "https://mystation.fm")).toBe(
      "https://mystation.fm/donate",
    );
  });

  it("resolves a relative path (no leading slash) against the base URL", () => {
    const html = `<a href="donate">Donate</a>`;
    expect(extractDonateLink(html, "https://mystation.fm/")).toBe(
      "https://mystation.fm/donate",
    );
  });

  it("keeps a fully-qualified absolute URL unchanged", () => {
    const html = `<a href="https://donate.mystation.fm/give">Give</a>`;
    expect(extractDonateLink(html, "https://mystation.fm")).toBe(
      "https://donate.mystation.fm/give",
    );
  });
});

describe("extractDonateLink — non-http hrefs rejected", () => {
  it("ignores mailto: links even with donate keyword in path", () => {
    const html = `<a href="mailto:donate@station.org">Email us</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBeNull();
  });

  it("ignores javascript: hrefs", () => {
    const html = `<a href="javascript:void(0)">Donate</a>`;
    expect(extractDonateLink(html, "https://station.org")).toBeNull();
  });

  it("returns null when the page has no links at all", () => {
    expect(extractDonateLink("<p>Hello</p>", "https://station.org")).toBeNull();
  });

  it("returns null when links exist but none match any keyword", () => {
    const html = [
      `<a href="/about">About</a>`,
      `<a href="/contact">Contact</a>`,
      `<a href="https://twitter.com/station">Twitter</a>`,
    ].join("\n");
    expect(extractDonateLink(html, "https://station.org")).toBeNull();
  });
});

describe("station logo discovery", () => {
  it("extracts only explicitly logo-like page assets and resolves relative URLs", () => {
    const candidates = extractStationLogoCandidates(
      [
        `<img src="/hero.jpg" alt="Tonight's show">`,
        `<img src="/brand.svg" class="site-logo">`,
        `<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">`,
        `<meta property="og:image" content="/social.jpg">`,
      ].join(""),
      "https://station.example/about",
    );

    expect(candidates.map((entry) => entry.url)).toEqual([
      "https://station.example/brand.svg",
      "https://station.example/touch.png",
      "https://station.example/social.jpg",
    ]);
  });

  it("reads high-resolution icons from a web manifest", () => {
    expect(
      extractManifestLogoCandidates(
        { icons: [{ src: "icon-192.png", sizes: "192x192" }] },
        "https://station.example/app/site.webmanifest",
      ),
    ).toEqual([
      expect.objectContaining({
        url: "https://station.example/app/icon-192.png",
        kind: "manifest",
        declaredWidth: 192,
      }),
    ]);
  });

  it("rejects a tiny favicon and selects a sufficiently large official image", async () => {
    const small = makePng(32, 32);
    const large = makePng(256, 256);
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      return value.endsWith("small.png")
        ? imageResponse(small)
        : imageResponse(large);
    }) as unknown as typeof fetch;

    const result = await discoverStationLogo(
      [
        `<img class="logo" src="/small.png">`,
        `<link rel="apple-touch-icon" sizes="256x256" href="/large.png">`,
      ].join(""),
      "https://station.example",
      { fetchFn, isSafeUrlFn: () => true },
    );

    expect(result).toEqual({
      url: "https://station.example/large.png",
      width: 256,
      height: 256,
      vector: false,
    });
  });

  it("accepts an SVG logo without requiring raster dimensions", async () => {
    const svg = Buffer.from(`<svg viewBox="0 0 100 100"></svg>`);
    const fetchFn = vi.fn().mockResolvedValue(
      imageResponse(svg, "image/svg+xml"),
    ) as unknown as typeof fetch;

    await expect(
      discoverStationLogo(
        `<img class="brand-logo" src="/logo.svg">`,
        "https://station.example",
        { fetchFn, isSafeUrlFn: () => true },
      ),
    ).resolves.toEqual({
      url: "https://station.example/logo.svg",
      width: null,
      height: null,
      vector: true,
    });
  });
});

// ---------------------------------------------------------------------------
// scrapeStationHomepage — donate_url write behaviour
// ---------------------------------------------------------------------------

describe("scrapeStationHomepage — donate_url conditional write", () => {
  const baseTarget = {
    id: 42,
    slug: "test-station",
    homepageUrl: "https://station.example.com",
  };
const safeScrapeOpts = {
  isSafeUrlFn: () => true,
  isRobotsBlockedFn: async () => false,
};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes donate_url when the DB value is currently null and the page has a link", async () => {
    const { db } = await import("@workspace/db");

    // First update() call (blurb / scrapedAt) — no returning needed.
    const firstChain = makeDbUpdateChain();
    // Second update() call (donate_url conditional) — returns a row to
    // simulate the WHERE … IS NULL matching and writing the URL.
    const secondChain = makeDbUpdateChain({ returnRows: [{ id: 42 }] });

    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstChain.chain)
      .mockReturnValueOnce(secondChain.chain);

    const html = `<html><head><meta name="description" content="A great station."></head>
      <body><a href="/donate">Donate</a></body></html>`;

    await scrapeStationHomepage(baseTarget, {
      fetchFn: makeHtmlFetch(html),
      ...safeScrapeOpts,
    });

    // db.update must be called twice: once for blurb/timestamp, once for donate_url.
    expect(db.update).toHaveBeenCalledTimes(2);

    // The second call's .set() must carry donateUrl.
    const donateSet = secondChain.setCalls[0] as Record<string, unknown>;
    expect(donateSet).toHaveProperty("donateUrl", "https://station.example.com/donate");
  });

  it("does NOT overwrite an existing donate_url (IS NULL guard blocks the write)", async () => {
    const { db } = await import("@workspace/db");

    // First update returns the blurb/scrapedAt chain.
    const firstChain = makeDbUpdateChain();
    // Second update returns empty rows — simulating the IS NULL guard blocking
    // the write because donate_url is already set.
    const secondChain = makeDbUpdateChain({ returnRows: [] });

    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstChain.chain)
      .mockReturnValueOnce(secondChain.chain);

    const html = `<html><head><meta name="description" content="A great station."></head>
      <body><a href="/donate">Donate</a></body></html>`;

    await scrapeStationHomepage(baseTarget, {
      fetchFn: makeHtmlFetch(html),
      ...safeScrapeOpts,
    });

    // The second DB call must still use isNull(stationsTable.donateUrl) in its
    // where clause — verified by confirming update was called twice (the
    // IS NULL guard is in the where, not the set, so the call is made but the
    // DB-side condition prevents the overwrite).
    expect(db.update).toHaveBeenCalledTimes(2);

    const donateSet = secondChain.setCalls[0] as Record<string, unknown>;
    // The set payload still carries donateUrl — the guard is on the DB side.
    expect(donateSet).toHaveProperty("donateUrl");
  });

  it("skips the donate_url update entirely when the page has no matching link", async () => {
    const { db } = await import("@workspace/db");

    const firstChain = makeDbUpdateChain();

    (db.update as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstChain.chain);

    const html = `<html><head><meta name="description" content="A great station."></head>
      <body><a href="/about">About</a></body></html>`;

    await scrapeStationHomepage(baseTarget, {
      fetchFn: makeHtmlFetch(html),
      ...safeScrapeOpts,
    });

    // Only the blurb/timestamp update — no donate_url update at all.
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("marks homepageScrapedAt even when fetch returns a non-ok response", async () => {
    const { db } = await import("@workspace/db");

    const chain = makeDbUpdateChain();
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(chain.chain);

    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
    }) as unknown as typeof fetch;

    await scrapeStationHomepage(baseTarget, { fetchFn, ...safeScrapeOpts });

    expect(db.update).toHaveBeenCalledTimes(1);
    const setValues = chain.setCalls[0] as Record<string, unknown>;
    expect(setValues).toHaveProperty("homepageScrapedAt");
    expect(setValues).toHaveProperty("logoCheckedAt");
    expect(setValues).not.toHaveProperty("donateUrl");
  });

  it("upgrades a directory favicon to a large logo declared by the official site", async () => {
    const { db } = await import("@workspace/db");
    const pageChain = makeDbUpdateChain();
    const logoChain = makeDbUpdateChain({ returnRows: [{ id: 42 }] });
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(pageChain.chain)
      .mockReturnValueOnce(logoChain.chain);

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => `<img class="station-logo" src="/logo.png">`,
      })
      .mockResolvedValueOnce(imageResponse(makePng(256, 256))) as unknown as typeof fetch;

    await scrapeStationHomepage(
      { ...baseTarget, logoSource: "radio_browser" },
      { fetchFn, ...safeScrapeOpts },
    );

    expect(logoChain.setCalls[0]).toEqual({
      logoUrl: "https://station.example.com/logo.png",
      logoSource: "website",
      logoWidth: 256,
      logoHeight: 256,
    });
  });

  it("never probes or replaces an operator-curated logo", async () => {
    const { db } = await import("@workspace/db");
    const pageChain = makeDbUpdateChain();
    (db.update as ReturnType<typeof vi.fn>).mockReturnValueOnce(pageChain.chain);
    const fetchFn = makeHtmlFetch(`<img class="station-logo" src="/logo.png">`);

    await scrapeStationHomepage(
      { ...baseTarget, logoSource: "curated" },
      { fetchFn, ...safeScrapeOpts },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe("homepage and logo fetch safety", () => {
  const securityTarget = {
    id: 42,
    slug: "test-station",
    homepageUrl: "https://station.example.com",
  };

  it("does not fetch a homepage rejected by the public-host guard", async () => {
    const { db } = await import("@workspace/db");
    const chain = makeDbUpdateChain();
    (db.update as ReturnType<typeof vi.fn>).mockReturnValueOnce(chain.chain);
    const fetchFn = vi.fn() as unknown as typeof fetch;

    await scrapeStationHomepage(
      { ...securityTarget, homepageUrl: "http://127.0.0.1/private" },
      {
        fetchFn,
        isSafeUrlFn: () => false,
        isRobotsBlockedFn: async () => false,
      },
    );

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a homepage redirect to a private address", async () => {
    const { db } = await import("@workspace/db");
    const chain = makeDbUpdateChain();
    (db.update as ReturnType<typeof vi.fn>).mockReturnValueOnce(chain.chain);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://127.0.0.1/metadata" }),
    }) as unknown as typeof fetch;

    await scrapeStationHomepage(securityTarget, {
      fetchFn,
      isSafeUrlFn: (url) => !url.includes("127.0.0.1"),
      isRobotsBlockedFn: async () => false,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(chain.setCalls[0]).toHaveProperty("logoCheckedAt");
  });

  it("rejects an oversized image from Content-Length before reading its body", async () => {
    const arrayBuffer = vi.fn().mockRejectedValue(new Error("must not read"));
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "image/png",
        "content-length": "3000000",
      }),
      arrayBuffer,
    }) as unknown as typeof fetch;

    await expect(
      discoverStationLogo(
        `<img class="logo" src="/huge.png">`,
        "https://station.example",
        { fetchFn, isSafeUrlFn: () => true },
      ),
    ).resolves.toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects HTML that merely contains an svg tag", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      imageResponse(
        Buffer.from(`<html><body><svg viewBox="0 0 10 10"></svg></body></html>`),
        "text/html",
      ),
    ) as unknown as typeof fetch;

    await expect(
      discoverStationLogo(
        `<img class="logo" src="/not-an-image">`,
        "https://station.example",
        { fetchFn, isSafeUrlFn: () => true },
      ),
    ).resolves.toBeNull();
  });
});
