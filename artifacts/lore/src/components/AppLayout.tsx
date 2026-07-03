import { Link, useLocation } from "wouter";
import { BookOpen, Headphones, Users } from "lucide-react";

/**
 * The "L" in Lore — left stroke follows a circular arc, as if tracing
 * the edge of a record spinning from the violet dot on the left.
 * The arc's center is approximately where the dot sits, so the curve
 * is geometrically continuous with the implied circle.
 */
function RecordL({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 11 18"
      style={{ height: "0.8em", display: "inline-block", verticalAlign: "-0.1em" }}
      fill="currentColor"
      className={className}
    >
      {/*
        Path: L-shape where the left edge of the vertical stroke is a cubic
        bezier bowing ~2.5px rightward at mid-height — the arc of a large
        circle whose center is off-left (near the dot).  Right edge stays
        straight so the stroke thins slightly at centre, giving a pleasing
        thick-thin serif rhythm.
      */}
      <path d="M 0.5 0 C 3.5 4 3.5 13 0.5 17 L 10.5 17 L 10.5 14.5 L 3.5 14.5 L 3.5 0 Z" />
    </svg>
  );
}

const NAV_TABS = [
  { href: "/", label: "LISTEN", Icon: Headphones, exact: true },
  { href: "/journal", label: "LIBRARY", Icon: BookOpen, exact: false },
  { href: "/archive", label: "PICKERS", Icon: Users, exact: false },
];

function isActive(href: string, exact: boolean, location: string): boolean {
  if (exact) return location === href;
  return location === href || location.startsWith(href + "/") || location.startsWith(href + "?");
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <>
      {/* ── Desktop sidebar (lg+) ───────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] flex-col border-r border-border bg-card lg:flex">
        <div className="flex flex-col gap-1 p-5 pt-7">
          {/* Wordmark ● Lore — violet dot + record-edge L + ore */}
          <Link href="/" className="mb-7 flex items-center gap-2">
            <span className="font-serif text-xl font-semibold text-primary">●</span>
            <span className="font-serif text-xl font-semibold text-foreground">
              <RecordL /><span>ore</span>
            </span>
          </Link>

          {/* Vertical nav tabs — IBM Plex Mono uppercase, active=--dim, inactive=--faint */}
          {NAV_TABS.map(({ href, label, Icon, exact }) => {
            const active = isActive(href, exact, location);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors"
                style={{
                  color: active
                    ? "hsl(var(--dim))"
                    : "hsl(var(--faint))",
                }}
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--faint))" }}
                />
                {label}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto p-5">
          <p
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{ color: "hsl(var(--faint))" }}
          >
            No algorithms.
          </p>
        </div>
      </aside>

      {/* ── Mobile top bar (below lg) ───────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <Link href="/" className="flex items-center gap-1.5">
          <span className="font-serif text-lg font-semibold text-primary">●</span>
          <span className="font-serif text-lg font-semibold text-foreground">
            <RecordL /><span>ore</span>
          </span>
        </Link>
        <nav className="flex items-center gap-0.5">
          {NAV_TABS.map(({ href, label, exact }) => {
            const active = isActive(href, exact, location);
            return (
              <Link
                key={href}
                href={href}
                className="rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors"
                style={{
                  color: active ? "hsl(var(--dim))" : "hsl(var(--faint))",
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <div className="lg:ml-[220px]">{children}</div>
    </>
  );
}
