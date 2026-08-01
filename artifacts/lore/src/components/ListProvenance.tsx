import {
  useGetRecordingListProvenance,
  getGetRecordingListProvenanceQueryKey,
} from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";

/**
 * Publication list appearances for the recording's album — shown as
 * "#3 on The Quietus 2025". Only exact/confirmed entries are surfaced;
 * returns null when none have been scraped yet.
 *
 * Shared between NowPlaying (inline panel) and Song page (standalone section).
 */
export function ListProvenance({ mbid }: { mbid: string }) {
  const { data } = useGetRecordingListProvenance(mbid, {
    query: {
      queryKey: getGetRecordingListProvenanceQueryKey(mbid),
      staleTime: 15 * 60_000,
    },
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mt-5" data-testid="list-provenance">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Listed on
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const albumLine = [
            item.releaseGroupTitle ?? item.releaseGroupMbid,
            item.releaseYear ? `(${item.releaseYear})` : null,
          ]
            .filter(Boolean)
            .join(" ");
          const rankLine =
            item.isRanked && item.rank != null ? `#${item.rank}` : "listed";
          const yearSuffix = item.listYear ? ` ${item.listYear}` : "";
          const label = `${rankLine} on ${item.sourceName}${yearSuffix}`;

          return (
            <li
              key={`${item.listId}-${item.releaseGroupMbid}`}
              className="text-sm leading-snug"
            >
              {albumLine && (
                <span className="font-medium text-foreground">
                  {albumLine} —{" "}
                </span>
              )}
              <a
                href={item.listUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                title={item.listTitle}
              >
                {label}
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
