import type { GenreBreakdown, DiscoveryScore } from "@workspace/api-client-react";
import { Compass, Tags } from "lucide-react";

interface GenreDiscoveryPanelProps {
  genreBreakdown: GenreBreakdown | null | undefined;
  discoveryScore: DiscoveryScore | null | undefined;
  isLoading?: boolean;
}

const LABEL_TEXT: Record<string, string> = {
  "new-music": "New music leaning",
  recent: "Recent leaning",
  catalog: "Catalog leaning",
  unknown: "Not enough data",
};

/**
 * Genre map + new-music discovery indicator for a station, show, DJ/picker,
 * or curated list. Degrades gracefully to "unknown" when there isn't enough
 * enriched genre/release-year data — never guesses.
 */
export function GenreDiscoveryPanel({
  genreBreakdown,
  discoveryScore,
  isLoading,
}: GenreDiscoveryPanelProps) {
  if (isLoading) {
    return (
      <div className="h-20 animate-pulse rounded-xl border border-card-border bg-card" />
    );
  }

  if (!genreBreakdown && !discoveryScore) return null;

  const hasGenres = !!genreBreakdown && genreBreakdown.top.length > 0;
  const label = discoveryScore?.label ?? "unknown";

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-card-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="genre-discovery-panel"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wide text-muted-foreground">
          <Tags className="h-3 w-3" />
          Genre map
        </div>
        {hasGenres ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="genre-tags">
            {genreBreakdown!.top.slice(0, 6).map((g) => (
              <span
                key={g.genre}
                className="rounded-full border border-card-border bg-background px-2.5 py-0.5 font-mono text-[13px] text-foreground"
              >
                {g.genre} <span className="text-muted-foreground">· {g.count}</span>
              </span>
            ))}
            {genreBreakdown!.unknownCount > 0 ? (
              <span className="rounded-full border border-card-border bg-background px-2.5 py-0.5 font-mono text-[13px] text-muted-foreground">
                {genreBreakdown!.unknownCount} unknown
              </span>
            ) : null}
          </div>
        ) : (
          <p className="mt-1.5 font-mono text-[13px] text-muted-foreground">
            Not enough genre data yet
          </p>
        )}
      </div>

      <div
        className="flex shrink-0 items-center gap-2 rounded-full border border-primary-border bg-primary/10 px-3 py-1.5"
        data-testid="discovery-badge"
        title={
          discoveryScore?.medianAgeYears != null
            ? `Median track age: ${discoveryScore.medianAgeYears.toFixed(1)} years`
            : undefined
        }
      >
        <Compass className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[13px] uppercase tracking-wide text-primary">
          {LABEL_TEXT[label] ?? "Not enough data"}
        </span>
        {discoveryScore?.score != null ? (
          <span className="font-mono text-[13px] text-primary/80">
            {Math.round(discoveryScore.score)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
