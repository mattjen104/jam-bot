import { Check, Ghost, X } from "lucide-react";
import { useWpRun, useWpLoreCounts, type WpRunSpin } from "./hooks";
import { LoreChip } from "./LoreChip";
import { WpKeep } from "./WpKeep";
import { usePlayer } from "../player/PlayerProvider";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function SpinRow({
  spin,
  stationSlug,
  loreCount,
  onOpenLore,
}: {
  spin: WpRunSpin;
  stationSlug: string;
  loreCount: ReturnType<typeof useWpLoreCounts>["data"];
  onOpenLore: (mbid: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0",
        borderBottom: "0.5px solid var(--wp-border)",
      }}
    >
      {spin.inLibrary && (
        <Check
          size={15}
          style={{ color: "var(--wp-text-success)", flexShrink: 0 }}
          aria-label="In your library"
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 16 }}>
          {spin.artist} — {spin.title}
        </p>
        <p style={{ margin: "1px 0 0", fontSize: 14, color: "var(--wp-text-muted)" }}>
          spun {fmtTime(spin.playedAt)}
          {!spin.resolved && " · unresolved"}
        </p>
      </div>
      {spin.mbid && (
        <LoreChip count={loreCount?.get(spin.mbid)} onOpen={() => onOpenLore(spin.mbid!)} />
      )}
      {spin.mbid && !spin.inLibrary && (
        <WpKeep mbid={spin.mbid} provenance={{ kind: "station", stationSlug }} />
      )}
    </div>
  );
}

/**
 * Run drawer — tonight's run for a station, split into FROM YOUR LIBRARY and
 * NEW TO YOU, with the selector trove (shared count + deep cuts) at the foot.
 */
export function RunDrawerSheet({
  slug,
  runId,
  onClose,
  onOpenLore,
  context,
}: {
  slug: string;
  /** Anchor spin id of a specific past run; omit for tonight's live run. */
  runId?: number | null;
  onClose: () => void;
  onOpenLore: (mbid: string) => void;
  /** Ledger context tag forwarded to startReplay (e.g. 'library'). */
  context?: string;
}) {
  const { data: run, isLoading, isError, refetch } = useWpRun(slug, runId);
  const { ride } = usePlayer();

  const allMbids = [
    ...(run?.fromLibrary ?? []),
    ...(run?.newToYou ?? []),
  ]
    .map((s) => s.mbid)
    .filter((m): m is string => m != null);
  const { data: loreCounts } = useWpLoreCounts(allMbids);

  // Build replay seeds from all resolved spins (fromLibrary first, then newToYou).
  const replaySeeds = run
    ? [...run.fromLibrary, ...run.newToYou]
        .filter((s) => s.mbid != null && s.resolved)
        .map((s) => ({
          mbid: s.mbid!,
          title: s.title,
          artist: s.artist,
          artworkUrl: s.artworkUrl ?? null,
          links: [],
        }))
    : [];

  const handleGhostPlay = () => {
    if (!run || replaySeeds.length === 0) return;
    const label = `${run.station.name} · ${run.show?.name ?? "stream"} · ${run.day}`;
    ride.startReplay(replaySeeds, label, { timeOrientation: "past", context });
    onClose();
  };

  return (
    <>
      <div className="wp-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="wp wp-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Tonight's run"
        style={{ padding: 0 }}
        data-testid="run-drawer"
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "0.5px solid var(--wp-border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 400 }}>
              {run
                ? `${run.show?.name ?? run.station.name} · tonight's run`
                : isError
                  ? "Run unavailable"
                  : "Loading run…"}
            </p>
            {run && (
              <p style={{ margin: "3px 0 0", fontSize: 15, color: "var(--wp-text-secondary)" }}>
                {run.show?.djName && (
                  <>
                    selector {run.show.djName} <span style={{ color: "var(--wp-text-muted)" }}>· </span>
                  </>
                )}
                <span className="wp-mono" style={{ fontSize: 14 }}>
                  {run.station.name}
                </span>{" "}
                <span style={{ color: "var(--wp-text-muted)" }}>
                  · {run.spinCount} {run.spinCount === 1 ? "spin" : "spins"} so far
                </span>
              </p>
            )}
          </div>
          {run?.overlapPct != null && (
            <span
              className="wp-pill"
              style={{ background: "var(--wp-bg-success)", color: "var(--wp-text-success)" }}
            >
              {run.overlapPct}% taste overlap
            </span>
          )}
          {replaySeeds.length > 0 && (
            <button
              type="button"
              onClick={handleGhostPlay}
              title="Ghost radio — replay this run"
              aria-label="Ghost radio: replay this run"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 20,
                background: "var(--wp-bg-accent)",
                color: "var(--wp-text-accent)",
                fontSize: 14,
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Ghost size={13} aria-hidden="true" />
              Ghost radio
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ padding: 6, borderRadius: "50%", display: "flex" }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {isLoading && (
          <p style={{ padding: "16px 18px", color: "var(--wp-text-muted)", fontSize: 15 }}>
            Loading tonight's spins…
          </p>
        )}

        {isError && !isLoading && (
          <div style={{ padding: "16px 18px" }} data-testid="run-error">
            <p style={{ margin: "0 0 10px", color: "var(--wp-text-muted)", fontSize: 15 }}>
              Couldn't load this run — it may have been removed, or the
              connection dropped.
            </p>
            <button type="button" onClick={() => void refetch()} style={{ fontSize: 14 }}>
              Try again
            </button>
          </div>
        )}

        {/* From your library */}
        {run && run.fromLibrary.length > 0 && (
          <div style={{ padding: "14px 18px 6px" }}>
            <p
              className="wp-mono"
              style={{ margin: "0 0 8px", fontSize: 14, color: "var(--wp-text-muted)" }}
            >
              FROM YOUR LIBRARY · {run.fromLibrary.length}
            </p>
            {run.fromLibrary.map((s, i) => (
              <SpinRow
                key={`${s.playedAt}-${i}`}
                spin={s}
                stationSlug={run.station.slug}
                loreCount={loreCounts}
                onOpenLore={onOpenLore}
              />
            ))}
          </div>
        )}

        {/* New to you */}
        {run && run.newToYou.length > 0 && (
          <div style={{ padding: "10px 18px 16px" }}>
            <p
              className="wp-mono"
              style={{ margin: "0 0 8px", fontSize: 14, color: "var(--wp-text-muted)" }}
            >
              {run.authenticated ? "NEW TO YOU" : "TONIGHT"} · {run.newToYou.length}
            </p>
            {run.newToYou.map((s, i) => (
              <SpinRow
                key={`${s.playedAt}-${i}`}
                spin={s}
                stationSlug={run.station.slug}
                loreCount={loreCounts}
                onOpenLore={onOpenLore}
              />
            ))}
          </div>
        )}

        {run && run.fromLibrary.length === 0 && run.newToYou.length === 0 && !isLoading && (
          <p style={{ padding: "16px 18px", color: "var(--wp-text-muted)", fontSize: 15 }}>
            No spins logged for tonight yet.
          </p>
        )}

        {/* Selector trove */}
        {run?.trove && (run.trove.sharedCount > 0 || run.trove.deepCuts.length > 0) && (
          <div
            style={{
              background: "var(--wp-surface-1)",
              borderTop: "0.5px solid var(--wp-border)",
              padding: "14px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: run.trove.deepCuts.length > 0 ? 10 : 0,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "var(--wp-bg-accent)",
                  color: "var(--wp-text-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 400,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                {run.trove.selectorName
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <p style={{ margin: 0, fontSize: 15, color: "var(--wp-text-secondary)", flex: 1 }}>
                You and {run.trove.selectorName} share {run.trove.sharedCount} recordings.
                {run.trove.deepCuts.length > 0 &&
                  " Deeper in their stacks, past runs you haven't heard:"}
              </p>
            </div>
            {run.trove.deepCuts.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 10,
                }}
              >
                {run.trove.deepCuts.map((c) => (
                  <div
                    key={c.artist}
                    style={{
                      background: "var(--wp-surface-2)",
                      border: "0.5px solid var(--wp-border)",
                      borderRadius: "var(--wp-radius)",
                      padding: "10px 12px",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 400 }}>{c.artist}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 14, color: "var(--wp-text-muted)" }}>
                      spun {c.spinCount}x across {c.runCount} {c.runCount === 1 ? "run" : "runs"}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              style={{
                marginTop: 10,
                fontSize: 14,
                color: "var(--wp-text-accent)",
                background: "none",
                border: "0.5px solid var(--wp-border)",
                borderRadius: "var(--wp-radius)",
                padding: "5px 12px",
                cursor: "pointer",
              }}
            >
              Follow selector
            </button>
          </div>
        )}
      </div>
    </>
  );
}
