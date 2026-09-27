import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/links.js", () => ({
  extractUrls: vi.fn(() => []),
  fetchLinkEvidence: vi.fn().mockResolvedValue([]),
  contentTerms: (text: string) => new Set(
    (text.toLowerCase().match(/[a-z]{3,}/g) ?? [])
      .filter((word) => !["the", "was", "song", "in", "and"].includes(word)),
  ),
}));

vi.mock("../src/spotify/client.js", () => ({
  getCurrentlyPlaying: vi.fn().mockResolvedValue({ track: null }),
}));

vi.mock("../src/llm/openrouter.js", () => ({
  synthesizeEvidenceAnswer: vi.fn(),
}));

vi.mock("../src/llm/web-search.js", () => ({
  discoverWebSources: vi.fn().mockResolvedValue([]),
}));

const evidenceModule = await import("../src/llm/evidence.js");
const links = await import("../src/llm/links.js");
const spotify = await import("../src/spotify/client.js");
const openrouter = await import("../src/llm/openrouter.js");
const webSearch = await import("../src/llm/web-search.js");

describe("evidence-bound answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (webSearch.discoverWebSources as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: null,
    });
  });

  it("searches factual questions, fetches the discovered pages and quotes only fetched passages", async () => {
    (webSearch.discoverWebSources as ReturnType<typeof vi.fn>)
      .mockResolvedValue(["https://example.com/album-interview"]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockImplementation(
      async (urls: string[]) => urls.length ? [{
        url: urls[0],
        label: "Album interview",
        excerpt: "The album was recorded in Paris during the winter.",
        passages: ["The album was recorded in Paris during the winter."],
      }] : [],
    );
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "verified", claims: [{
        text: "The album was recorded in Paris during the winter.",
        citations: [{ id: "W1.P1", quote: "The album was recorded in Paris during the winter." }],
      }] });

    const result = await evidenceModule.answerWithEvidence("Where was the album recorded?");
    expect(webSearch.discoverWebSources).toHaveBeenCalledOnce();
    expect(links.fetchLinkEvidence).toHaveBeenCalledWith(
      ["https://example.com/album-interview"], "Where was the album recorded?",
    );
    expect(result.text).toContain("<https://example.com/album-interview|Album interview>");
    expect(result.text).toContain("“The album was recorded in Paris during the winter.”");
  });

  it("shows the exact source quote when a model paraphrases without adding facts", async () => {
    const quote = "It was released as the lead single from Talking Book in 1972.";
    (webSearch.discoverWebSources as ReturnType<typeof vi.fn>)
      .mockResolvedValue(["https://example.com/superstition"]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockImplementation(
      async (urls: string[]) => urls.length ? [{
        url: urls[0],
        label: "Release notes",
        excerpt: quote,
        passages: [quote],
      }] : [],
    );
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "verified", claims: [{
        text: "Superstition was released as the lead single from Talking Book in 1972.",
        citations: [{ id: "W1.P1", quote }],
      }] });

    const result = await evidenceModule.answerWithEvidence(
      "What album was “Superstition” released on?",
    );
    expect(result.text).toContain(quote);
    expect(result.text).toContain(`“${quote}”`);
    expect(result.text).not.toContain("Superstition was released as");
  });

  it("restores the fetched punctuation spacing instead of inventing a normalized quote", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>)
      .mockReturnValue(["https://example.com/notes"]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/notes",
      label: "Notes",
      excerpt: "The album was recorded live in Paris .",
      passages: ["The album was recorded live in Paris ."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "verified", claims: [{
        text: "The album was recorded live in Paris.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live in Paris." }],
      }] });

    const result = await evidenceModule.answerWithEvidence(
      "Where was the album recorded? https://example.com/notes",
    );
    expect(result.text).toContain("The album was recorded live in Paris .");
    expect(result.text).toContain("“The album was recorded live in Paris .”");
  });

  it("never treats search hits or snippets as evidence without fetching a readable page", async () => {
    (webSearch.discoverWebSources as ReturnType<typeof vi.fn>)
      .mockResolvedValue(["https://example.com/unread"]);
    const result = await evidenceModule.answerWithEvidence("Where was the album recorded?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(openrouter.synthesizeEvidenceAnswer).not.toHaveBeenCalled();
  });

  it("discovers only explicit public music facts, never private activity or ambiguous questions", async () => {
    for (const publicQuestion of [
      "Where was the album recorded?",
      "Who produced the song?",
      "What album was “Blue Monday” released on?",
    ]) {
      await evidenceModule.answerWithEvidence(publicQuestion);
      expect(webSearch.discoverWebSources).toHaveBeenCalledWith(
        publicQuestion, expect.any(AbortSignal),
      );
    }
    vi.mocked(webSearch.discoverWebSources).mockClear();
    for (const privateQuestion of [
      "What did I play last night?",
      "What did Alex play last night?",
      "What did Jordan listen to yesterday?",
      "Which songs did Sam request?",
      "What has Alex queued?",
      "Where was Alex's album recorded?",
      "Tell me about Alex",
      "What happened last night?",
    ]) {
      await evidenceModule.answerWithEvidence(privateQuestion);
    }
    expect(webSearch.discoverWebSources).not.toHaveBeenCalled();
  });

  it("still reads a pasted PDF even when the question cannot be sent to web discovery", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue(["https://example.com/notes.pdf"]);
    await evidenceModule.answerWithEvidence("What did Alex play? https://example.com/notes.pdf");
    expect(webSearch.discoverWebSources).not.toHaveBeenCalled();
    expect(links.fetchLinkEvidence).toHaveBeenCalledWith(
      ["https://example.com/notes.pdf"],
      "What did Alex play? https://example.com/notes.pdf",
    );
  });

  it("renders only citations returned from successfully fetched user links", async () => {
    (links.extractUrls as ReturnType<typeof vi.fn>).mockReturnValue([
      "https://example.com/interview",
    ]);
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/interview",
      label: "Artist interview",
      excerpt: "The artist says the song was recorded live.",
      passages: ["The artist says the song was recorded live."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "verified",
        claims: [{ text: "The artist says the song was recorded live.", citations: [{
          id: "U1.P1", quote: "The artist says the song was recorded live.",
        }] }],
      });

    const result = await evidenceModule.answerWithEvidence(
      "Was this recorded live? https://example.com/interview",
    );
    expect(result.text).toContain(
      "<https://example.com/interview|Artist interview>",
    );
    expect(result.text).toContain("“The artist says the song was recorded live.”");
  });

  it("renders a quote-verified PDF page reference and rejects a made-up PDF quote", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/notes.pdf",
      label: "example.com",
      excerpt: "Page 2: The album was recorded live at the theater in 1990.",
      pagePassages: [{ page: 2, text: "The album was recorded live at the theater in 1990." }],
    }]);
    const synthesize = openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>;
    synthesize.mockResolvedValueOnce({
      status: "verified",
      claims: [{ text: "The album was recorded live at the theater in 1990.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live at the theater in 1990." }] }],
    }).mockResolvedValueOnce({
      status: "verified",
      claims: [{ text: "The album was recorded live in Paris.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live in Paris." }] }],
    });
    const answer = await evidenceModule.answerWithEvidence("Was the album live?");
    expect(answer.text).toContain("<https://example.com/notes.pdf|example.com> (p. 2; “The album was recorded live at the theater in 1990.”)");
    expect(answer.evidence[0]).toEqual(expect.objectContaining({ page: 2, id: "U1.P1" }));
    expect((await evidenceModule.answerWithEvidence("Was the album live?")).text)
      .toMatch(/couldn’t find enough citable evidence/i);
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
      .mockResolvedValue({ status: "verified", claims: [{
        text: "Unsupported.", citations: [{ id: "MADE_UP", quote: "A bounded excerpt." }],
      }] });

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
        status: "verified",
        claims: [{ text: "See https://fabricated.example for proof.",
          citations: [{ id: "U1.P1", quote: "A bounded excerpt." }] }],
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
        status: "verified",
        claims: [{ text: "Producer X produced the recording.",
          citations: [{ id: "L1", quote: "Producer X produced the recording" }] }],
      });

    const result = await evidenceModule.answerWithEvidence(
      "Who produced it?",
    );
    expect(result.text).toContain("<https://example.com/source|Interview>");
    expect(result.text).toContain("Lore-published claim; source passage not checked");
    expect(result.text).not.toContain("“Producer X produced");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/recordings/by-isrc/");
    expect(fetchSpy.mock.calls[1]?.[0]).toContain("/recordings/recording-1/knowledge");
  });

  it("quotes fetched Lore source passages and retains their recording provenance", async () => {
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: {
        isrc: "USABC1234567",
        title: "Song",
        artist: "Artist",
        durationMs: 180_000,
      },
    });
    const sourceUrl = "https://example.com/source";
    const sourceQuote =
      "The recording was produced by Maya Ortiz at the Franklin Street Studio.";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mbid: "recording-1",
        artistMbid: "artist-1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        claims: [{
          text: "Maya Ortiz produced the recording.",
          sourceLabel: "Interview",
          sourceUrl,
          sourceHandle: "interview",
          verified: true,
        }],
      }), { status: 200 }));
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockImplementation(
      async (urls: string[]) => urls.length ? [{
        url: sourceUrl,
        label: "Interview",
        excerpt: sourceQuote,
        passages: [sourceQuote],
      }] : [],
    );
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockImplementation(async (_question: string, evidence: Array<{ id: string }>) => {
        expect(evidence).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: "L1",
            excerpt: "Maya Ortiz produced the recording.",
          }),
          expect.objectContaining({
            id: "R1.P1",
            excerpt: sourceQuote,
            identity: expect.objectContaining({
              kind: "external",
              recordingId: "recording-1",
              artistId: "artist-1",
            }),
          }),
        ]));
        return {
          status: "verified",
          claims: [{
            text: sourceQuote,
            citations: [{ id: "R1.P1", quote: sourceQuote }],
          }],
        };
      });

    const result = await evidenceModule.answerWithEvidence("Who produced it?");
    expect(links.fetchLinkEvidence).toHaveBeenCalledWith(
      [sourceUrl],
      expect.stringContaining("Maya Ortiz produced the recording."),
    );
    expect(links.fetchLinkEvidence).toHaveBeenCalledWith(
      [sourceUrl],
      expect.stringContaining("Who produced it?"),
    );
    expect(result.text).toContain(
      `<${sourceUrl}|Interview> (“${sourceQuote}”)`,
    );
    expect(result.text).not.toContain("source passage not checked");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps an unavailable Lore source transparent and does not quote the claim", async () => {
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: {
        isrc: "USABC1234567",
        title: "Song",
        artist: "Artist",
        durationMs: 180_000,
      },
    });
    const sourceUrl = "https://example.com/unavailable-source";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mbid: "recording-1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        claims: [{
          text: "Producer X produced the recording.",
          sourceLabel: "Interview",
          sourceUrl,
          sourceHandle: "interview",
          verified: true,
        }],
      }), { status: 200 }));
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "verified",
        claims: [{
          text: "Producer X produced the recording.",
          citations: [{ id: "L1", quote: "Producer X produced the recording" }],
        }],
      });

    const result = await evidenceModule.answerWithEvidence("Who produced it?");
    expect(links.fetchLinkEvidence).toHaveBeenCalledWith(
      [sourceUrl],
      expect.stringContaining("Producer X produced the recording."),
    );
    expect(result.text).toContain("<https://example.com/unavailable-source|Interview>");
    expect(result.text).toContain("Lore-published claim; source passage not checked");
    expect(result.text).not.toContain("“Producer X produced");
  });

  it("rejects a fabricated quotation for a fetched Lore source", async () => {
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      track: {
        isrc: "USABC1234567",
        title: "Song",
        artist: "Artist",
        durationMs: 180_000,
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mbid: "recording-1",
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
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockImplementation(
      async (urls: string[]) => urls.length ? [{
        url: urls[0],
        label: "Interview",
        excerpt: "The recording was produced by Maya Ortiz at the Franklin Street Studio.",
        passages: [
          "The recording was produced by Maya Ortiz at the Franklin Street Studio.",
        ],
      }] : [],
    );
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "verified",
        claims: [{
          text: "The recording was produced by Producer X at Abbey Road.",
          citations: [{
            id: "R1.P1",
            quote: "The recording was produced by Producer X at Abbey Road.",
          }],
        }],
      });

    const result = await evidenceModule.answerWithEvidence("Who produced it?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(result.text).not.toContain("Abbey Road");
  });

  it("does not fetch Lore sources when the recording has no published claims", async () => {
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
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ claims: [] }), {
        status: 200,
      }));
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await evidenceModule.answerWithEvidence("Who produced it?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    // The normal, empty pasted-link lookup still runs; no Lore-source lookup is added.
    expect(links.fetchLinkEvidence).toHaveBeenCalledOnce();
    expect(links.fetchLinkEvidence).toHaveBeenCalledWith(
      [],
      "Who produced it?",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
        excerpt: "The first fact is documented in the archive.",
      },
      {
        url: "https://two.example/interview",
        label: "Source Two",
        excerpt: "The second fact is documented in the interview.",
      },
    ]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "verified",
        claims: [
          { text: "The first fact is documented in the archive.", citations: [{ id: "U1.P1", quote: "The first fact is documented in the archive." }] },
          { text: "The second fact is documented in the interview.", citations: [{ id: "U2.P1", quote: "The second fact is documented in the interview." }] },
        ],
      });

    const result = await evidenceModule.answerWithEvidence("Compare these.");
    expect(result.text).toContain("<https://one.example/article|Source One>");
    expect(result.text).toContain("<https://two.example/interview|Source Two>");
  });

  it("refuses an irrelevant page even when the model supplies a real quote", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/tour",
      label: "Tour dates",
      excerpt: "The band announced concert dates across Europe.",
      passages: ["The band announced concert dates across Europe."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "verified",
      claims: [{ text: "The album was recorded live.",
        citations: [{ id: "U1.P1", quote: "announced concert dates across Europe" }] }],
    });
    const result = await evidenceModule.answerWithEvidence("Was the album recorded live?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
  });

  it("refuses conflicting passages instead of choosing one", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/interview",
      label: "Interview",
      excerpt: "Conflicting interview statements.",
      passages: [
        "The album was recorded live in 1990.",
        "The album was not recorded live in 1990.",
      ],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "unverified", claims: [],
    });
    const result = await evidenceModule.answerWithEvidence("Was the album recorded live?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(openrouter.synthesizeEvidenceAnswer).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ id: "U1.P2" })]),
      expect.any(Number),
    );
  });

  it("rejects an affirmative citation contradicted by another retrieved passage", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/notes", label: "Notes", excerpt: "",
      passages: [
        "The album was recorded live in 1990.",
        "The album was not recorded live in 1990.",
      ],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "verified",
      claims: [{ text: "The album was recorded live in 1990.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live in 1990." }] }],
    });
    expect((await evidenceModule.answerWithEvidence("Was it recorded live?")).text)
      .toMatch(/couldn’t find enough citable evidence/i);
  });

  it("rejects a claim that negates its own cited quote without another passage", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/notes", label: "Notes",
      excerpt: "The album was recorded live in 1990.",
      passages: ["The album was recorded live in 1990."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "verified",
      claims: [{ text: "The album was not recorded live in 1990.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live in 1990." }] }],
    });
    expect((await evidenceModule.answerWithEvidence("Was it recorded live?")).text)
      .toMatch(/couldn’t find enough citable evidence/i);
  });

  it("rejects a different location or person despite shared topic words", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/notes", label: "Notes",
      excerpt: "The album was recorded live in Paris by Alice.",
      passages: ["The album was recorded live in Paris by Alice."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "verified",
      claims: [{ text: "The album was recorded live in London by Bob.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live in Paris by Alice." }] }],
    });
    expect((await evidenceModule.answerWithEvidence("Where was it recorded?")).text)
      .toMatch(/couldn’t find enough citable evidence/i);
  });

  it("refuses conflicting short quotations on the same subject", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/notes", label: "Notes", excerpt: "",
      passages: ["The album was recorded live in London.", "The album was recorded live in Paris."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "verified",
      claims: [{ text: "The album was recorded live in London.",
        citations: [{ id: "U1.P1", quote: "The album was recorded live in London." }] }],
    });
    expect((await evidenceModule.answerWithEvidence("Where was it recorded?")).text)
      .toMatch(/couldn’t find enough citable evidence/i);
  });

  it("does not cite an unavailable page", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await evidenceModule.answerWithEvidence("What did the page say?");
    expect(result.text).toMatch(/couldn’t find enough citable evidence/i);
    expect(openrouter.synthesizeEvidenceAnswer).not.toHaveBeenCalled();
  });

  it("rejects a fabricated quotation even when the passage id exists", async () => {
    (links.fetchLinkEvidence as ReturnType<typeof vi.fn>).mockResolvedValue([{
      url: "https://example.com/interview", label: "Interview",
      excerpt: "The record was made in a studio.",
      passages: ["The record was made in a studio."],
    }]);
    (openrouter.synthesizeEvidenceAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "verified",
      claims: [{ text: "The record was recorded live.",
        citations: [{ id: "U1.P1", quote: "The record was recorded live." }] }],
    });
    expect((await evidenceModule.answerWithEvidence("Was it live?")).text)
      .toMatch(/couldn’t find enough citable evidence/i);
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