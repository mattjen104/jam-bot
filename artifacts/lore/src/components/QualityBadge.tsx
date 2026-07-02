interface QualityBadgeProps {
  quality?: string | null;
  format?: string;
}

/**
 * A small teletype-style badge for the stream's audio quality + container.
 */
export function QualityBadge({ quality, format }: QualityBadgeProps) {
  const label = quality ?? (format ? format.toUpperCase() : "LIVE");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-border/60 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {label}
    </span>
  );
}
