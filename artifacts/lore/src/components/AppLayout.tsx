import { useLocation } from "wouter";
import { useState, useEffect, type ReactNode } from "react";
import { ImportStrip } from "./ImportStrip";
import { ManualImportModal, type ServiceId } from "./ManualImportModal";
import {
  useMyDialCrossings,
  ME_PICKER_OVERLAP_KEY,
} from "../lib/meHooks";
import { usePlayer } from "../player/PlayerProvider";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStationsQueryOptions,
  getListStationsNowPlayingQueryOptions,
} from "@workspace/api-client-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const qc = useQueryClient();

  // Prefetch crossings as soon as the app shell mounts — not just when the
  // Radio tab renders.  React Query deduplicates the call so DialView gets
  // a warm cache hit instead of waiting for a cold network round-trip.
  const today = new Date().toISOString().slice(0, 10);
  useMyDialCrossings(today);

  const isHome = location === "/" || location === "";
  const { radio, ride } = usePlayer();
  const hasPlayer = !!radio.station || ride.active;

  // ── Global import modal — hosted here so any route (Dial, Library, etc.)
  //    can open it by dispatching "lore:open-import-modal". ─────────────────
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importModalInitialService, setImportModalInitialService] = useState<ServiceId | undefined>(undefined);
  const [importModalInitialMode, setImportModalInitialMode] = useState<"artist-seeds" | undefined>(undefined);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: string; service?: string } | undefined>).detail;
      if (detail?.mode === "artist-seeds") {
        setImportModalInitialMode("artist-seeds");
        setImportModalInitialService(undefined);

        // ── Warm the dial cache while the user picks artists ──────────────
        // The user spends ~20-30 s in the picker — fire these in the
        // background so all three resolve before they land back on the dial.
        void qc.prefetchQuery(getListStationsQueryOptions());
        void qc.prefetchQuery(getListStationsNowPlayingQueryOptions());
        void qc.prefetchQuery({
          queryKey: ME_PICKER_OVERLAP_KEY,
          queryFn: () =>
            fetch("/api/me/pickers/overlap")
              .then((r) => r.ok ? r.json() : { items: [] })
              .then((d: { items?: unknown[] }) => d?.items ?? []),
          staleTime: 5 * 60_000,
        });
      } else if (detail?.service) {
        setImportModalInitialService(detail.service as ServiceId);
        setImportModalInitialMode(undefined);
      } else {
        setImportModalInitialService(undefined);
        setImportModalInitialMode(undefined);
      }
      setImportModalOpen(true);
    };
    window.addEventListener("lore:open-import-modal", handler);
    return () => window.removeEventListener("lore:open-import-modal", handler);
  }, []);

  const handleModalClose = () => {
    setImportModalOpen(false);
    setImportModalInitialService(undefined);
    setImportModalInitialMode(undefined);
  };

  return (
    <>
      {/* ── Import progress strip — visible while a sync runs ────────── */}
      <ImportStrip onAddMore={() => window.dispatchEvent(new CustomEvent("lore:open-import-modal"))} />

      {/* ── Global import modal ───────────────────────────────────────── */}
      {importModalOpen && (
        <ManualImportModal
          initialService={importModalInitialService}
          initialMode={importModalInitialMode}
          onClose={handleModalClose}
          onImportStarted={() => void qc.invalidateQueries({ queryKey: ["me", "album-avatar"] })}
        />
      )}

      {/* ── Main content — pad for bottom shell (nav + optional player) ── */}
      <div className={isHome ? "" : hasPlayer ? "pb-[188px]" : "pb-24"}>{children}</div>
    </>
  );
}
