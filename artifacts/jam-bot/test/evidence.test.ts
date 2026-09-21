import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/links.js", () => ({
  extractUrls: vi.fn(() => []),
  fetchLinkEvidence: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/spotify/client.js", () => ({
  getCurrentlyPlaying: vi.fn().mockResolvedValue({ track: null }),
}));

vi.mock("../src/llm/openrouter.js", () => ({
  synthesizeEvidenceAnswer: vi.fn(),
}));

const evidenceModule = await import("../src/llm/evidence.js");
const links = await import("../src/llm/links.js");
const spotify = await import("../src/spotify/client.js");
const openrouter = await import("../src/llm/openrouter.js");

describe("evidence-bound answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: null,
    });
  });

  it("renders only citations returned from successfully fetched user links", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue([
      "https://example.com/interview",
    ]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/interview",
      label: "Artist interview",
      excerpt: "The artist says the song was recorded live.",
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        answer: "The artist says it was recorded live.",
        citationIds: ["U1"],
      });

    const result = await evidenceModule.answerWithEvidence(
      "Was this recorded live? https://example.com/interview",
    );
    expect(result.text).toContain(
      "<https://example.com/interview|Artist interview>",
    );
  });

  it("fails closed when the model fabricates a citation id", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue([
      "https://example.com/interview",
    ]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/interview",
      label: "Interview",
      excerpt: "A bounded excerpt.",
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ answer: "Unsupported.", citationIds: ["MADE_UP"] });

    const result = await evidenceModule.answerWithEvidence("What happened?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(result.text).not.toContain("MADE_UP");
  });

  it("fails closed when prose contains an invented link", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue([
      "https://example.com/interview",
    ]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/interview",
      label: "Interview",
      excerpt: "A bounded excerpt.",
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        answer: "See https://fabricated.example for proof.",
        citationIds: ["U1"],
      });

    const result = await evidenceModule.answerWithEvidence("What happened?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(result.text).not.toContain("fabricated.example");
  });

  it("reuses canonical Lore claims for a strongly identified current track", async () => {
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: {
        isrc: "USABC1234567",
        title: "Song",
        artist: "Artist",
        durationMs: 180_000,
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mbid: "recording-1",
        artistMbid: "artist-1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        claims: [{
          text: "Producer X produced the recording.",
          sourceLabel: "Interview",
          sourceUrl: "https://example.com/source",
          sourceHandle: "interview",
          verified: true,
        }],
      }), { status: 200 }));
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        answer: "Producer X produced it.",
        citationIds: ["L1"],
      });

    const result = await evidenceModule.answerWithEvidence(
      "Who produced it?",
    );
    expect(result.text).toContain("<https://example.com/source|Interview>");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/recordings/by-isrc/");
    expect(fetchSpy.mock.calls[1]?.[0]).toContain("/recordings/recording-1/knowledge");
  });

  it("invokes Lore canonical enrichment after an ISRC cache miss", async () => {
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: {
        isrc: "USABC1234567",
        title: "Song",
        artist: "Artist",
        durationMs: 180_000,
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mbid: "recording-2",
        confidence: "isrc",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ claims: [] }), {
        status: 200,
      }));

    const result = await evidenceModule.answerWithEvidence(
      "Who produced the current track?",
    );
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
    }));
    expect(String(fetchSpy.mock.calls[1]?.[1]?.body)).toContain("USABC1234567");
  });

  it("does not promote an ambiguous current track without a strong identifier", async () => {
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: {
        title: "Common Title",
        artist: "Unknown Artist",
        durationMs: 180_000,
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await evidenceModule.answerWithEvidence(
      "Who produced the current track?",
    );
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attributes multiple retrieved sources without changing their URLs", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue(["a", "b"]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        url: "https://one.example/article",
        label: "Source One",
        excerpt: "First fact.",
      },
      {
        url: "https://two.example/interview",
        label: "Source Two",
        excerpt: "Second fact.",
      },
    ]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        answer: "Two sources support the answer.",
        citationIds: ["U1", "U2"],
      });

    const result = await evidenceModule.answerWithEvidence("Compare these.");
    expect(result.text).toContain("<https://one.example/article|Source One>");
    expect(result.text).toContain("<https://two.example/interview|Source Two>");
  });

  it("keeps a swapped decision provider from carrying facts", async () => {
    const provider = {
      decide: vi.fn().mockResolvedValue({
        kind: "social",
        confidence: 0.8,
        facts: ["invented"],
      }),
    };
    await expect(evidenceModule.decideAnswerKind("hello", provider))
      .resolves.toEqual({ kind: "social", confidence: 0.8 });
  });

  it("keeps recommendations social but routes concrete music facts", async () => {
    await expect(evidenceModule.decideAnswerKind(
      "what should I listen to next?",
    )).resolves.toEqual({ kind: "social", confidence: 1 });
    await expect(evidenceModule.decideAnswerKind(
      "what album was this song released on?",
    )).resolves.toEqual({ kind: "factual", confidence: 1 });
  });

  it.each([
    "Explain the history of shoegaze.",
    "Name the producer of this song.",
    "Give me the release history of this album.",
    "I need the personnel credits for this recording.",
    "Who produced it?",
  ])("routes factual imperative, indirect, and follow-up wording: %s", async (text) => {
    await expect(evidenceModule.decideAnswerKind(text)).resolves.toEqual({
      kind: "factual",
      confidence: 1,
    });
  });
});