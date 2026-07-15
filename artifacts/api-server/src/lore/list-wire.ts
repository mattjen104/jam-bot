import { configureListExtractor } from "./list-llm.js";

/**
 * Wire the list extractor to the Anthropic AI integration.
 * Mirrors the schedule-wire.ts pattern: lazy import so a missing integration
 * never crashes api-server boot.
 *
 * Returns true when wiring succeeded. Admin endpoints should return 503 when
 * false is returned — they need the LLM to run the scraper.
 */
let wired = false;

export async function wireListExtractor(): Promise<boolean> {
  if (wired) return true;
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    configureListExtractor(async (pageText: string): Promise<string> => {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: pageText }],
      });
      const block = message.content[0];
      return block?.type === "text" ? block.text : "[]";
    });
    wired = true;
    return true;
  } catch (err) {
    console.warn(
      "[list-scraper] Anthropic AI integration unavailable — list scraping disabled",
      err,
    );
    return false;
  }
}
