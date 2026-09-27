import { afterEach, describe, expect, it, vi } from "vitest";

const { requestOpenRouterChat, classifyIntent, synthesizeEvidenceAnswer } = await import(
  "../src/llm/openrouter.js"
);
const { config } = await import("../src/config.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenRouter request compatibility", () => {
  it("uses the existing chat route for passage synthesis within the remaining deadline", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        status: "verified",
        claims: [{ text: "The album was recorded live.", citations: [{
          id: "U1.P1", quote: "The album was recorded live.",
        }] }],
      }) } }] }), { status: 200 },
    ));
    const result = await synthesizeEvidenceAnswer("Was it live?", [{
      id: "U1.P1", sourceLabel: "Interview", sourceUrl: "https://example.com",
      excerpt: "The album was recorded live.",
    }], 6_000);
    expect(result.claims[0]?.citations[0]?.id).toBe("U1.P1");
    expect(timeoutSpy).toHaveBeenCalledWith(6_000);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe(config.OPENROUTER_MODEL);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("rejects malformed claim-level citations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"status":"verified","claims":[{"text":"Yes","citations":[]}]}' } }],
    }), { status: 200 }));
    await expect(synthesizeEvidenceAnswer("Question?", [{
      id: "U1.P1", sourceLabel: "Page", sourceUrl: "https://example.com", excerpt: "Evidence",
    }])).rejects.toThrow("Malformed evidence answer");
  });

  it("retries only a JSON-mode parameter rejection without changing the model or deadline", async () => {
    const timeout = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "response_format json_object is not supported by this model",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await requestOpenRouterChat(
      {
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "user", content: "Return JSON." }],
        response_format: { type: "json_object" },
      },
      "compatibility-test",
    );

    expect(result.status).toBe(200);
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    const retry = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body));
    expect(first.response_format).toEqual({ type: "json_object" });
    expect(retry).not.toHaveProperty("response_format");
    expect(retry.model).toBe("anthropic/claude-sonnet-4");
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeout);
    expect(fetchSpy.mock.calls[1]?.[1]?.signal).toBe(timeout);
  });

  it("does not retry unrelated bad-request responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "invalid model id" } }),
        { status: 400 },
      ),
    );

    const result = await requestOpenRouterChat({
      model: config.OPENROUTER_MODEL,
      messages: [{ role: "user", content: "Return JSON." }],
      response_format: { type: "json_object" },
    });

    expect(result.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the configured model for fallback intent and treats uncertain wording as a question", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"intent":"question"}' } }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      classifyIntent(
        "Would saying 'skip this one' stop the current song? I am asking, not requesting it.",
      ),
    ).resolves.toEqual({ intent: "question" });

    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe(config.OPENROUTER_MODEL);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});