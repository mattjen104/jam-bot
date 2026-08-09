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
 * Section nav — the [lore] / [my library] plain-text hyperlinks.
 *
 * Two placements share one component:
 *  - variant="corner" (default): fixed bottom-corner links layered above the
 *    page content and directly above the bottom shell — the desktop treatment.
 *    CSS hides this variant at phone widths.
 *  - variant="bottom": a Spotify-style nav row rendered *inside* the fixed
 *    bottom shell, below the mini player, at the very bottom of the screen.
 *    CSS shows this variant only at phone widths.
 *
 * Same links, same targets — only the placement differs.
 */
export function SlimSectionNav({ variant = "corner" }: { variant?: "corner" | "bottom" }) {
  const [location] = useLocation();
  const activeSection = sectionFor(location);
  if (variant === "bottom") {
    return (
      <nav className="bottom-nav" aria-label="Primary">
        {(["lore", "library"] as Section[]).map((section) => {
          const active = activeSection === section;
          const label = section === "lore" ? "[lore]" : "[my library]";
          return (
            <Link
              key={section}
              href={section === "lore" ? "/" : "/library"}
              className={`bottom-nav__link${active ? " bottom-nav__link--active" : ""}`}
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
