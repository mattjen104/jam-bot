import { useLocation } from "wouter";

type Section = "lore" | "library";

export function sectionFor(location: string): Section {
  if (location === "/library" || location.startsWith("/library/") ||
      location === "/journal" || location.startsWith("/journal/") ||
      location === "/following" || location.startsWith("/following/")) return "library";
  // Everything else — including selector/archive/DJ pages — is part of the
  // Lore listening surface.
  return "lore";
}

/**
 * Slim text-only section nav — LORE / MY LIBRARY.
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
      {(["lore", "library"] as Section[]).map((section) => {
        const active = activeSection === section;
        const label = section === "lore" ? "Lore" : "My Library";
        return (
          <button
            key={section}
            type="button"
            className={`slim-nav__btn${active ? " slim-nav__btn--active" : ""}`}
            data-section={section}
            aria-current={active ? "page" : undefined}
            onClick={() => setLocation(section === "lore" ? "/" : "/library")}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
