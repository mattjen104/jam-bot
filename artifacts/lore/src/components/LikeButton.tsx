import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSpotifySaved,
  getGetSpotifySavedQueryKey,
  useSpotifySave,
  ApiError,
} from "@workspace/api-client-react";
import { Heart } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";

/**
 * Heart button: save the current song to the listener's Spotify Liked Songs.
 *
 * Honest states, never a silent no-op:
 * - Spotify not configured on the server -> renders nothing (feature absent).
 * - Not connected -> outline heart; clicking starts the Spotify connect flow.
 * - Track not on Spotify (404) -> renders nothing (nothing to save to).
 * - Connection predates library scopes (403 insufficient_scope) -> clicking
 *   sends the listener back through consent to grant the new permission.
 */
export function LikeButton({ mbid }: { mbid: string }) {
  const { spotify } = usePlayer();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  // A notice belongs to the track it happened on — never carry it across.
  useEffect(() => {
    setNotice(null);
  }, [mbid]);

  const savedQuery = useGetSpotifySaved(
    { mbid },
    {
      query: {
        queryKey: getGetSpotifySavedQueryKey({ mbid }),
        enabled: spotify.configured && spotify.connected && !!mbid,
        staleTime: 60_000,
        retry: false,
      },
    },
  );

  const saveMutation = useSpotifySave({
    mutation: {
      onSuccess: () => {
        setNotice(null);
        queryClient.setQueryData(getGetSpotifySavedQueryKey({ mbid }), {
          saved: true,
        });
      },
      onError: (err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          setNotice("Reconnect Spotify to allow saving — click again to reconnect");
          return;
        }
        setNotice("Couldn't save to Spotify — try again");
      },
    },
  });

  if (!spotify.configured) return null;

  // Connected but the track isn't on Spotify: nothing to save, say nothing.
  const savedErr = savedQuery.error;
  if (
    spotify.connected &&
    savedErr instanceof ApiError &&
    savedErr.status === 404
  ) {
    return null;
  }

  const saved = savedQuery.data?.saved === true;
  const needsReconnect =
    notice !== null && notice.startsWith("Reconnect");

  const onClick = () => {
    if (!spotify.connected || needsReconnect) {
      spotify.connect();
      return;
    }
    if (saved || saveMutation.isPending) return;
    saveMutation.mutate({ data: { mbid } });
  };

  const title = !spotify.connected
    ? "Connect Spotify to save this song to your Liked Songs"
    : saved
      ? "In your Spotify Liked Songs"
      : "Save to your Spotify Liked Songs";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={saveMutation.isPending}
        title={title}
        aria-label={title}
        aria-pressed={saved}
        data-testid="like-button"
        className={`hover-elevate inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          saved
            ? "border-primary-border bg-primary/10 font-medium text-primary"
            : "border-border bg-secondary text-secondary-foreground"
        } ${saveMutation.isPending ? "opacity-60" : ""}`}
      >
        <Heart
          className={`h-3.5 w-3.5 ${saved ? "fill-current text-primary" : ""}`}
        />
        {saved ? "Liked" : "Like"}
      </button>
      {notice && (
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="like-notice">
          {notice}
        </span>
      )}
    </span>
  );
}
