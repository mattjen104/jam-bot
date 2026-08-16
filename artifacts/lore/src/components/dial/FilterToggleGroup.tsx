/**
 * FilterToggleGroup — single source of truth for the Dial's filter toggle
 * buttons (age tiers + station categories), shared by the full-Dial
 * DialFilterBar and the SplitHome RadioRemoteBar.
 *
 * Renders one `role="group"` of toggle buttons. Every button always carries
 * aria-pressed (true/false, never absent). Two visual variants:
 *   - "bar"   — pipe-separated underline buttons (full Dial topbar style)
 *   - "chips" — bordered console chips (SplitHome remote style)
 *
 * Selection semantics (additive vs single-select-clearable) live upstream in
 * dialFilterState; this component only reports clicks.
 */

export interface FilterToggleOption<V extends string> {
  value: V;
  /** Visible button text. */
  label: string;
  /** Tooltip / long description. */
  title: string;
}

export interface FilterToggleGroupProps<V extends string> {
  ariaLabel: string;
  options: readonly FilterToggleOption<V>[];
  active: ReadonlySet<V>;
  onToggle: (value: V) => void;
  variant: "bar" | "chips";
  className?: string;
}

export function FilterToggleGroup<V extends string>({
  ariaLabel,
  options,
  active,
  onToggle,
  variant,
  className,
}: FilterToggleGroupProps<V>) {
  if (variant === "chips") {
    return (
      <div className={className ?? "radio-remote-bar__group"} role="group" aria-label={ariaLabel}>
        {options.map(({ value, label, title }) => {
          const isActive = active.has(value);
          return (
            <button
              key={value}
              type="button"
              className={`home-cli-strip__filter-chip${isActive ? " home-cli-strip__filter-chip--active" : ""}`}
              aria-pressed={isActive}
              title={title}
              onClick={() => onToggle(value)}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`dial-filter-bar__group${className ? ` ${className}` : ""}`} role="group" aria-label={ariaLabel}>
      {options.map(({ value, label, title }, i) => {
        const isActive = active.has(value);
        return (
          <span key={value} className="dial-filter-bar__item">
            {i > 0 && <span className="dial-topbar__sep" aria-hidden="true">|</span>}
            <button
              type="button"
              className={`dial-filter-bar__btn${isActive ? " dial-filter-bar__btn--on" : ""}`}
              aria-pressed={isActive}
              title={title}
              onClick={() => onToggle(value)}
            >
              {label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
