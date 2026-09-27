import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverWebSources } from "../src/llm/web-search.js";

describe("OpenRouter web discovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests bounded web search and uses only provider URL annotations", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {
        content: "An invented https://invented.example claim.",
        annotations: [
          { type: "url_citation", url_citation: { url: "https://example.com/interview" } },
          { type: "url_citation", url_citation: { url: "https://example.com/interview" } },
          { type: "url_citation", url_citation: { url: "http://insecure.example/" } },
          { type: "url_citation", url_citation: { url: "https://example.org/review" } },
        ],
      } }] }), { status: 200 }),
    );
    const urls = await discoverWebSources("Who produced the album?", AbortSignal.timeout(1000));
    expect(urls).toEqual(["https://example.com/interview", "https://example.org/review"]);
    const request = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(request.tools[0].type).toBe("openrouter:web_search");
    expect(request.tools[0].parameters.max_results).toBe(3);
    expect(request.messages.at(-1).content).toBe("Who produced the album?");
  });

  it("fails closed when provider rejects the search request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 403 }));
    expect(await discoverWebSources("Question", AbortSignal.timeout(1000))).toEqual([]);
  });
});