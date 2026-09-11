import { useState } from "react";
import { Bookmark, Check, Loader2, Plus } from "lucide-react";
import {
  useMyConnections,
  useMyKeepStatus,
  useMySpinKeepStatus,
  useMutationKeep,
  useMutationKeepSpin,
  useMutationUnkeep,
  useMutationUnkeepSpin,
  startSpotifyLibraryConnect,
  type LibraryProvenance,
} from "../lib/meHooks";

/**
 * Keep button styled for the webplayer theme. Same behavior as KeepButton:
 * unauthenticated click starts the Spotify connect flow.
 *
 * Accepts either `mbid` (resolved track) or `spinId` (unresolved spin).
 */
export function WpKeep({
  mbid,
  spinId,
  provenance,
  onSuccess,
  appearance = "default",
}: {
  mbid?: string | null;
  spinId?: number | null;
  provenance?: Partial<LibraryProvenance>;
  /** Called only after the keep request succeeds (not on auth/connect). */
  onSuccess?: () => void;
  /** The main playback panel alone uses the circular transport-sized action. */
  appearance?: "default" | "mainCircular";
}) {
  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;

  // MBID path
  const { data: keptSet } = useMyKeepStatus(
    isAuthenticated && mbid ? [mbid] : [],
  );
  const keptByMbid = mbid ? keptSet?.has(mbid) === true : false;

  // Spin path
  const spinIdArr: number[] = isAuthenticated && spinId != null && !mbid ? [spinId] : [];
  const { data: spinStatus } = useMySpinKeepStatus(spinIdArr);
  const keptBySpin =
    spinId != null && !mbid
      ? spinStatus?.saved.has(spinId) === true || spinStatus?.pending.has(spinId) === true
      : false;
  const pendingOnly =
    spinId != null && !mbid
      ? spinStatus?.pending.has(spinId) === true && spinStatus?.saved.has(spinId) !== true
      : false;

  const kept = keptByMbid || keptBySpin;

  const keepMutation = useMutationKeep();
  const keepSpinMutation = useMutationKeepSpin();
  const unkeepMutation = useMutationUnkeep();
  const unkeepSpinMutation = useMutationUnkeepSpin();
  const [connectPending, setConnectPending] = useState(false);

  const isPending =
    keepMutation.isPending ||
    keepSpinMutation.isPending ||
    unkeepMutation.isPending ||
    unkeepSpinMutation.isPending ||
    connectPending;

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
      if (mbid) unkeepMutation.mutate(mbid);
      else if (spinId != null) unkeepSpinMutation.mutate(spinId);
    } else {
      if (mbid) {
        keepMutation.mutate({ mbid, spinId, provenance }, { onSuccess });
      } else if (spinId != null) {
        keepSpinMutation.mutate({ spinId, provenance }, { onSuccess });
      }
    }
  };

  if (connLoading) return null;

  const isKept = isAuthenticated && kept;
  const isMainCircular = appearance === "mainCircular";
  const title = !isAuthenticated
    ? "Connect Spotify to keep this track"
    : isKept
      ? pendingOnly
        ? "Saved — resolving; click to remove"
        : "In your library — click to remove"
      : "Keep this track in your library";

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isPending}
      title={title}
      aria-label={title}
      aria-pressed={isKept}
      data-testid="wp-keep-button"
      className={isMainCircular
        ? `wp-main-keep${isKept ? " is-kept" : ""}${pendingOnly ? " is-pending" : ""}`
        : undefined}
      style={isMainCircular ? undefined : {
        fontSize: 15,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        ...(isKept
          ? {
              color: pendingOnly
                ? "var(--wp-text-amber, #a6a6a6)"
                : "var(--wp-text-success)",
              borderColor: "var(--wp-border)",
            }
          : {}),
      }}
    >
      {isPending ? (
        <Loader2 size={isMainCircular ? 18 : 14} className="animate-spin" aria-hidden="true" />
      ) : isKept ? (
        <Check size={isMainCircular ? 20 : 14} aria-hidden="true" />
      ) : isMainCircular ? (
        <Plus size={22} aria-hidden="true" />
      ) : (
        <Bookmark size={14} aria-hidden="true" />
      )}
      {!isMainCircular && (isKept ? (pendingOnly ? "Saved" : "Kept") : "Keep")}
    </button>
  );
}
