/**
 * Injectable LLM summarizer.
 *
 * knowledge.ts / context.ts optionally produce a one-line, fact-grounded
 * summary phrased in the bot's voice — ONLY when the corresponding
 * `TRACK_*_LLM_SUMMARY` flag is enabled (both default to false). To avoid
 * pulling jam-bot's OpenRouter client into the shared lib, the actual call is
 * injected. When no summarizer is configured (the default), `askLLM` throws —
 * but it is never reached unless a host both wires nothing AND turns the
 * summary flags on.
 */
export type EnrichmentSummarizer = (question: string) => Promise<string>;

let summarizer: EnrichmentSummarizer | null = null;

export function configureEnrichmentSummarizer(fn: EnrichmentSummarizer): void {
  summarizer = fn;
}

export async function askLLM(question: string): Promise<string> {
  if (!summarizer) {
    throw new Error(
      "song-enrichment: no summarizer configured (enable one via configureEnrichmentSummarizer before turning on TRACK_*_LLM_SUMMARY)",
    );
  }
  return summarizer(question);
}
