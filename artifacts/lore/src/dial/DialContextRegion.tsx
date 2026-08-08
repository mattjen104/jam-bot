/**
 * DialContextRegion — the container that replaces the station list once the
 * surface enters context mode.
 *
 * Takes a GENERIC context descriptor (source kind + stack) rather than
 * radio-specific props, so future non-radio sources (review summaries, …)
 * can drive the same region. Renders the breadcrumb, the current summary
 * (one sentence / the tuned panel supplied by the caller), and the space
 * reserved for the context rail (content lands in the next task).
 *
 * This component never touches playback.
 */
import type { ReactNode } from "react";
import type { ContextDescriptor, ContextFrame } from "./dialContext";
import { ContextBreadcrumb } from "./ContextBreadcrumb";

export interface DialContextRegionProps {
  ctx: ContextDescriptor;
  frameLabel?: (frame: ContextFrame) => string | null | undefined;
  onBack: () => void;
  onDial: () => void;
  onReturnToLive?: () => void;
  /** The current summary sentence / tuned panel for the root frame. */
  summary?: ReactNode;
  /**
   * Quiet mode — everything the breadcrumb + rail would show is placeholder
   * (see railHasRealContent). The breadcrumb strip collapses to a single
   * minimal back affordance and the rail's reserved space is released; the
   * summary (the now-playing row) still renders.
   */
  quiet?: boolean;
  /** Subpanel content — the rail. Placeholder until the rail task lands. */
  children?: ReactNode;
}

export function DialContextRegion({
  ctx,
  frameLabel,
  onBack,
  onDial,
  onReturnToLive,
  summary,
  quiet = false,
  children,
}: DialContextRegionProps) {
  return (
    <section className="dial-context-region" aria-label="Tuned context" data-context-source={ctx.source}>
      {quiet ? (
        <button
          type="button"
          className="dial-crumbs__back dial-crumbs__back--solo"
          onClick={onBack}
          aria-label="Back to the dial"
        >
          ↑ Back
        </button>
      ) : (
        <ContextBreadcrumb
          ctx={ctx}
          frameLabel={frameLabel}
          onBack={onBack}
          onDial={onDial}
          onReturnToLive={onReturnToLive}
        />
      )}
      {summary != null && <div className="dial-context-region__summary">{summary}</div>}
      <div className={`dial-context-region__rail${quiet ? " dial-context-region__rail--quiet" : ""}`}>
        {children}
      </div>
    </section>
  );
}
