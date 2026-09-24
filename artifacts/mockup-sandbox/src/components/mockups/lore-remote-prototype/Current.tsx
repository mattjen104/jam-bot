import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./_group.css";

type FilterOption<V extends string> = { value: V; label: string; title: string };

const CROSSINGS_OPTIONS = [{
  value: "on",
  label: "Crossings on",
  title: "Rank the feed by stations crossing your artists; uncheck for plain radio",
}] as const;

function FilterDropdownMenu<V extends string>({
  label, ariaLabel, options, active, onToggle, variant,
}: {
  label: string;
  ariaLabel: string;
  options: readonly FilterOption<V>[];
  active: ReadonlySet<V>;
  onToggle: (value: V) => void;
  variant: "chips" | "bar";
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback((focus: boolean) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }, []);
  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      const rect = triggerRef.current?.getBoundingClientRect();
      setAnchor(rect ? { top: rect.bottom + 4, left: rect.left } : null);
      return true;
    });
  }, []);
  useLayoutEffect(() => {
    if (!open || !anchor || !panelRef.current) return;
    const width = panelRef.current.getBoundingClientRect().width;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    if (anchor.left > maxLeft) setAnchor({ top: anchor.top, left: maxLeft });
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open, close]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close(true);
    }
  };
  const count = active.size;
  return (
    <span ref={rootRef} className="filter-dropdown" onKeyDown={onKeyDown}>
      <button ref={triggerRef} type="button"
        className={`${variant === "chips" ? "home-cli-strip__filter-chip" : "dial-filter-bar__btn"} filter-dropdown__trigger${count ? " home-cli-strip__filter-chip--active" : ""}`}
        aria-haspopup="true" aria-expanded={open} onClick={toggleOpen}>
        {label}{count > 0 && <span className="filter-dropdown__count" aria-hidden="true">{` · ${count}`}</span>}
      </button>
      {createPortal(
        <div ref={panelRef} className="filter-dropdown__panel" role="group" aria-label={ariaLabel}
          hidden={!open} style={anchor ? { top: anchor.top, left: anchor.left } : undefined}>
          {options.map(({ value, label: optionLabel, title }) => (
            <label key={value} className="filter-dropdown__option" title={title}>
              <input type="checkbox" className="filter-dropdown__checkbox"
                checked={active.has(value)} onChange={() => onToggle(value)} />
              <span className="filter-dropdown__option-text">
                <span className="filter-dropdown__option-label">{optionLabel}</span>
                <span className="filter-dropdown__option-desc">{title}</span>
              </span>
            </label>
          ))}
        </div>, document.body,
      )}
    </span>
  );
}

/** The real Lore RadioRemoteBar, isolated with only routing and host state stubbed. */
export function Current() {
  const [radioMode, setRadioMode] = useState(false);
  const [routeNote, setRouteNote] = useState("");
  const crossingsActive = !radioMode;
  const toggleCrossings = useCallback(() => setRadioMode(crossingsActive), [crossingsActive]);
  return (
    <div className="lore-remote-preview">
      <div className="radio-remote-bar" role="toolbar" aria-label="Radio remote">
        <FilterDropdownMenu
          label="Crossings"
          ariaLabel="Crossings"
          options={CROSSINGS_OPTIONS}
          active={crossingsActive ? new Set(["on"]) : new Set<string>()}
          onToggle={toggleCrossings}
          variant="chips"
        />
        <div className="radio-remote-bar__group" role="group" aria-label="Navigation">
          <button type="button" className="home-cli-strip__btn home-cli-strip__home-btn home-cli-strip__home-btn--nav"
            aria-label="homepage /lore" onClick={() => setRouteNote("Routing to /")}>
            /lore
          </button>
        </div>
      </div>
      {routeNote && <span className="sr-only" role="status">{routeNote}</span>}
    </div>
  );
}