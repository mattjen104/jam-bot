/**
 * Injectable LLM extractor for publication year-end list pages, mirroring
 * the schedule-llm.ts seam pattern. The extraction logic (list-scraper.ts)
 * stays pure/testable; the actual model call is injected via
 * `configureListExtractor` (done in list-wire.ts on server boot).
 */
export type ListExtractor = (pageText: string) => Promise<string>;

let extractor: ListExtractor | null = null;

export function configureListExtractor(fn: ListExtractor): void {
  extractor = fn;
}

export function resetListExtractor(): void {
  extractor = null;
}

export async function extractListRaw(pageText: string): Promise<string> {
  if (!extractor) {
    throw new Error(
      "list-llm: no extractor configured (call configureListExtractor before scraping lists)",
    );
  }
  return extractor(pageText);
}
