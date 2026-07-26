import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";

// ─── Nav link definitions ──────────────────────────────────────────────────

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Wikipedia drafts", href: "/admin" },
  { label: "Song Exploder", href: "/admin/song-exploder" },
  { label: "Selectors", href: "/admin/selectors" },
  { label: "Radio Browser", href: "/admin/radio-browser" },
  { label: "Stations", href: "/admin/stations" },
  { label: "Lists", href: "/admin/list-candidates" },
  { label: "CRI", href: "/admin/cri" },
  { label: "Feed health", href: "/admin/health" },
];

// ─── Health check ──────────────────────────────────────────────────────────

interface HealthSummary {
  staleCount: number;
}

const HEALTH_CACHE_TTL_MS = 60_000;

/** Module-level cache so navigating between admin pages doesn't re-fetch. */
const healthCache: { value: number; expiresAt: number } = {
  value: 0,
  expiresAt: 0,
};
/** In-flight promise to coalesce concurrent callers onto a single fetch. */
let healthInFlight: Promise<number> | null = null;

async function fetchHealthStaleCount(token: string): Promise<number> {
  if (Date.now() < healthCache.expiresAt) {
    return healthCache.value;
  }
  if (healthInFlight) {
    return healthInFlight;
  }
  healthInFlight = (async () => {
    try {
      const headers = { "x-admin-token": token };
      const [ffRes, swRes] = await Promise.all([
        fetch("/api/admin/feed-freshness-health", { headers }),
        fetch("/api/admin/spinitron-web-health", { headers }),
      ]);
      if (!ffRes.ok || !swRes.ok) return healthCache.value;
      const [ff, sw] = await Promise.all([
        ffRes.json() as Promise<HealthSummary>,
        swRes.json() as Promise<HealthSummary>,
      ]);
      const count = (ff.staleCount ?? 0) + (sw.staleCount ?? 0);
      healthCache.value = count;
      healthCache.expiresAt = Date.now() + HEALTH_CACHE_TTL_MS;
      return count;
    } catch {
      return healthCache.value;
    } finally {
      healthInFlight = null;
    }
  })();
  return healthInFlight;
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * Shared horizontal navigation strip for all /admin/* pages.
 * Shows a warning indicator on "Feed health" when stale stations are detected.
 */
export function AdminNav({ token }: { token: string }) {
  const [location] = useLocation();
  const [staleCount, setStaleCount] = useState<number | null>(null);

  useEffect(() => {
    void fetchHealthStaleCount(token).then(setStaleCount);
  }, [token]);

  return (
    <nav className="mt-5 -mx-1 flex flex-wrap gap-x-1 gap-y-1 border-b border-border pb-3">
      {NAV_LINKS.map(({ label, href }) => {
        const isActive =
          href === "/admin"
            ? location === "/admin"
            : location.startsWith(href);

        const isHealth = href === "/admin/health";
        const showWarning = isHealth && staleCount !== null && staleCount > 0;

        return (
          <Link
            key={href}
            href={href}
            className={[
              "relative inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors",
              isActive
                ? "bg-secondary/60 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {label}
            {showWarning && (
              <AlertTriangle
                className="h-3 w-3 text-amber-500"
                aria-label={`${staleCount} stale station${staleCount === 1 ? "" : "s"}`}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
