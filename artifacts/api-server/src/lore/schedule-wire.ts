import { configureScheduleExtractor } from "./schedule-llm.js";

/**
 * Wire the schedule extractor to the Anthropic AI integration (Replit-managed
 * proxy — no user-provided API key required). Called once before the
 * schedule scraper starts.
 *
 * The `@workspace/integrations-anthropic-ai` client throws at *module load*
 * if the integration env vars aren't set — so it's imported lazily here
 * (inside the function, not at module top level) and any failure is caught.
 * A missing/misconfigured integration must never crash api-server boot or
 * block unrelated pollers; it should just leave the schedule scraper
 * unconfigured (extractScheduleRaw throws per-call, which
 * scrapeStationSchedule already catches and treats as "scrape failed, leave
 * prior schedule in place").
 *
 * Returns true when wiring succeeded, false when the integration is
 * unavailable — callers should skip starting the scraper loop on false.
 */
let wired = false;

export async function wireScheduleExtractor(): Promise<boolean> {
  if (wired) return true;
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    configureScheduleExtractor(async (pageText: string): Promise<string> => {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: pageText }],
      });
      const block = message.content[0];
      return block?.type === "text" ? block.text : "[]";
    });
    wired = true;
    return true;
  } catch (err) {
    console.warn(
      "[schedule-scraper] Anthropic AI integration unavailable — schedule scraping disabled",
      err,
    );
    return false;
  }
}
