import { useState } from "react";
import { Heart, Check, Loader2 } from "lucide-react";
import {
  useMyKeepStatus,
  useMySpinKeepStatus,
  useMutationKeep,
  useMutationKeepSpin,
  useMutationUnkeep,
  useMutationUnkeepSpin,
  startSpotifyLibraryConnect,
  type LibraryProvenance,
} from "../lib/meHooks";
import { useMyConnections } from "../lib/meHooks";

interface KeepButtonProps {
  /** Resolved recording MBID — use when the track has been identified. */
  mbid?: string | null;
  /** Spin DB id — use when the track is not yet resolved to an MBID. */
  spinId?: number | null;
  provenance?: Partial<LibraryProvenance>;
  /** compact mode: just icon + minimal text, used on inflow cards */
  compact?: boolean;
}

/**
 * Keep a track in your Lore library (+ optional Spotify mirror).
 *
 * Supports two modes:
 * - `mbid` — resolved track: uses the existing library_items path
 * - `spinId` — unresolved spin: uses the pending_keeps path
 *
 * States:
 * - Not authenticated → "Keep" (lime); clicking starts Spotify connect flow
 * - Authenticated, not kept → lime "Keep"
 * - Authenticated, kept → muted "Kept ✓" (toggle to un-keep)
 * - Saved but unresolved → amber "Saved" (unresolved badge)
 * - Pending → spinner
 */
export function KeepButton({ mbid, spinId, provenance, compact = false }: KeepButtonProps) {
  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;

  // MBID path — resolved track
  const { data: keptSet } = useMyKeepStatus(
    isAuthenticated && mbid ? [mbid] : [],
  );
  const keptByMbid = mbid ? keptSet?.has(mbid) === true : false;

  // Spin path — unresolved track
  const spinIdArr: number[] = isAuthenticated && spinId != null && !mbid ? [spinId] : [];
  const { data: spinStatus } = useMySpinKeepStatus(spinIdArr);
  const keptBySpin = spinId != null && !mbid
    ? (spinStatus?.saved.has(spinId) === true || spinStatus?.pending.has(spinId) === true)
    : false;
  const pendingOnly = spinId != null && !mbid
    ? (spinStatus?.pending.has(spinId) === true && spinStatus?.saved.has(spinId) !== true)
    : false;

  const kept = keptByMbid || keptBySpin;

  const keepMutation = useMutationKeep();
  const keepSpinMutation = useMutationKeepSpin();
  const unkepMutation = useMutationUnkeep();
  const unkeepSpinMutation = useMutationUnkeepSpin();
  const [connectPending, setConnectPending] = useState(false);

  const isPending =
    keepMutation.isPending ||
    keepSpinMutation.isPending ||
    unkepMutation.isPending ||
    unkeepSpinMutation.isPending ||
    connectPending;

  // Don't render if we have nothing to act on.
  if (!mbid && spinId == null) return null;

  const handleClick = async () => {
    if (isPending) return;

    if (!isAuthenticated) {
      setConnectPending(true);
      try {
        await startSpotifyLibraryConnect();
      } finally {
        setConnectPending(false);
      }
      return;
    }

    if (kept) {
      if (mbid) {
        unkepMutation.mutate(mbid);
      } else if (spinId != null) {
        unkeepSpinMutation.mutate(spinId);
      }
    } else {
      if (mbid) {
        keepMutation.mutate({ mbid, spinId, provenance });
      } else if (spinId != null) {
        keepSpinMutation.mutate({ spinId, provenance });
      }
    }
  };

  if (connLoading) return null;

  const title = !isAuthenticated
    ? "Connect Spotify to keep this track in your Lore library"
    : kept
      ? pendingOnly
        ? "Saved — resolving to MusicBrainz; click to remove"
        : "In your library — click to remove"
      : "Keep this track in your Lore library";

  const isKept = isAuthenticated && kept;

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isPending}
      title={title}
      aria-label={title}
      aria-pressed={isKept}
      data-testid="keep-button"
      className={`hover-elevate inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
        isKept
          ? pendingOnly
            ? "border-amber-400/30 bg-amber-400/10 text-amber-400/60"
            : "border-[#C6F53F]/30 bg-[#C6F53F]/10 text-[#C6F53F]/60"
          : "border-[#C6F53F]/50 bg-[#C6F53F]/15 text-[#C6F53F]"
      } ${isPending ? "opacity-60" : ""}`}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isKept ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Heart className="h-3.5 w-3.5" />
      )}
      {compact
        ? isKept
          ? pendingOnly
            ? "Saved"
            : "Kept"
          : "Keep"
        : isKept
          ? pendingOnly
            ? "Saved ✓"
            : "Kept ✓"
          : "Keep"}
    </button>
  );
}
