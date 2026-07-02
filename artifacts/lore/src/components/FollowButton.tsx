import { useFollows, isFollowed, toggleFollow, type FollowEntry } from "../lib/local";
import { Check, Plus } from "lucide-react";

interface FollowButtonProps {
  kind: FollowEntry["kind"];
  id: string;
  name: string;
}

/** Follow/unfollow a human taste source. Device-local — no account needed. */
export function FollowButton({ kind, id, name }: FollowButtonProps) {
  const follows = useFollows();
  const following = isFollowed(follows, kind, id);

  return (
    <button
      type="button"
      onClick={() => toggleFollow(kind, id, name)}
      data-testid={`follow-${kind}-${id}`}
      title={
        following
          ? `Stop following ${name}`
          : `Follow ${name} — new runs show up in your Following feed`
      }
      className={
        following
          ? "hover-elevate inline-flex items-center gap-1.5 rounded-full border border-primary-border bg-primary/15 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-primary"
          : "hover-elevate inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-foreground"
      }
    >
      {following ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}
