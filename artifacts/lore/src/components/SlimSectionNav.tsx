import { Link, useLocation } from "wouter";
import { useSleepMode, recordWordmarkTap } from "../lib/sleepMode";

type Section = "now" | "feed" | "stack";

export function sectionFor(location: string): Section {
  const path = location.split("?")[0] ?? location;
  if (path === "/library" || path.startsWith("/library/") ||
      path === "/journal" || path.startsWith("/journal/") ||
      path === "/sets" || path.startsWith("/sets/")) return "stack";
  if (path === "/feed" || path.startsWith("/feed/") ||
      path === "/explore" || path.startsWith("/explore/") ||
      path === "/heard" || path.startsWith("/heard/") ||
      path === "/index" || path.startsWith("/index/") ||
      path === "/stations" || path.startsWith("/stations/")) return "feed";
  return "now";
}

export function SlimSectionNav({
  variant = "corner",
  showArchiveNav: _showArchiveNav,
  demoSurface,
}: {
  variant?: "corner" | "bottom";
  showArchiveNav?: boolean;
  demoSurface?: boolean;
}) {
  const [location] = useLocation();
  const activeSection = sectionFor(location);
  const { enabled: sleepEnabled, toggle: toggleSleep } = useSleepMode();

  if (demoSurface) {
    const isBottom = variant === "bottom";
    const navClass = isBottom ? "bottom-nav demo-nav" : "corner-nav demo-nav demo-nav--corner";
    const linkClass = (active: boolean) =>
      isBottom
        ? `bottom-nav__link${active ? " bottom-nav__link--active" : ""}`
        : `corner-nav__link${active ? " corner-nav__link--active" : ""}`;
    return (
      <nav className={navClass} aria-label="Primary">
        <Link href="/" className={linkClass(activeSection === "now")} data-testid="demo-nav-radio" aria-current={activeSection === "now" ? "page" : undefined}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><circle cx="12" cy="13" r="2"/><path d="M4 6l16-3"/></svg>
          Radio
        </Link>
        <Link href="/library" className={linkClass(activeSection === "stack")} data-testid="demo-nav-library" aria-current={activeSection === "stack" ? "page" : undefined}>
          <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>
          Library
        </Link>
      </nav>
    );
  }

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
          const label = section === "now" ? "Now" : section === "feed" ? "Explore" : "Library";
          return (
            <Link
              key={section}
              href={section === "now" ? "/" : section === "feed" ? "/explore" : "/library"}
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
        const label = section === "now" ? "Now" : section === "feed" ? "Explore" : "Library";
        return (
          <Link
            key={section}
            href={section === "now" ? "/" : section === "feed" ? "/explore" : "/library"}
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
