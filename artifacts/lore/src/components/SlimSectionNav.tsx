import { Link, useLocation } from "wouter";

type Section = "lore" | "library";

export function sectionFor(location: string): Section {
  if (location === "/library" || location.startsWith("/library/") ||
      location === "/journal" || location.startsWith("/journal/") ||
      location === "/sets" || location.startsWith("/sets/") ||
      location === "/following" || location.startsWith("/following/")) return "library";
  // Everything else — including selector/archive/DJ pages — is part of the
  // Lore listening surface.
  return "lore";
}

/**
 * Bottom-corner section nav — [lore] pinned bottom-left, [my library] pinned
 * bottom-right on every Lore route including the front door. The links are
 * plain text hyperlinks (square brackets included) layered above the page
 * content and directly above the bottom shell, so they never collide with
 * the player dock or the maximized hero art.
 */
export function SlimSectionNav() {
  const [location] = useLocation();
  const activeSection = sectionFor(location);
  return (
    <nav className="corner-nav" aria-label="Primary">
      {(["lore", "library"] as Section[]).map((section) => {
        const active = activeSection === section;
        const label = section === "lore" ? "[lore]" : "[my library]";
        return (
          <Link
            key={section}
            href={section === "lore" ? "/" : "/library"}
            className={`corner-nav__link corner-nav__link--${section === "lore" ? "left" : "right"}${active ? " corner-nav__link--active" : ""}`}
            data-section={section}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
