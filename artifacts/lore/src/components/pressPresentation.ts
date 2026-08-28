import type { PressArticle } from "@workspace/api-client-react";

export type PressArticleRelevance = "library" | "seed" | "coverage";
export type PressArticleWithLegacyRelevance = Pick<PressArticle, "overlap"> & {
  relevance?: PressArticleRelevance | null;
};

/**
 * New API responses identify the exact evidence band. Older cached responses
 * only had overlap, so deliberately use a neutral label instead of calling a
 * seed-only match a library keep.
 */
export function pressRelevanceLabel(article: PressArticleWithLegacyRelevance): string {
  if (article.relevance === "library") return "In your library";
  if (article.relevance === "seed") return "From a taste seed";
  if (article.relevance === "coverage") return "Music coverage";
  return article.overlap ? "Matches your taste" : "Music coverage";
}

export function pressRelevance(
  article: PressArticleWithLegacyRelevance,
): PressArticleRelevance | "legacy-match" {
  if (
    article.relevance === "library" ||
    article.relevance === "seed" ||
    article.relevance === "coverage"
  ) {
    return article.relevance;
  }
  return article.overlap ? "legacy-match" : "coverage";
}