import { useState } from "react";
import { Heart, Check, Loader2 } from "lucide-react";
import {
  useMyKeepStatus,
  useMutationKeep,
  useMutationUnkeep,
  startSpotifyLibraryConnect,
  type LibraryProvenance,
} from "../lib/meHooks";
import { useMyConnections } from "../lib/meHooks";

interface KeepButtonProps {
  mbid: string;
  provenance?: Partial<LibraryProvenance>;
  /** compact mode: just icon + minimal text, used on inflow cards */
  compact?: boolean;
}

/**
 * Keep a track in your Lore library (+ optional Spotify mirror).
 *
 * States:
 * - Not authenticated → "Keep" (lime); clicking starts Spotify connect flow
 * - Authenticated, not kept → lime "Keep"
 * - Authenticated, kept → muted "Kept ✓" (toggle to un-keep)
 * - Pending → spinner
 */
export function KeepButton({ mbid, provenance, compact = false }: KeepButtonProps) {
  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;

  const { data: keptSet } = useMyKeepStatus(isAuthenticated ? [mbid] : []);
  const kept = keptSet?.has(mbid) === true;

  const keepMutation = useMutationKeep();
  const unkepMutation = useMutationUnkeep();
  const [connectPending, setConnectPending] = useState(false);

  const isPending = keepMutation.isPending || unkepMutation.isPending || connectPending;

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
      unkepMutation.mutate(mbid);
    } else {
      keepMutation.mutate({ mbid, provenance });
    }
  };

  if (connLoading) return null;

  const title = !isAuthenticated
    ? "Connect Spotify to keep this track in your Lore library"
    : kept
      ? "In your library — click to remove"
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
          ? "border-[#C6F53F]/30 bg-[#C6F53F]/10 text-[#C6F53F]/60"
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
      {compact ? (isKept ? "Kept" : "Keep") : isKept ? "Kept ✓" : "Keep"}
    </button>
  );
}
