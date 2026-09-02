import { Link, useLocation } from "wouter";
import { useSleepMode, recordWordmarkTap } from "../lib/sleepMode";

type Section = "lore" | "heard" | "library" | "index";

export function sectionFor(location: string): Section {
  const path = location.split("?")[0] ?? location;
  if (path === "/index" || path.startsWith("/index/")) return "index";
  if (path === "/library" || path.startsWith("/library/") ||
      path === "/journal" || path.startsWith("/journal/") ||
      path === "/sets" || path.startsWith("/sets/") ||
      path === "/following" || path.startsWith("/following/")) return "library";
  if (path === "/heard" || path.startsWith("/heard/")) return "heard";
  // Everything else — including selector/archive/DJ pages — is part of the
  // Lore listening surface.
  return "lore";
}

/**
 * Section nav — the Feed / Heard / Stack / Index plain-text hyperlinks.
 *
 * Two placements share one component:
 *  - variant="corner" (default): fixed bottom-corner links layered above the
 *    page content and directly above the bottom shell — the desktop treatment.
 *    CSS hides this variant at phone widths.
 *  - variant="bottom": a Spotify-style nav row rendered *inside* the fixed
 *    bottom shell, below the mini player, at the very bottom of the screen.
 *    CSS shows this variant only at phone widths.
 *
 * Same four links, same targets — only the placement differs.
 *
 * The [lore] wordmark carries an unadvertised gesture: five taps within
 * three seconds toggle Sleep Radio mode (see lib/sleepMode.ts). While the
 * mode is active a small moon glyph renders beside the wordmark; tapping
 * the moon deactivates the mode.
 */
export function SlimSectionNav({
  variant = "corner",
  showArchiveNav = true,
}: {
  variant?: "corner" | "bottom";
  showArchiveNav?: boolean;
}) {
  const [location] = useLocation();
  const activeSection = sectionFor(location);
  // On the split homepage the Feed label expands the Dial to the full
  // scrollable view (/feed); from anywhere else it returns home as before.
  const onSplitHome = location === "/" || location === "";
  const loreHref = onSplitHome ? "/feed" : "/";
  const { enabled: sleepEnabled, toggle: toggleSleep } = useSleepMode();
  const moon = sleepEnabled ? (
    <button
      type="button"
      className="sleep-moon-indicator"
      aria-label="Sleep Radio active — tap to exit"
      title="Sleep Radio"
      data-testid="sleep-moon"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSleep();
      }}
    >
      ☾
    </button>
  ) : null;
  if (variant === "bottom") {
    return (
      <nav className="bottom-nav" aria-label="Primary">
        {(["lore", "heard", "library", "index"] as Section[]).filter((section) => showArchiveNav || (section !== "heard" && section !== "index")).map((section) => {
          const active = activeSection === section;
          const label = section === "lore" ? "Feed" : section === "heard" ? "Heard" : section === "library" ? "Stack" : "Index";
          return (
            <Link
              key={section}
              href={section === "lore" ? loreHref : section === "heard" ? "/heard" : section === "library" ? "/library" : "/index"}
              className={`bottom-nav__link${active ? " bottom-nav__link--active" : ""}`}
              data-section={section}
              aria-current={active ? "page" : undefined}
              onClick={section === "lore" ? () => { recordWordmarkTap(); } : undefined}
            >
              {label}
              {section === "lore" ? moon : null}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav className="corner-nav" aria-label="Primary">
      {(["lore", "heard", "library", "index"] as Section[]).filter((section) => showArchiveNav || (section !== "heard" && section !== "index")).map((section) => {
        const active = activeSection === section;
        const label = section === "lore" ? "Feed" : section === "heard" ? "Heard" : section === "library" ? "Stack" : "Index";
        return (
          <Link
            key={section}
            href={section === "lore" ? loreHref : section === "heard" ? "/heard" : section === "library" ? "/library" : "/index"}
            className={`corner-nav__link corner-nav__link--${section === "lore" ? "left" : "right"}${active ? " corner-nav__link--active" : ""}`}
            data-section={section}
            aria-current={active ? "page" : undefined}
            onClick={section === "lore" ? () => { recordWordmarkTap(); } : undefined}
          >
            {label}
            {section === "lore" ? moon : null}
          </Link>
        );
      })}
    </nav>
  );
}
