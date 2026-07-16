import { useState } from "react";
import { Bookmark, Check, Loader2 } from "lucide-react";
import {
  useMyConnections,
  useMyKeepStatus,
  useMutationKeep,
  useMutationUnkeep,
  startSpotifyLibraryConnect,
  type LibraryProvenance,
} from "../lib/meHooks";

/**
 * Keep button styled for the webplayer theme. Same behavior as the classic
 * KeepButton: unauthenticated click starts the Spotify connect flow.
 */
export function WpKeep({
  mbid,
  provenance,
}: {
  mbid: string;
  provenance?: Partial<LibraryProvenance>;
}) {
  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;

  const { data: keptSet } = useMyKeepStatus(isAuthenticated ? [mbid] : []);
  const kept = keptSet?.has(mbid) === true;

  const keepMutation = useMutationKeep();
  const unkeepMutation = useMutationUnkeep();
  const [connectPending, setConnectPending] = useState(false);
  const isPending = keepMutation.isPending || unkeepMutation.isPending || connectPending;

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
    if (kept) unkeepMutation.mutate(mbid);
    else keepMutation.mutate({ mbid, provenance });
  };

  if (connLoading) return null;

  const isKept = isAuthenticated && kept;
  const title = !isAuthenticated
    ? "Connect Spotify to keep this track"
    : isKept
      ? "In your library — click to remove"
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
      style={{
        fontSize: 13,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        ...(isKept
          ? { color: "var(--wp-text-success)", borderColor: "var(--wp-border)" }
          : {}),
      }}
    >
      {isPending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      ) : isKept ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Bookmark size={14} aria-hidden="true" />
      )}
      {isKept ? "Kept" : "Keep"}
    </button>
  );
}
