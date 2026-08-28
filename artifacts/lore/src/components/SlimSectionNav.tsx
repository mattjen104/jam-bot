import { Link, useLocation } from "wouter";
import { useSleepMode, recordWordmarkTap } from "../lib/sleepMode";
import {
  useEraGenreMode,
  recordWordmarkPressStart,
  recordWordmarkPressEnd,
} from "../lib/eraGenreMode";

type Section = "lore" | "heard" | "library";

export function sectionFor(location: string): Section {
  if (location === "/library" || location.startsWith("/library/") ||
      location === "/journal" || location.startsWith("/journal/") ||
      location === "/sets" || location.startsWith("/sets/") ||
      location === "/following" || location.startsWith("/following/")) return "library";
  if (location === "/heard" || location.startsWith("/heard/")) return "heard";
  // Everything else — including selector/archive/DJ pages — is part of the
  // Lore listening surface.
  return "lore";
}

/**
 * Section nav — the Feed / Heard / Stack plain-text hyperlinks.
 *
 * Two placements share one component:
 *  - variant="corner" (default): fixed bottom-corner links layered above the
 *    page content and directly above the bottom shell — the desktop treatment.
 *    CSS hides this variant at phone widths.
 *  - variant="bottom": a Spotify-style nav row rendered *inside* the fixed
 *    bottom shell, below the mini player, at the very bottom of the screen.
 *    CSS shows this variant only at phone widths.
 *
 * Same three links, same targets — only the placement differs.
 *
 * The [lore] wordmark carries an unadvertised gesture: five taps within
 * three seconds toggle Sleep Radio mode (see lib/sleepMode.ts). While the
 * mode is active a small moon glyph renders beside the wordmark; tapping
 * the moon deactivates the mode.
 */
export function SlimSectionNav({ variant = "corner" }: { variant?: "corner" | "bottom" }) {
  const [location] = useLocation();
  const activeSection = sectionFor(location);
  // On the split homepage the Feed label expands the Dial to the full
  // scrollable view (/feed); from anywhere else it returns home as before.
  const onSplitHome = location === "/" || location === "";
  const loreHref = onSplitHome ? "/feed" : "/";
  const { enabled: sleepEnabled, toggle: toggleSleep } = useSleepMode();
  const { enabled: eraGenreEnabled, toggle: toggleEraGenre } = useEraGenreMode();
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
  const vinyl = eraGenreEnabled ? (
    <button
      type="button"
      className="era-genre-indicator"
      aria-label="Era/Genre radio active — tap to exit"
      title="Era/Genre radio"
      data-testid="era-genre-vinyl"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleEraGenre();
      }}
    >
      ◉
    </button>
  ) : null;
  // Long-press on the [lore] wordmark toggles era/genre mode — distinct from
  // the five-tap sleep gesture. Both attach to the same wordmark link.
  const pressHandlers = {
    onPointerDown: () => { recordWordmarkPressStart(); },
    onPointerUp: () => { recordWordmarkPressEnd(); },
    onPointerLeave: () => { recordWordmarkPressEnd(); },
  } as const;
  if (variant === "bottom") {
    return (
      <nav className="bottom-nav" aria-label="Primary">
        {(["lore", "heard", "library"] as Section[]).map((section) => {
          const active = activeSection === section;
          const label = section === "lore" ? "Feed" : section === "heard" ? "Heard" : "Stack";
          return (
            <Link
              key={section}
              href={section === "lore" ? loreHref : section === "heard" ? "/heard" : "/library"}
              className={`bottom-nav__link${active ? " bottom-nav__link--active" : ""}`}
              data-section={section}
              aria-current={active ? "page" : undefined}
              onClick={section === "lore" ? () => { recordWordmarkTap(); } : undefined}
              {...(section === "lore" ? pressHandlers : {})}
            >
              {label}
              {section === "lore" ? moon : null}
              {section === "lore" ? vinyl : null}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav className="corner-nav" aria-label="Primary">
      {(["lore", "heard", "library"] as Section[]).map((section) => {
        const active = activeSection === section;
        const label = section === "lore" ? "Feed" : section === "heard" ? "Heard" : "Stack";
        return (
          <Link
            key={section}
            href={section === "lore" ? loreHref : section === "heard" ? "/heard" : "/library"}
            className={`corner-nav__link corner-nav__link--${section === "lore" ? "left" : "right"}${active ? " corner-nav__link--active" : ""}`}
            data-section={section}
            aria-current={active ? "page" : undefined}
            onClick={section === "lore" ? () => { recordWordmarkTap(); } : undefined}
            {...(section === "lore" ? pressHandlers : {})}
          >
            {label}
            {section === "lore" ? moon : null}
            {section === "lore" ? vinyl : null}
          </Link>
        );
      })}
    </nav>
  );
}
