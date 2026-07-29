import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useWpSelectors, useWpSelectorRuns, type WpSelector } from "./hooks";

const oneLine: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/** Expanded row body: the selector's recent runs, tappable into the drawer. */
function SelectorRuns({
  handle,
  onOpenRun,
}: {
  handle: string;
  onOpenRun: (slug: string, runId: number) => void;
}) {
  const { data, isLoading } = useWpSelectorRuns(handle);
  if (isLoading) {
    return (
      <p style={{ margin: 0, padding: "8px 16px 12px 44px", fontSize: 12, color: "var(--wp-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> loading runs…
      </p>
    );
  }
  const runs = data?.runs ?? [];
  if (runs.length === 0) {
    return (
      <p style={{ margin: 0, padding: "8px 16px 12px 44px", fontSize: 12, color: "var(--wp-text-muted)" }}>
        No logged runs yet.
      </p>
    );
  }
  return (
    <div style={{ padding: "0 12px 10px 40px" }}>
      {runs.slice(0, 8).map((r) => (
        <button
          key={r.runId}
          type="button"
          onClick={() => onOpenRun(r.station.slug, r.runId)}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "baseline",
            gap: 8,
            background: "none",
            border: "none",
            borderRadius: 6,
            padding: "5px 4px",
            textAlign: "left",
            cursor: "pointer",
          }}
          data-testid={`wp-selector-run-${r.runId}`}
        >
          <span className="wp-mono" style={{ fontSize: 11, color: "var(--wp-text-muted)", flexShrink: 0 }}>
            {r.day}
          </span>
          <span style={{ fontSize: 12, minWidth: 0, flex: 1, ...oneLine }}>
            {r.show?.name ?? r.station.name}
          </span>
          <span className="wp-mono" style={{ fontSize: 10, color: "var(--wp-text-muted)", flexShrink: 0 }}>
            {r.spinCount} spins
          </span>
        </button>
      ))}
    </div>
  );
}

function SelectorRow({
  s,
  expanded,
  onToggle,
  onOpenRun,
}: {
  s: WpSelector;
  expanded: boolean;
  onToggle: () => void;
  onOpenRun: (slug: string, runId: number) => void;
}) {
  const ago = timeAgo(s.lastPlayedAt);
  return (
    <div style={{ borderBottom: "0.5px solid var(--wp-border)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: 10,
          background: "none",
          border: "none",
          borderRadius: 0,
          padding: "11px 16px",
          textAlign: "left",
          cursor: "pointer",
        }}
        data-testid={`wp-selector-${s.handle}`}
      >
        {expanded ? (
          <ChevronDown size={14} style={{ color: "var(--wp-text-muted)", flexShrink: 0 }} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} style={{ color: "var(--wp-text-muted)", flexShrink: 0 }} aria-hidden="true" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, ...oneLine }}>{s.name}</p>
          <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--wp-text-muted)", ...oneLine }}>
            {s.stationName ?? "—"}
            {s.recentSpinCount > 0 && ` · ${s.recentSpinCount} spins this month`}
          </p>
        </div>
        {ago && (
          <span className="wp-mono" style={{ fontSize: 10, color: "var(--wp-text-muted)", flexShrink: 0 }}>
            {ago}
          </span>
        )}
      </button>
      {expanded && <SelectorRuns handle={s.handle} onOpenRun={onOpenRun} />}
    </div>
  );
}

/** SELECTORS tab: every DJ with logged spins, most recently heard first. */
export function SelectorsTab({
  onOpenRun,
}: {
  onOpenRun: (slug: string, runId: number) => void;
}) {
  const { data, isLoading } = useWpSelectors();
  const [open, setOpen] = useState<string | null>(null);
  const selectors = data?.selectors ?? [];

  return (
    <div className="wp-card" style={{ overflow: "hidden" }} data-testid="wp-selectors-tab">
      {isLoading && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          Finding the humans behind the dials…
        </p>
      )}
      {!isLoading && selectors.length === 0 && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          No selectors with logged spins yet.
        </p>
      )}
      {selectors.map((s) => (
        <SelectorRow
          key={s.handle}
          s={s}
          expanded={open === s.handle}
          onToggle={() => setOpen(open === s.handle ? null : s.handle)}
          onOpenRun={onOpenRun}
        />
      ))}
    </div>
  );
}
