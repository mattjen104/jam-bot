import { Link, useLocation } from "wouter";
import { useState } from "react";
import type { ReactNode } from "react";
import { Music2, X } from "lucide-react";
import { ImportStrip } from "./ImportStrip";
import { useMyConnections, useLatestImportJob, startSpotifyLibraryConnect } from "../lib/meHooks";

const SESSION_LIBRARY_PROMPT_DISMISSED = "lore_library_prompt_dismissed";

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

/**
 * Library import nudge — shown once per session to users who haven't yet
 * connected a Spotify library. Dismisses permanently for the session.
 */
function LibraryPrompt() {
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem(SESSION_LIBRARY_PROMPT_DISMISSED) === "1",
  );

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const { data: job } = useLatestImportJob();

  // Don't flash before we know the connection state.
  if (connLoading) return null;
  // Already connected — no prompt needed.
  if (Array.isArray(connections) && connections.some((c) => c.service === "spotify")) return null;
  // Import already running/done elsewhere — suppress.
  if (job && (job.status === "running" || job.status === "pending" || job.status === "done")) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_LIBRARY_PROMPT_DISMISSED, "1");
    setDismissed(true);
  };

  const handleConnect = () => {
    void startSpotifyLibraryConnect();
  };

  return (
    <div
      className="flex items-center gap-3 border-b border-border px-4 py-2"
      style={{ background: "hsl(var(--card))" }}
      data-testid="library-prompt"
    >
      <Music2
        size={14}
        className="shrink-0"
        style={{ color: "hsl(var(--primary))" }}
        aria-hidden="true"
      />
      <p className="flex-1 font-mono text-[11px] text-muted-foreground">
        Connect your Spotify library to see which shows overlap with your taste
      </p>
      <button
        type="button"
        onClick={handleConnect}
        className="shrink-0 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Connect
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

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
      {/* ── Library import prompt — nudges unconnected users ─────────── */}
      <LibraryPrompt />

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
