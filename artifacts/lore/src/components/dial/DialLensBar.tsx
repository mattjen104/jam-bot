/**
 * DialLensBar — Explore's view toggle: Rooms | Press | Shows | Scan.
 *
 * Lenses are exclusive views over the same feed surface. Same pipe-separated
 * button style as the filter bar, same aria-pressed semantics. Unlike the
 * filter menus these are radio buttons in behavior — exactly one lens is active
 * — but they keep the toggle-button anatomy so keyboard users get the identical
 * affordance.
 *
 * Pure presentational: lens state is owned by DialView (persisted locally
 * via dialLensState).
 */

import type { DialLens } from "../../lib/dialLensState";

export interface DialLensBarProps {
  lens: DialLens;
  onSetLens: (lens: DialLens) => void;
  className?: string;
  /**
   * The /radio blank-radio sub-state of the Radio lens (crossings
   * suppressed). No new button — when active, the Radio label carries a
   * dimmed "· pure" suffix so the mode is visible where the lens is.
   */
  radioMode?: boolean;
  onOpenScan?: () => void;
}

const LENS_LABELS: { lens: DialLens; label: string; title: string }[] = [
  { lens: "radio", label: "Rooms", title: "Live stations worth entering now" },
  { lens: "press", label: "Press", title: "Blog picks, best-of lists, and liner claims mentioning your Stack" },
  { lens: "shows", label: "Shows", title: "Upcoming concerts for artists in your Stack" },
  { lens: "scan", label: "Scan", title: "Browse every category at a glance" },
];

export function DialLensBar({ lens, onSetLens, className, radioMode = false, onOpenScan }: DialLensBarProps) {
  return (
    <div
      className={`dial-filter-bar dial-lens-bar${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="Explore view"
    >
      <div className="dial-filter-bar__group">
        {LENS_LABELS.map(({ lens: l, label, title }, i) => (
          <span key={l} className="dial-filter-bar__item">
            {i > 0 && <span className="dial-topbar__sep" aria-hidden="true">|</span>}
            <button
              type="button"
              className={`dial-filter-bar__btn${lens === l ? " dial-filter-bar__btn--on" : ""}`}
              aria-pressed={lens === l}
              title={title}
              onClick={() => {
                onSetLens(l);
                if (l === "scan") onOpenScan?.();
              }}
            >
              {label}
              {l === "radio" && lens === "radio" && radioMode && (
                <span className="dial-lens-bar__pure" aria-hidden="true"> · all</span>
              )}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
