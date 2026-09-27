import { describe, it, expect, vi } from "vitest";

// links.ts only uses logger.warn; mock it so this stays a pure unit test that
// doesn't drag in config/env validation.
vi.mock("../src/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { extractUrls, isBlockedIp, fetchLinkEvidence } = await import("../src/llm/links.js");

describe("bounded passage retrieval", () => {
  it("finds a relevant late paragraph beyond the old front-page excerpt", async () => {
    const filler = `<p>${"Unrelated navigation material ".repeat(20)}</p>`.repeat(12);
    const html = `<html><head><title>Interview</title></head><body>${filler}
      <p>The album was recorded live at the theater in 1990.</p></body></html>`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
    try {
      const result = await fetchLinkEvidence(["https://8.8.8.8/interview"], "Was the album recorded live?");
      expect(result[0]?.passages).toContain("The album was recorded live at the theater in 1990.");
      expect(result[0]?.passages?.join("").length).toBeLessThanOrEqual(3500);
      expect(result[0]?.excerpt).not.toContain("theater");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("drops irrelevant and unavailable pages rather than citing them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<p>Concert dates are available next week.</p>", {
        headers: { "content-type": "text/html" },
      }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    try {
      expect(await fetchLinkEvidence(
        ["https://8.8.8.8/tour", "https://8.8.8.8/missing"], "Who produced the album?",
      )).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not follow a redirect into an internal host", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    );
    try {
      expect(await fetchLinkEvidence(["https://8.8.8.8/redirect"], "What happened?")).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("extractUrls", () => {
  it("returns nothing for plain text with no links", () => {
    expect(extractUrls("just talking about music here")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });

  it("unwraps a Slack-formatted link <url>", () => {
    expect(
      extractUrls("what do you think of <https://pitchfork.com/reviews/albums/x>"),
    ).toEqual(["https://pitchfork.com/reviews/albums/x"]);
  });

  it("unwraps a Slack link with a display label <url|label>", () => {
    expect(
      extractUrls("check this <https://example.com/song|cool song> out"),
    ).toEqual(["https://example.com/song"]);
  });

  it("catches a bare url", () => {
    expect(extractUrls("read https://example.com/article now")).toEqual([
      "https://example.com/article",
    ]);
  });

  it("dedupes the same url appearing wrapped and bare", () => {
    const out = extractUrls(
      "<https://example.com/a|a> and also https://example.com/a again",
    );
    expect(out).toEqual(["https://example.com/a"]);
  });

  it("extracts multiple distinct links", () => {
    const out = extractUrls(
      "compare <https://a.com/1> with https://b.com/2 please",
    );
    expect(out).toContain("https://a.com/1");
    expect(out).toContain("https://b.com/2");
    expect(out).toHaveLength(2);
  });

  it("strips trailing punctuation glued onto a bare url", () => {
    expect(extractUrls("listen to https://example.com/track.")).toEqual([
      "https://example.com/track",
    ]);
  });

  it("ignores non-http(s) schemes", () => {
    expect(extractUrls("ftp://example.com/file and mailto:me@x.com")).toEqual([]);
  });

  it("blocks loopback / private / metadata hosts (SSRF guard)", () => {
    expect(extractUrls("http://localhost:8080/admin")).toEqual([]);
    expect(extractUrls("http://127.0.0.1/secret")).toEqual([]);
    expect(extractUrls("http://169.254.169.254/latest/meta-data")).toEqual([]);
    expect(extractUrls("http://10.0.0.5/internal")).toEqual([]);
    expect(extractUrls("http://192.168.1.1/router")).toEqual([]);
  });

  it("does not treat a Slack @mention as a link", () => {
    expect(extractUrls("hey <@U12345> play something")).toEqual([]);
  });
});

describe("isBlockedIp", () => {
  it("blocks IPv4 loopback / private / link-local / reserved ranges", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("10.1.2.3")).toBe(true);
    expect(isBlockedIp("192.168.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true); // cloud metadata
    expect(isBlockedIp("224.0.0.1")).toBe(true); // multicast
  });

  it("allows ordinary public IPv4 addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false); // just outside private block
  });

  it("blocks IPv6 loopback / link-local / unique-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true); // IPv4-mapped loopback
  });

  it("allows ordinary public IPv6 addresses", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});
