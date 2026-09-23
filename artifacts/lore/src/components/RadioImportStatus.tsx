import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ME_LATEST_IMPORT_JOB_KEY,
  postStartImport,
  useLatestImportJob,
  useMyImportStats,
} from "../lib/meHooks";

/** Counts are read in the listener's own session, never from an operator account. */
export function RadioImportStatus() {
  const queryClient = useQueryClient();
  const { data: job, isPending, isError, refetch } = useLatestImportJob();
  const { data: stats } = useMyImportStats();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
  const active = job?.service === "spotify" && (job.status === "pending" || job.status === "running");

  useEffect(() => {
    if (job?.service !== "spotify" || job.status !== "done") return;
    void queryClient.invalidateQueries({ queryKey: ["me", "library", "import-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["me", "crossings"] });
  }, [job?.jobId, job?.service, job?.status, queryClient]);

  const recheck = async () => {
    setStarting(true);
    setStartError(false);
    try {
      await postStartImport("spotify");
    } catch {
      setStartError(true);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      setStarting(false);
    }
  };

  return (
    <section
      aria-label="Spotify import status"
      style={{ padding: "12px 16px", margin: "0 0 16px", borderRadius: 10, background: "hsl(var(--secondary) / .55)", fontSize: 12, color: "hsl(var(--foreground))" }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div aria-live="polite">
          <strong>Spotify library</strong>{" "}
          {isPending ? "Checking your import…" : isError ? "Import status unavailable."
            : job == null ? "No connected Spotify import recorded for this Library."
              : job.service !== "spotify" ? "The latest import was from another source."
              : job.status === "error" ? "The last import failed before completion."
                : active ? `Importing${job.total > 0 ? ` ${job.total.toLocaleString()} fetched tracks` : " your saved tracks"}…`
                  : `${job.total.toLocaleString()} tracks fetched in the last completed import.`}
          {job?.service === "spotify" && job.status === "done" && stats != null ? (
            <span> {stats.total.toLocaleString()} distinct active imported tracks in your Library; {stats.softCount.toLocaleString()} still need an exact match.</span>
          ) : null}
          {startError ? <span role="alert"> Couldn&apos;t start a recheck. Open Import to check your Spotify connection.</span> : null}
        </div>
        <button
          type="button"
          onClick={() => { if (isError) void refetch(); else void recheck(); }}
          disabled={active || starting || isPending}
        >
          {isError ? "Retry status" : active ? "Import in progress" : starting ? "Starting…" : "Recheck Spotify"}
        </button>
      </div>
      {job?.service === "spotify" && job.status === "done" ? (
        <small>Compare the fetched count with Spotify Saved Songs. Library counts can differ when tracks are duplicates or have been removed here.</small>
      ) : null}
    </section>
  );
}