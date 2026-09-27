import { config } from "../config.js";
import { logger } from "../logger.js";

const SEARCH_TIMEOUT_MS = 6_000;
const MAX_RESULTS = 3;

/**
 * Discovery only. Neither the model's prose nor provider snippets count as
 * evidence: callers must fetch the cited page and verify its actual passages.
 */
export async function discoverWebSources(
  question: string,
  deadline: AbortSignal,
): Promise<string[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: "Search the web for sources relevant to this question. Return a brief answer with citations. Do not use private conversation history." },
          { role: "user", content: question.slice(0, 500) },
        ],
        tools: [{
          type: "openrouter:web_search",
          parameters: { engine: "exa", mode: "fast", max_results: MAX_RESULTS },
        }],
        temperature: 0,
        max_tokens: 300,
      }),
      signal: AbortSignal.any([deadline, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      logger.warn("Web source discovery failed", { status: response.status });
      return [];
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: {
        annotations?: Array<{ type?: string; url_citation?: { url?: unknown } }>;
      } }>;
    };
    const urls = new Set<string>();
    for (const annotation of payload.choices?.[0]?.message?.annotations ?? []) {
      if (annotation.type !== "url_citation" || typeof annotation.url_citation?.url !== "string") continue;
      try {
        const url = new URL(annotation.url_citation.url);
        if (url.protocol === "https:") urls.add(url.toString());
      } catch {
        // Malformed result URLs cannot be fetched or cited.
      }
      if (urls.size >= MAX_RESULTS) break;
    }
    return [...urls];
  } catch (error) {
    logger.warn("Web source discovery unavailable", { error: String(error) });
    return [];
  }
}