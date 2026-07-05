import { Link, useLocation } from "wouter";
import { BookOpen, Headphones, Users } from "lucide-react";

const NAV_TABS = [
  { href: "/", label: "LISTEN", Icon: Headphones, exact: true },
  { href: "/journal", label: "LIBRARY", Icon: BookOpen, exact: false },
  { href: "/selectors", label: "SELECTORS", Icon: Users, exact: false },
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
          {/* Wordmark ● Lore — Fraunces with violet dot */}
          <Link href="/" className="mb-7 flex items-center gap-2">
            <span className="font-serif text-xl font-semibold text-primary">●</span>
            <span className="font-serif text-xl font-semibold text-foreground">Lore</span>
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
          <span className="font-serif text-lg font-semibold text-foreground">Lore</span>
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
