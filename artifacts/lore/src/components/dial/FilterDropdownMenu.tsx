/**
 * FilterDropdownMenu — one collapsible filter family for the Dial: a trigger
 * button (family name + active-count badge) and a dropdown panel of labeled
 * checkboxes. Shared by the full-Dial DialFilterBar and the SplitHome
 * RadioRemoteBar so the two surfaces can never drift.
 *
 * Interaction contract:
 *   - Trigger carries aria-haspopup="true" + aria-expanded.
 *   - Clicking the trigger toggles the panel; clicking anywhere outside or
 *     pressing Escape closes it (Escape returns focus to the trigger).
 *   - The panel stays mounted when closed (`hidden`, i.e. display:none) so it
 *     is never detached from the DOM; it only becomes visible when open.
 *   - Every option row is a <label> wrapping an <input type="checkbox">, so
 *     the visible text IS the control's label.
 *   - The panel is position:fixed (anchored to the trigger's bounding rect)
 *     so it is never clipped by the remote bar's horizontal scroll container.
 *
 * Selection semantics (additive toggles, the crossings boolean) live upstream
 * in dialFilterState; this component only reports toggles.
 *
 * Two trigger variants match the surrounding chrome:
 *   - "bar"   — pipe-style underline button (full Dial filter bar)
 *   - "chips" — bordered console key (SplitHome remote)
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface FilterDropdownOption<V extends string> {
  value: V;
  /** Visible checkbox label. */
  label: string;
  /** Longer description — rendered under the label and used as the tooltip. */
  title: string;
}

export interface FilterDropdownMenuProps<V extends string> {
  /** Family name shown on the trigger ("Crossings", "Track age", …). */
  label: string;
  /** Accessible name for the panel's role="group". */
  ariaLabel: string;
  options: readonly FilterDropdownOption<V>[];
  active: ReadonlySet<V>;
  onToggle: (value: V) => void;
  variant: "bar" | "chips";
  className?: string;
}

export function FilterDropdownMenu<V extends string>({
  label,
  ariaLabel,
  options,
  active,
  onToggle,
  variant,
  className,
}: FilterDropdownMenuProps<V>) {
  const [open, setOpen] = useState(false);
  // Fixed-position anchor for the panel, captured from the trigger rect when
  // the menu opens (both bars are pinned chrome, so the anchor never drifts).
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false;
      const rect = triggerRef.current?.getBoundingClientRect();
      setAnchor(rect ? { top: rect.bottom + 4, left: rect.left } : null);
      return true;
    });
  }, []);

  // Click-outside closes the menu. The listener only exists while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      if (rootRef.current && ev.target instanceof Node && !rootRef.current.contains(ev.target)) {
        close(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open, close]);

  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      if (ev.key === "Escape" && open) {
        ev.stopPropagation();
        close(true);
      }
    },
    [open, close],
  );

  const count = active.size;
  const triggerClass =
    variant === "chips"
      ? `home-cli-strip__filter-chip filter-dropdown__trigger${count > 0 ? " home-cli-strip__filter-chip--active" : ""}`
      : `dial-filter-bar__btn filter-dropdown__trigger${count > 0 ? " dial-filter-bar__btn--on" : ""}`;

  return (
    <span
      ref={rootRef}
      className={`filter-dropdown${className ? ` ${className}` : ""}`}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {label}
        {count > 0 && (
          <span className="filter-dropdown__count" aria-hidden="true">
            {` · ${count}`}
          </span>
        )}
      </button>
      <div
        className="filter-dropdown__panel"
        role="group"
        aria-label={ariaLabel}
        hidden={!open}
        style={anchor ? { top: anchor.top, left: anchor.left } : undefined}
      >
        {options.map(({ value, label: optionLabel, title }) => (
          <label key={value} className="filter-dropdown__option" title={title}>
            <input
              type="checkbox"
              className="filter-dropdown__checkbox"
              checked={active.has(value)}
              onChange={() => onToggle(value)}
            />
            <span className="filter-dropdown__option-text">
              <span className="filter-dropdown__option-label">{optionLabel}</span>
              <span className="filter-dropdown__option-desc">{title}</span>
            </span>
          </label>
        ))}
      </div>
    </span>
  );
}
