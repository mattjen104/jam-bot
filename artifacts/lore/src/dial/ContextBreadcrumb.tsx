/**
 * ContextBreadcrumb — "Lore / Dial / <Station> / …" for the context surface.
 *
 * Semantics (owned by the dialContext state machine, not playback):
 *   - Back  → pop one context level (temporal position preserved).
 *   - Dial  → return to station selection WITHOUT stopping audio.
 *   - The station crumb carries a temporal marker when the context is
 *     scrubbed into the past; tapping the marker returns to live. Time is a
 *     modifier on the station frame, never its own crumb.
 */
import type { ContextDescriptor, ContextFrame } from "./dialContext";

export interface ContextBreadcrumbProps {
  ctx: ContextDescriptor;
  /** Resolve a display label for a frame (falls back to frame.label / id). */
  frameLabel?: (frame: ContextFrame) => string | null | undefined;
  onBack: () => void;
  onDial: () => void;
  /** Tap the past marker on the station crumb to return to live. */
  onReturnToLive?: () => void;
}

export function ContextBreadcrumb({ ctx, frameLabel, onBack, onDial, onReturnToLive }: ContextBreadcrumbProps) {
  const label = (frame: ContextFrame) => frameLabel?.(frame) ?? frame.label ?? frame.id;
  const isPast = ctx.temporal.kind === "past";
  return (
    <nav className="dial-crumbs" aria-label="Context breadcrumb">
      <span className="dial-crumbs__root">Lore</span>
      <span className="dial-crumbs__sep" aria-hidden="true">/</span>
      <button type="button" className="dial-crumbs__crumb dial-crumbs__dial" onClick={onDial}>
        Dial
      </button>
      {ctx.stack.map((frame, i) => (
        <span key={`${frame.kind}:${frame.id}`} className="dial-crumbs__item">
          <span className="dial-crumbs__sep" aria-hidden="true">/</span>
          <span
            className={`dial-crumbs__crumb${i === ctx.stack.length - 1 ? " dial-crumbs__crumb--current" : ""}`}
          >
            {label(frame)}
          </span>
          {i === 0 && isPast && (
            <button
              type="button"
              className="dial-crumbs__past-marker"
              aria-label="Scrubbed into the past — return to live"
              title="Return to live"
              onClick={onReturnToLive}
            >
              ⏮ past
            </button>
          )}
        </span>
      ))}
      <button type="button" className="dial-crumbs__back" onClick={onBack} aria-label="Back one level">
        ↑ Back
      </button>
    </nav>
  );
}
