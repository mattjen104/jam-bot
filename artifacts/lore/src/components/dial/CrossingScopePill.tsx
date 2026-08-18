/**
 * CrossingScopePill — the global crossing-scope control rendered next to the
 * crossings toggle on both front-door surfaces (SplitHome's CLI strip and the
 * full Dial's filter bar).
 *
 * Tapping cycles the scope: now → this set → 24h → 7d → lifetime → now.
 * The pill is disabled (grayed) when crossings are off — scope only has
 * meaning while crossing evidence is being shown.
 */
import {
  type CrossingScope,
  crossingScopeLabel,
  nextCrossingScope,
} from "../../lib/crossingScope";

export interface CrossingScopePillProps {
  scope: CrossingScope;
  /** Whether crossings are on (the pill is inert/grayed when off). */
  enabled: boolean;
  onCycle: () => void;
  className?: string;
}

export function CrossingScopePill({ scope, enabled, onCycle, className }: CrossingScopePillProps) {
  const label = crossingScopeLabel(scope);
  return (
    <button
      type="button"
      className={`crossing-scope-pill${enabled ? "" : " crossing-scope-pill--disabled"}${className ? ` ${className}` : ""}`}
      disabled={!enabled}
      aria-label={`Crossing scope: ${label}. Tap to switch to ${crossingScopeLabel(nextCrossingScope(scope))}`}
      title="Cycle crossing scope"
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
    >
      {label} ▾
    </button>
  );
}
