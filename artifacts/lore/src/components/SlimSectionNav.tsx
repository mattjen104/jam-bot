import { useLocation } from "wouter";

type Section = "radio" | "selectors" | "library";

export function sectionFor(location: string): Section {
  if (location === "/selectors" || location.startsWith("/selectors/") ||
      location.startsWith("/archive/selectors") ||
      location.startsWith("/archive/selector-runs") ||
      location.startsWith("/archive/picker")) return "selectors";
  if (location === "/library" || location.startsWith("/library/") ||
      location === "/journal" || location.startsWith("/journal/") ||
      location === "/following" || location.startsWith("/following/")) return "library";
  return "radio";
}

/**
 * Slim text-only section nav — RADIO / SELECTORS / LIBRARY.
 * The record-sleeve bottom nav (RecordPeekNav) is hidden for now; these
 * buttons live in the size-reactive space around the maximized album art
 * (overlaid across the top of the art on the front door, a top bar on
 * other sections).
 */
export function SlimSectionNav({ overlay = false }: { overlay?: boolean }) {
  const [location, setLocation] = useLocation();
  const activeSection = sectionFor(location);
  return (
    <nav
      className={`slim-nav${overlay ? " slim-nav--overlay" : ""}`}
      aria-label="Primary"
    >
      {(["radio", "selectors", "library"] as Section[]).map((section) => {
        const active = activeSection === section;
        const label = section === "radio" ? "Radio" : section === "selectors" ? "Selectors" : "Library";
        return (
          <button
            key={section}
            type="button"
            className={`slim-nav__btn${active ? " slim-nav__btn--active" : ""}`}
            data-section={section}
            aria-current={active ? "page" : undefined}
            onClick={() => setLocation(section === "radio" ? "/" : `/${section}`)}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
