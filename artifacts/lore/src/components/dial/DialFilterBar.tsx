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

import type { AgeTier } from "../../lib/dialAgeFilter";

export type { AgeTier };
export type StationCategory = "lore" | "classics" | "ambient";

export interface DialFilterBarProps {
  activeTiers: Set<AgeTier>;
  activeCategories: Set<StationCategory>;
  onToggleTier: (tier: AgeTier) => void;
  onToggleCategory: (cat: StationCategory) => void;
}

const AGE_LABELS: { tier: AgeTier; label: string; title: string }[] = [
  { tier: "first", label: "First", title: "First-ever play of this recording on any Lore station" },
  { tier: "current", label: "Current", title: "Released within the last 18 months" },
  { tier: "catalog", label: "Catalog", title: "Released 18–60 months ago" },
  { tier: "deep", label: "Deep", title: "Released 60+ months ago" },
];

const CAT_LABELS: { cat: StationCategory; label: string; title: string }[] = [
  { cat: "lore", label: "Lore", title: "The normal curated Dial" },
  { cat: "classics", label: "Classics", title: "Era/genre stations — decade radio, oldies, genre channels" },
  { cat: "ambient", label: "Ambient", title: "Sleep, nature, and ambient stations" },
];

export function DialFilterBar({
  activeTiers,
  activeCategories,
  onToggleTier,
  onToggleCategory,
}: DialFilterBarProps) {
  return (
    <div className="dial-filter-bar" role="group" aria-label="Dial filters">
      {/* Left: song-age filters */}
      <div className="dial-filter-bar__group" role="group" aria-label="Song age">
        {AGE_LABELS.map(({ tier, label, title }, i) => (
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
        {CAT_LABELS.map(({ cat, label, title }, i) => (
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
