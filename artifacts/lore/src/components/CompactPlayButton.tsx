import { Pause, Play } from "lucide-react";

export interface CompactPlayButtonProps {
  title: string;
  isPlaying: boolean;
  isLoading?: boolean;
  onClick: () => void;
  testId?: string;
}

/**
 * The deliberately small play affordance used by the two homepage mini-feed
 * bands. It owns event isolation so neither parent row expands nor tunes when
 * the listener activates the control.
 *
 * While `isLoading` is true the control renders muted and activation is a
 * no-op — never re-fire a play/toggle for a session that is already
 * buffering, or the in-flight source gets reattached concurrently.
 */
export function CompactPlayButton({
  title,
  isPlaying,
  isLoading = false,
  onClick,
  testId,
}: CompactPlayButtonProps) {
  return (
    <button
      type="button"
      className="compact-play-btn"
      aria-label={`${isPlaying ? "Pause" : "Play"} ${title}`}
      aria-pressed={isPlaying}
      aria-disabled={isLoading || undefined}
      data-loading={isLoading || undefined}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isLoading) return;
        onClick();
      }}
      onKeyDown={(event) => {
        // Stop Enter/Space from bubbling to the enclosing interactive container
        // (e.g. CompactStackRow's div[role=button]) which would trigger expansion.
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
          // Do not call preventDefault here — the browser's native button
          // activation on Enter/Space fires the onClick handler, which already
          // handles the action.
        }
      }}
    >
      {isPlaying ? (
        <Pause aria-hidden="true" />
      ) : (
        <Play aria-hidden="true" />
      )}
      {isLoading && <span className="sr-only">Loading</span>}
    </button>
  );
}