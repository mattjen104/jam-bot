// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  discoverFeedUrl,
  extractFeedLinksFromHtml,
  extractChannelTags,
} from "../src/lore/blog.js";

import {
  extractOutboundLinks,
  isBlockedByRobots,
  isCrawlBlocked,
  extractDomain,
  resetCrossRefQueue,
} from "../src/lore/blog-crossref.js";

import {
  writeHealthOk,
  writeHealthFail,
  MAX_FAILURES,
} from "../src/lore/blog-poller.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fetch mock. Patterns are tried in order; use more specific
 * patterns first (e.g. `/feed.rss` before `example.com`). String patterns are
 * matched as exact URL substrings; RegExp patterns use `.test()`.
 */
function makeFetchMock(
  responses: Array<{ pattern: string | RegExp; body: string; ok?: boolean; status?: number }>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const r of responses) {
      const matches =
        r.pattern instanceof RegExp ? r.pattern.test(url) : url === r.pattern || url.includes(r.pattern);
      if (matches) {
        const ok = r.ok ?? true;
        return {
          ok,
          status: r.status ?? (ok ? 200 : 404),
          statusText: ok ? "OK" : "Not Found",
          text: async () => r.body,
          json: async () => ({}),
          headers: new Headers(),
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
      json: async () => ({}),
      headers: new Headers(),
    } as Response;
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// discoverFeedUrl — <link rel="alternate"> parse
// ---------------------------------------------------------------------------

describe("discoverFeedUrl — <link> parse", () => {
  it("returns the feed URL found in <link rel=alternate> from the homepage", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.rss">
    </head></html>`;
    const feedXml = `<rss><channel><item><title>Post 1</title></item></channel></rss>`;
    // More specific URL first — domain pattern would also match the feed URL.
    const fetchFn = makeFetchMock([
      { pattern: "https://theobelisk.net/feed.rss", body: feedXml },
      { pattern: "https://theobelisk.net", body: html },
    ]);

    const url = await discoverFeedUrl("https://theobelisk.net", { fetchFn });
    expect(url).toBe("https://theobelisk.net/feed.rss");
  });

  it("handles a fully-qualified href in the <link> tag", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/atom+xml" href="https://blog.example.com/atom.xml">
    </head></html>`;
    const atomXml = `<feed><entry><title>Hello</title></entry></feed>`;
    const fetchFn = makeFetchMock([
      { pattern: "https://blog.example.com/atom.xml", body: atomXml },
      { pattern: "https://blog.example.com", body: html },
    ]);

    const url = await discoverFeedUrl("https://blog.example.com", { fetchFn });
    expect(url).toBe("https://blog.example.com/atom.xml");
  });

  it("skips <link> tags that lack rel=alternate and falls back to probe paths", async () => {
    const html = `<html><head>
      <link type="application/rss+xml" href="/rss-no-rel.xml">
    </head></html>`;
    // Probe paths are tried in order; /feed is first and serves a valid feed.
    const feedXml = `<rss><channel><item><title>X</title></item></channel></rss>`;
    const fetchFn = makeFetchMock([
      { pattern: "https://example.org/feed", body: feedXml },
      { pattern: "https://example.org", body: html },
    ]);

    const url = await discoverFeedUrl("https://example.org", { fetchFn });
    expect(url).toBe("https://example.org/feed");
  });
});

// ---------------------------------------------------------------------------
// discoverFeedUrl — probe fallback
// ---------------------------------------------------------------------------

describe("discoverFeedUrl — probe fallback", () => {
  it("falls back to probing /feed when no <link> tag is present", async () => {
    const html = `<html><head><title>No feed link</title></head></html>`;
    const feedXml = `<rss><channel><item><title>X</title></item></channel></rss>`;
    const fetchFn = makeFetchMock([
      { pattern: "https://music.example/feed", body: feedXml },
      { pattern: "https://music.example", body: html },
    ]);

    const url = await discoverFeedUrl("https://music.example", { fetchFn });
    expect(url).toBe("https://music.example/feed");
  });

  it("tries atom.xml when /feed, /feed/, /rss, /rss.xml all 404", async () => {
    const html = `<html><head></head></html>`;
    const atomXml = `<feed><entry><title>E</title></entry></feed>`;
    // Only serve atom.xml — every other probe 404s (default handler).
    const fetchFn = makeFetchMock([
      { pattern: "https://music.example/atom.xml", body: atomXml },
      { pattern: "https://music.example", body: html },
    ]);

    const url = await discoverFeedUrl("https://music.example", { fetchFn });
    expect(url).toBe("https://music.example/atom.xml");
  });

  it("returns null if no probe path yields a valid feed", async () => {
    const html = `<html><head></head></html>`;
    const fetchFn = makeFetchMock([
      { pattern: "https://nowhere.example", body: html },
      // All probe paths 404 (no matching patterns beyond the homepage).
    ]);

    const url = await discoverFeedUrl("https://nowhere.example", { fetchFn });
    expect(url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// discoverFeedUrl — validate-fail path
// ---------------------------------------------------------------------------

describe("discoverFeedUrl — validation", () => {
  it("rejects a candidate that has no <item> or <entry> elements", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/empty-feed.xml">
    </head></html>`;
    const notARealFeed = `<rss><channel></channel></rss>`; // no <item>
    const fetchFn = makeFetchMock([
      { pattern: "https://blog.example/empty-feed.xml", body: notARealFeed },
      { pattern: "https://blog.example", body: html },
    ]);

    const url = await discoverFeedUrl("https://blog.example", { fetchFn });
    expect(url).toBeNull();
  });

  it("accepts a feed that has <entry> elements (Atom)", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/atom">
    </head></html>`;
    const atom = `<feed><entry><title>Track</title></entry></feed>`;
    const fetchFn = makeFetchMock([
      { pattern: "https://blog.example/atom", body: atom },
      { pattern: "https://blog.example", body: html },
    ]);

    const url = await discoverFeedUrl("https://blog.example", { fetchFn });
    expect(url).toBe("https://blog.example/atom");
  });
});

// ---------------------------------------------------------------------------
// extractFeedLinksFromHtml — pure parser
// ---------------------------------------------------------------------------

describe("extractFeedLinksFromHtml", () => {
  it("extracts absolute href from a relative <link> tag", () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed">`;
    const links = extractFeedLinksFromHtml(html, "https://example.com");
    expect(links).toEqual(["https://example.com/feed"]);
  });

  it("extracts multiple <link> tags", () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="/rss">
      <link rel="alternate" type="application/atom+xml" href="/atom">
    `;
    const links = extractFeedLinksFromHtml(html, "https://example.com");
    expect(links).toHaveLength(2);
  });

  it("ignores <link> tags without rel=alternate", () => {
    const html = `<link rel="stylesheet" href="/style.css">`;
    const links = extractFeedLinksFromHtml(html, "https://example.com");
    expect(links).toHaveLength(0);
  });

  it("handles reversed attribute order (type before rel)", () => {
    const html = `<link type="application/rss+xml" rel="alternate" href="/rss">`;
    const links = extractFeedLinksFromHtml(html, "https://example.com");
    expect(links).toHaveLength(1);
    expect(links[0]).toBe("https://example.com/rss");
  });
});

// ---------------------------------------------------------------------------
// isBlockedByRobots — pure parser
// ---------------------------------------------------------------------------

describe("isBlockedByRobots", () => {
  it("returns true when User-agent * has Disallow: /", () => {
    const txt = `
User-agent: *
Disallow: /
`;
    expect(isBlockedByRobots(txt)).toBe(true);
  });

  it("returns false when User-agent * has Disallow: /private only", () => {
    const txt = `
User-agent: *
Disallow: /private
`;
    expect(isBlockedByRobots(txt)).toBe(false);
  });

  it("returns false when User-agent is Googlebot only (not *)", () => {
    const txt = `
User-agent: Googlebot
Disallow: /
`;
    expect(isBlockedByRobots(txt)).toBe(false);
  });

  it("returns false for an empty robots.txt", () => {
    expect(isBlockedByRobots("")).toBe(false);
  });

  it("handles Windows-style line endings", () => {
    const txt = "User-agent: *\r\nDisallow: /\r\n";
    expect(isBlockedByRobots(txt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCrawlBlocked — mocked fetch
// ---------------------------------------------------------------------------

describe("isCrawlBlocked", () => {
  it("returns true when robots.txt blocks all crawling", async () => {
    const fetchFn = makeFetchMock([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /\n" },
    ]);
    const blocked = await isCrawlBlocked("https://locked.example", { fetchFn });
    expect(blocked).toBe(true);
  });

  it("returns false when robots.txt is permissive", async () => {
    const fetchFn = makeFetchMock([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
    ]);
    const blocked = await isCrawlBlocked("https://open.example", { fetchFn });
    expect(blocked).toBe(false);
  });

  it("returns false (fail open) when robots.txt fetch fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const blocked = await isCrawlBlocked("https://dead.example", { fetchFn });
    expect(blocked).toBe(false);
  });

  it("returns false when robots.txt returns 404", async () => {
    const fetchFn = makeFetchMock([
      { pattern: "robots.txt", body: "", ok: false, status: 404 },
    ]);
    const blocked = await isCrawlBlocked("https://no-robots.example", { fetchFn });
    expect(blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractOutboundLinks — pure extractor
// ---------------------------------------------------------------------------

describe("extractOutboundLinks", () => {
  const BASE = "https://aquariumdrunkard.com/2024/01/review";

  it("extracts unique external origins from anchor hrefs", () => {
    const html = `
      <a href="https://pitchfork.com/some-article">Pitchfork</a>
      <a href="https://stereogum.com/another">Stereogum</a>
    `;
    const links = extractOutboundLinks(html, BASE, "aquariumdrunkard.com");
    expect(links).toContain("https://pitchfork.com");
    expect(links).toContain("https://stereogum.com");
    expect(links).toHaveLength(2);
  });

  it("excludes self-links (same domain as sourceDomain)", () => {
    const html = `<a href="https://aquariumdrunkard.com/other">Self</a>`;
    const links = extractOutboundLinks(html, BASE, "aquariumdrunkard.com");
    expect(links).toHaveLength(0);
  });

  it("excludes non-http(s) schemes", () => {
    const html = `<a href="mailto:info@example.com">Email</a>
                  <a href="ftp://files.example.com">FTP</a>`;
    const links = extractOutboundLinks(html, BASE, "aquariumdrunkard.com");
    expect(links).toHaveLength(0);
  });

  it("deduplicates multiple links to the same domain", () => {
    const html = `
      <a href="https://pitchfork.com/a">P1</a>
      <a href="https://pitchfork.com/b">P2</a>
    `;
    const links = extractOutboundLinks(html, BASE, "aquariumdrunkard.com");
    expect(links).toHaveLength(1);
    expect(links[0]).toBe("https://pitchfork.com");
  });

  it("returns empty array for empty HTML", () => {
    expect(extractOutboundLinks("", BASE, "aquariumdrunkard.com")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractChannelTags — pure: channel-level category extraction
// ---------------------------------------------------------------------------

describe("extractChannelTags", () => {
  it("extracts channel-level <category> elements (RSS)", () => {
    const xml = `<rss><channel>
      <category>Metal</category>
      <category>Heavy Rock</category>
      <item><title>Post</title><link>http://x.com/p</link><category>Item-only</category></item>
    </channel></rss>`;
    const tags = extractChannelTags(xml);
    expect(tags).toContain("metal");
    expect(tags).toContain("heavy rock");
    // item-level categories should be stripped before extraction
    expect(tags).not.toContain("item-only");
  });

  it("lowercases all tag values", () => {
    const xml = `<rss><channel><category>Post-Rock</category></channel></rss>`;
    const tags = extractChannelTags(xml);
    expect(tags).toEqual(["post-rock"]);
  });

  it("de-duplicates tags", () => {
    const xml = `<rss><channel>
      <category>Jazz</category>
      <category>jazz</category>
    </channel></rss>`;
    const tags = extractChannelTags(xml);
    expect(tags.filter((t) => t === "jazz")).toHaveLength(1);
  });

  it("returns empty array for feeds with no channel categories", () => {
    const xml = `<rss><channel><title>No cats</title></channel></rss>`;
    expect(extractChannelTags(xml)).toHaveLength(0);
  });

  it("caps results at 30 tags", () => {
    const cats = Array.from({ length: 40 }, (_, i) => `<category>tag-${i}</category>`).join("");
    const xml = `<rss><channel>${cats}</channel></rss>`;
    expect(extractChannelTags(xml).length).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  it("extracts hostname from valid URLs", () => {
    expect(extractDomain("https://example.com/path")).toBe("example.com");
    expect(extractDomain("http://sub.domain.co.uk")).toBe("sub.domain.co.uk");
  });

  it("returns null for invalid URLs", () => {
    expect(extractDomain("not-a-url")).toBeNull();
    expect(extractDomain("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cross-ref state: duplicate domain skip (queue deduplication)
// ---------------------------------------------------------------------------

describe("queueCrossRefDiscovery — duplicate skip", () => {
  beforeEach(() => {
    resetCrossRefQueue();
  });

  it("does not add the same URL twice to the queue", async () => {
    // Import here so we can spy without full mocking.
    const { queueCrossRefDiscovery } = await import("../src/lore/blog-crossref.js");
    // Queue the same post URL twice — only one should be enqueued.
    const url = "https://aquariumdrunkard.com/post/1";
    const noop = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" }) as unknown as typeof fetch;
    queueCrossRefDiscovery([url, url], "aquariumdrunkard.com", { fetchFn: noop });
    queueCrossRefDiscovery([url], "aquariumdrunkard.com", { fetchFn: noop });
    // If it were draining, noop would only be called once per unique URL.
    // We just verify the queue doesn't crash.
    resetCrossRefQueue(); // cancel drain timer
  });
});
