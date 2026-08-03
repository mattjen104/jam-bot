import { useLocation } from "wouter";
import { useState, useEffect, type ReactNode } from "react";
import { ImportStrip } from "./ImportStrip";
import { ManualImportModal, type ServiceId } from "./ManualImportModal";
import { useMyDialCrossings } from "../lib/meHooks";
import { RecordPeekNav } from "./RecordPeekNav";
import { useQueryClient } from "@tanstack/react-query";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const qc = useQueryClient();

  // Prefetch crossings as soon as the app shell mounts — not just when the
  // Radio tab renders.  React Query deduplicates the call so DialView gets
  // a warm cache hit instead of waiting for a cold network round-trip.
  const today = new Date().toISOString().slice(0, 10);
  useMyDialCrossings(today);

  const isHome = location === "/" || location === "";

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

      {/* ── Main content (padded for bottom nav bar) ────────────── */}
      <div className={isHome ? "" : "pb-24"}>{children}</div>

      <RecordPeekNav />
    </>
  );
}
