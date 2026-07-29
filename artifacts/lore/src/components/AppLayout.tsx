import { Link, useLocation } from "wouter";

function isActive(href: string, exact: boolean, location: string): boolean {
  if (exact) return location === href;
  return location === href || location.startsWith(href + "/") || location.startsWith(href + "?");
}

/** True when location belongs to the Radio section (not Selectors or Library). */
function isRadioSection(location: string): boolean {
  if (
    location === "/selectors" ||
    location.startsWith("/selectors/") ||
    location.startsWith("/archive/selectors") ||
    location.startsWith("/archive/selector-runs") ||
    location.startsWith("/archive/picker") ||
    location === "/library" ||
    location.startsWith("/library/") ||
    location === "/journal" ||
    location.startsWith("/journal/") ||
    location === "/following" ||
    location.startsWith("/following/") ||
    location === "/taste-map" ||
    location.startsWith("/taste-map/")
  ) {
    return false;
  }
  return true;
}

const RADIO_SUB_NAV = [
  { href: "/", label: "Dial", exact: true },
  { href: "/stations", label: "Stations", exact: false },
  { href: "/schedule", label: "Schedule", exact: false },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const radioActive = isRadioSection(location);
  const selectorsActive =
    location === "/selectors" ||
    location.startsWith("/selectors/") ||
    location.startsWith("/archive/selectors") ||
    location.startsWith("/archive/selector-runs") ||
    location.startsWith("/archive/picker");
  const libraryActive =
    location === "/library" ||
    location.startsWith("/library/") ||
    location === "/journal" ||
    location.startsWith("/journal/") ||
    location === "/following" ||
    location.startsWith("/following/") ||
    location === "/taste-map" ||
    location.startsWith("/taste-map/");

  return (
    <>
      {/* ── Radio sub-nav strip (when Radio tab is active) ──────── */}
      {radioActive && (
        <div
          className="sticky top-0 z-20 border-b border-border backdrop-blur-md"
          style={{ background: "hsl(var(--background) / 0.95)" }}
        >
          <nav className="flex items-center gap-1 px-4 py-2">
            {RADIO_SUB_NAV.map(({ href, label, exact }) => {
              const active = isActive(href, exact, location);
              return (
                <Link
                  key={href}
                  href={href}
                  className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors"
                  style={{
                    color: active ? "hsl(var(--foreground))" : "hsl(var(--faint))",
                    background: active ? "hsl(var(--secondary))" : "transparent",
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* ── Main content (padded for bottom nav bar) ────────────── */}
      <div className="pb-14">{children}</div>

      {/* ── Bottom nav bar — 3 pills ────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border backdrop-blur-md"
        style={{ background: "hsl(var(--background) / 0.97)" }}
      >
        <div
          className="flex items-center justify-around px-6 pt-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))", height: "56px" }}
        >
          {/* Radio pill */}
          <Link href="/">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all"
              style={
                radioActive
                  ? {
                      background: "hsl(var(--foreground))",
                      color: "hsl(var(--background))",
                    }
                  : {
                      background: "transparent",
                      color: "hsl(var(--faint))",
                    }
              }
            >
              Radio
            </span>
          </Link>

          {/* Selectors pill */}
          <Link href="/selectors">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all"
              style={
                selectorsActive
                  ? {
                      background: "hsl(var(--picker))",
                      color: "hsl(var(--picker-foreground))",
                    }
                  : {
                      background: "transparent",
                      color: "hsl(var(--faint))",
                    }
              }
            >
              Selectors
            </span>
          </Link>

          {/* Library pill */}
          <Link href="/library">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all"
              style={
                libraryActive
                  ? {
                      background: "hsl(var(--foreground))",
                      color: "hsl(var(--background))",
                    }
                  : {
                      background: "transparent",
                      color: "hsl(var(--faint))",
                    }
              }
            >
              Library
            </span>
          </Link>
        </div>
      </nav>
    </>
  );
}
