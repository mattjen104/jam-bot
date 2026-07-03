import { useRef, useEffect, useMemo, useState } from "react";
import {
  useGetRecordingLyrics,
  useGetRecordingKnowledge,
  type TrackClaim,
} from "@workspace/api-client-react";
import { cn } from "../lib/utils";
import { BookOpen, ExternalLink } from "lucide-react";

interface LyricViewProps {
  mbid: string;
  progressMs: number | null;
}

export function LyricView({ mbid, progressMs }: LyricViewProps) {
  const { data, isLoading } = useGetRecordingLyrics(mbid);
  const { data: knowledgeData } = useGetRecordingKnowledge(mbid);
  const lines = data?.lines ?? [];

  const [openClaimIdx, setOpenClaimIdx] = useState<number | null>(null);

  const activeRef = useRef<HTMLLIElement>(null);

  const activeIndex = useMemo(() => {
    if (progressMs === null || !lines.length) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i]?.offsetMs ?? Infinity) <= progressMs) idx = i;
      else break;
    }
    return idx;
  }, [lines, progressMs]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  const claimsByOffset = useMemo(() => {
    const claims: TrackClaim[] = (knowledgeData?.claims ?? []).filter(
      (c) => c.sourceHandle === "genius",
    );
    const map = new Map<number, TrackClaim[]>();
    for (const claim of claims) {
      if (claim.positionMs == null) continue;
      const pos = claim.positionMs;
      if (!map.has(pos)) map.set(pos, []);
      map.get(pos)!.push(claim);
    }
    return map;
  }, [knowledgeData]);

  function claimsForLine(offsetMs: number): TrackClaim[] {
    if (!claimsByOffset.size) return [];
    let best: TrackClaim[] = [];
    let bestDelta = Infinity;
    for (const [pos, cs] of claimsByOffset) {
      const delta = Math.abs(pos - offsetMs);
      if (delta < 2000 && delta < bestDelta) {
        bestDelta = delta;
        best = cs;
      }
    }
    return best;
  }

  if (isLoading) {
    return (
      <div className="px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground animate-pulse">
          Loading lyrics…
        </p>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          No synced lyrics found for this track.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
      <p className="px-5 pt-4 pb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Lyrics
      </p>
      <ul
        className="max-h-56 overflow-y-auto px-5 pb-4 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {lines.map((line, i) => {
          const lineClaims = claimsForLine(line.offsetMs);
          const hasClaims = lineClaims.length > 0;
          const isOpen = hasClaims && openClaimIdx === i;
          return (
            <li
              key={line.offsetMs}
              ref={i === activeIndex ? activeRef : null}
              className={cn(
                "py-0.5 text-sm leading-relaxed transition-colors duration-300",
                i === activeIndex
                  ? "font-semibold text-foreground"
                  : activeIndex === -1 || Math.abs(i - Math.max(activeIndex, 0)) < 6
                    ? "text-muted-foreground/70"
                    : "text-muted-foreground/30",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="flex-1">
                  {line.text || <span className="text-muted-foreground/20">·</span>}
                </span>
                {hasClaims && (
                  <button
                    type="button"
                    onClick={() => setOpenClaimIdx(isOpen ? null : i)}
                    title="Genius annotation"
                    className={cn(
                      "shrink-0 rounded-full p-0.5 transition-colors",
                      lineClaims.some((c) => c.verified)
                        ? "text-primary hover:text-primary/80"
                        : "text-primary/70 hover:text-primary",
                    )}
                    aria-label="Show Genius annotation"
                  >
                    <BookOpen className="h-3 w-3" />
                  </button>
                )}
              </span>
              {isOpen && (
                <div className="mt-1.5 ml-1 space-y-2">
                  {lineClaims.map((claim, ci) => (
                    <div
                      key={ci}
                      className="rounded-lg border border-border bg-secondary/50 p-2.5 text-xs"
                    >
                      <p className="text-foreground leading-snug">{claim.text}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "font-mono text-[10px] uppercase tracking-wide",
                            claim.verified
                              ? "text-primary"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {claim.sourceLabel}
                        </span>
                        <a
                          href={claim.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                        >
                          Read on Genius
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
