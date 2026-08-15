/**
 * LandingConfirmationNote — quiet handoff status for a station landing.
 *
 * Renders the honest, non-blocking metadata-confirmation states from the
 * station-landing fast lane (useStationFastLane):
 *
 *   confirming  → "checking live metadata…"     (bounded window still open)
 *   unconfirmed → "live metadata may be delayed" (window elapsed — soft, never
 *                  negative; resolves itself when data arrives later)
 *   confirmed   → renders nothing (clears any hint, including the stale
 *                  "may be delayed" indicator from the freshness pass)
 *
 * Only the currently tuned station's landing is shown — a stale confirmation
 * for a station the listener has since left renders nothing. No spinners,
 * no wording that claims "no match" or "nothing playing": playback and the
 * last known track are never touched by this component.
 */
import { type LandingConfirmation } from "../../hooks/useStationFastLane";

export function LandingConfirmationNote({
  confirmation,
  activeSlug,
}: {
  confirmation: LandingConfirmation | null;
  /** Slug of the station currently sounding, or null when nothing plays. */
  activeSlug: string | null;
}) {
  if (!confirmation) return null;
  if (activeSlug == null || confirmation.slug !== activeSlug) return null;
  if (confirmation.phase === "confirmed") return null;
  const text =
    confirmation.phase === "confirming"
      ? "checking live metadata…"
      : "live metadata may be delayed";
  return (
    <p
      className="dial-landing-note"
      data-testid="dial-landing-note"
      data-phase={confirmation.phase}
      aria-live="polite"
    >
      {text}
    </p>
  );
}
