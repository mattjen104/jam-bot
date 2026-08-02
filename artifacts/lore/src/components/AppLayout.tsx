import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import { ImportStrip } from "./ImportStrip";
import { useMyDialCrossings } from "../lib/meHooks";

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
    location.startsWith("/following/")
  ) {
    return false;
  }
  return true;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  // Prefetch crossings as soon as the app shell mounts — not just when the
  // Radio tab renders.  React Query deduplicates the call so DialView gets
  // a warm cache hit instead of waiting for a cold network round-trip.
  const today = new Date().toISOString().slice(0, 10);
  useMyDialCrossings(today);

  const radioActive = isRadioSection(location);
  const isHome = location === "/" || location === "";

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
    location.startsWith("/following/");

  return (
    <>
      {/* ── Import progress strip — visible while a sync runs ────────── */}
      <ImportStrip />


      {/* ── Main content (padded for bottom nav bar) ────────────── */}
      <div className={isHome ? "" : "pb-14"}>{children}</div>

      {/* ── Bottom nav bar — 3 pills ─────────────────────────────── */}
      {/* The Home page (DialView) renders its own nav via AppLayout below */}
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
                      background: "hsl(var(--keep))",
                      color: "hsl(var(--keep-foreground))",
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
