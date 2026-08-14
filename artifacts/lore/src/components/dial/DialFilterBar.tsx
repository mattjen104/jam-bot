/**
 * DialFilterBar — two additive toggle menus above the Dial's live feed.
 *
 * Left menu: song-age filters (First | Current | Catalog | Deep)
 * Right menu: station-category filters (Lore | Classics | Ambient)
 *
 * Both menus use the same pipe-separated button style as the rest of the Dial
 * topbar. Active buttons get a solid 1px bottom underline.
 *
 * Pure presentational: filter state is managed by DialView.
 */

import {
  AGE_TIER_DEFINITIONS,
  type AgeTier,
} from "../../lib/dialAgeFilter";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../../lib/dialCategories";

export type { AgeTier };
export type { StationCategory };

export interface DialFilterBarProps {
  activeTiers: Set<AgeTier>;
  activeCategories: Set<StationCategory>;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
  className?: string;
}

export function DialFilterBar({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
  className,
}: DialFilterBarProps) {
  return (
    <div className={`dial-filter-bar${className ? ` ${className}` : ""}`} role="group" aria-label="Dial filters">
      {/* Left: song-age filters */}
      <div className="dial-filter-bar__group" role="group" aria-label="Song age">
        {AGE_TIER_DEFINITIONS.map(({ tier, label, title }, i) => (
          <span key={tier} className="dial-filter-bar__item">
            {i > 0 && <span className="dial-topbar__sep" aria-hidden="true">|</span>}
            <button
              type="button"
              className={`dial-filter-bar__btn${activeTiers.has(tier) ? " dial-filter-bar__btn--on" : ""}`}
              aria-pressed={activeTiers.has(tier)}
              title={title}
              onClick={() => onToggleTier(tier)}
            >
              {label}
            </button>
          </span>
        ))}
      </div>

      {/* Right: station-category filters */}
      <div className="dial-filter-bar__group dial-filter-bar__group--right" role="group" aria-label="Station category">
        {STATION_CATEGORY_DEFINITIONS.map(({ cat, label, title }, i) => (
          <span key={cat} className="dial-filter-bar__item">
            {i > 0 && <span className="dial-topbar__sep" aria-hidden="true">|</span>}
            <button
              type="button"
              className={`dial-filter-bar__btn${activeCategories.has(cat) ? " dial-filter-bar__btn--on" : ""}`}
              aria-pressed={activeCategories.has(cat)}
              title={title}
              onClick={() => onToggleCategory(cat)}
            >
              {label}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
