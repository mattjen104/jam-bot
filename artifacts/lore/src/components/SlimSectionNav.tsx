import { Link, useLocation } from "wouter";
import { useSleepMode, recordWordmarkTap } from "../lib/sleepMode";

type Section = "now" | "feed" | "stack";

export function sectionFor(location: string): Section {
  const path = location.split("?")[0] ?? location;
  if (path === "/library" || path.startsWith("/library/") ||
      path === "/journal" || path.startsWith("/journal/") ||
      path === "/sets" || path.startsWith("/sets/") ||
      path === "/following" || path.startsWith("/following/")) return "stack";
  if (path === "/feed" || path.startsWith("/feed/") ||
      path === "/heard" || path.startsWith("/heard/") ||
      path === "/index" || path.startsWith("/index/") ||
      path === "/stations" || path.startsWith("/stations/")) return "feed";
  return "now";
}

/**
 * Section nav — the Now / Explore / Stack plain-text hyperlinks.
 *
 * Two placements share one component:
 *  - variant="corner" (default): fixed bottom-corner links layered above the
 *    page content and directly above the bottom shell — the desktop treatment.
 *    CSS hides this variant at phone widths.
 *  - variant="bottom": a Spotify-style nav row rendered *inside* the fixed
 *    bottom shell, below the mini player, at the very bottom of the screen.
 *    CSS shows this variant only at phone widths.
 *
 * The same three jobs are available on every route; only the placement differs.
 *
 * The [lore] wordmark carries an unadvertised gesture: five taps within
 * three seconds toggle Sleep Radio mode (see lib/sleepMode.ts). While the
 * mode is active a small moon glyph renders beside the wordmark; tapping
 * the moon deactivates the mode.
 */
export function SlimSectionNav({
  variant = "corner",
}: {
  variant?: "corner" | "bottom";
  showArchiveNav?: boolean;
}) {
  const [location] = useLocation();
  const activeSection = sectionFor(location);
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
        {(["now", "feed", "stack"] as Section[]).map((section) => {
          const active = activeSection === section;
          const label = section === "now" ? "Now" : section === "feed" ? "Explore" : "Stack";
          return (
            <Link
              key={section}
              href={section === "now" ? "/" : section === "feed" ? "/feed" : "/library"}
              className={`bottom-nav__link${active ? " bottom-nav__link--active" : ""}`}
              data-section={section}
              aria-current={active ? "page" : undefined}
              onClick={section === "now" ? () => { recordWordmarkTap(); } : undefined}
            >
              {label}
              {section === "now" ? moon : null}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav className="corner-nav" aria-label="Primary">
      {(["now", "feed", "stack"] as Section[]).map((section) => {
        const active = activeSection === section;
        const label = section === "now" ? "Now" : section === "feed" ? "Explore" : "Stack";
        return (
          <Link
            key={section}
            href={section === "now" ? "/" : section === "feed" ? "/feed" : "/library"}
            className={`corner-nav__link corner-nav__link--${section === "now" ? "left" : "right"}${active ? " corner-nav__link--active" : ""}`}
            data-section={section}
            aria-current={active ? "page" : undefined}
            onClick={section === "now" ? () => { recordWordmarkTap(); } : undefined}
          >
            {label}
            {section === "now" ? moon : null}
          </Link>
        );
      })}
    </nav>
  );
}
