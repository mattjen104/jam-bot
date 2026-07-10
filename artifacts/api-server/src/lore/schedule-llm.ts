/**
 * Injectable LLM extractor for station schedule pages, mirroring the
 * injectable-summarizer seam in `@workspace/song-enrichment`
 * (lib/song-enrichment/src/summarizer.ts): the actual model call is injected
 * so the extraction logic (schedule-scraper.ts) stays pure/testable, and
 * nothing here assumes a specific provider.
 */
export type ScheduleExtractor = (pageText: string) => Promise<string>;

let extractor: ScheduleExtractor | null = null;

export function configureScheduleExtractor(fn: ScheduleExtractor): void {
  extractor = fn;
}

/** Test-only: reset to unconfigured. */
export function resetScheduleExtractor(): void {
  extractor = null;
}

export async function extractScheduleRaw(pageText: string): Promise<string> {
  if (!extractor) {
    throw new Error(
      "schedule-llm: no extractor configured (call configureScheduleExtractor before scraping schedules)",
    );
  }
  return extractor(pageText);
}
