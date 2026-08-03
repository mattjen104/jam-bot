import { useLocation } from "wouter";
import type { ReactNode } from "react";
import { ImportStrip } from "./ImportStrip";
import { useMyDialCrossings } from "../lib/meHooks";
import { RecordPeekNav } from "./RecordPeekNav";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  // Prefetch crossings as soon as the app shell mounts — not just when the
  // Radio tab renders.  React Query deduplicates the call so DialView gets
  // a warm cache hit instead of waiting for a cold network round-trip.
  const today = new Date().toISOString().slice(0, 10);
  useMyDialCrossings(today);

  const isHome = location === "/" || location === "";

  return (
    <>
      {/* ── Import progress strip — visible while a sync runs ────────── */}
      <ImportStrip />


      {/* ── Main content (padded for bottom nav bar) ────────────── */}
      <div className={isHome ? "" : "pb-24"}>{children}</div>

      <RecordPeekNav />
    </>
  );
}
