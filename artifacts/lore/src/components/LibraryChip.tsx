/**
 * LibraryChip — compact topbar pill showing library import status.
 *
 * States:
 *   empty   — no import ever run, no library connection
 *   running — import in progress (spinning icon + counter)
 *   done    — library has tracks (count + add-more hint)
 *
 * Clicking any state opens the ManualImportModal.
 */
import { useLatestImportJob, useMyImportStats } from "../lib/meHooks";

type ChipState = "empty" | "running" | "done";

interface LibraryChipProps {
  onOpen: () => void;
}

export function LibraryChip({ onOpen }: LibraryChipProps) {
  const { data: job } = useLatestImportJob();
  const { data: importStats } = useMyImportStats();

  const isRunning = job?.status === "running" || job?.status === "pending";
  const total = importStats?.total ?? 0;
  const hasEverImported = job != null || total > 0;

  const chipState: ChipState = isRunning ? "running" : hasEverImported ? "done" : "empty";

  const ariaLabel =
    chipState === "running"
      ? "Import running — open import"
      : chipState === "done"
        ? `${total} tracks in library — add more`
        : "Add your library";

  return (
    <button
      type="button"
      className={`dial-topbar__library-chip dial-topbar__library-chip--${chipState}`}
      onClick={onOpen}
      aria-label={ariaLabel}
    >
      {chipState === "running" && (
        <>
          <span className="dial-chip__spin" aria-hidden="true">↻</span>
          <span>{(job!.resolved ?? 0).toLocaleString()} / {(job!.total ?? 0).toLocaleString()}</span>
        </>
      )}
      {chipState === "done" && (
        <>
          <span aria-hidden="true">♪</span>
          <span>{total.toLocaleString()}</span>
          <span className="dial-chip__plus" aria-hidden="true">＋</span>
        </>
      )}
      {chipState === "empty" && (
        <>
          <span aria-hidden="true">＋</span>
          <span>Library</span>
        </>
      )}
    </button>
  );
}
