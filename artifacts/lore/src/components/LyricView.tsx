import { useRef, useEffect, useMemo } from "react";
import { useGetRecordingLyrics } from "@workspace/api-client-react";
import { cn } from "../lib/utils";

interface LyricViewProps {
  mbid: string;
  progressMs: number | null;
}

export function LyricView({ mbid, progressMs }: LyricViewProps) {
  const { data, isLoading } = useGetRecordingLyrics(mbid);
  const lines = data?.lines ?? [];

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

  if (isLoading || !lines.length) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
      <p className="px-5 pt-4 pb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Lyrics
      </p>
      <ul
        className="max-h-56 overflow-y-auto px-5 pb-4 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {lines.map((line, i) => (
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
            {line.text || <span className="text-muted-foreground/20">·</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
