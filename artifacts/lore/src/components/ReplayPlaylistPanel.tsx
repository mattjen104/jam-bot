import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Music2, RefreshCw } from "lucide-react";
import {
  postReplayMaterialization,
  startReplayPlaylistConnect,
  useReplayMaterializationJob,
  useReplayPlaylistTargets,
  type ReplayPlaylistTarget,
} from "../lib/meHooks";

/**
 * The playlist action belongs to every canonical station replay surface, not
 * just the shareable /replay/:id page. The API still owns the immutable
 * manifest and rejects non-canonical ids.
 */
export function ReplayPlaylistPanel({ replayId }: { replayId: number }) {
  const { data: targetData } = useReplayPlaylistTargets(replayId);
  const [selectedService, setSelectedService] = useState<ReplayPlaylistTarget["service"] | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: materialization } = useReplayMaterializationJob(jobId);

  useEffect(() => {
    if (materialization?.status === "done" || materialization?.status === "error") {
      setSelectedService(null);
    }
  }, [materialization?.status]);

  async function materialize(service: ReplayPlaylistTarget["service"]) {
    setActionError(null);
    setSelectedService(service);
    try {
      const job = await postReplayMaterialization(replayId, service);
      setJobId(job.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start playlist creation");
      setSelectedService(null);
    }
  }

  async function connect(service: ReplayPlaylistTarget["service"]) {
    setActionError(null);
    try {
      await startReplayPlaylistConnect(service);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start service authorization");
    }
  }

  return (
    <section
      aria-label="Make a playlist"
      className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="replay-playlist"
    >
      <div className="flex items-start gap-3">
        <Music2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-lg font-semibold text-foreground">
            Keep this broadcast in a playlist
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Create an ordered playlist from the exact identified entries.
            Unknown moments stay visible in the receipt and are never replaced.
          </p>
          {targetData?.targets.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {targetData.targets.map((target) => {
                const busy = selectedService === target.service;
                return (
                  <div key={target.service} className="flex items-center gap-1.5">
                    {target.connected && target.canWrite ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void materialize(target.service)}
                        className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-primary-foreground disabled:opacity-50"
                        data-testid={`materialize-${target.service}`}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music2 className="h-3.5 w-3.5" />}
                        {busy ? "Creating…" : target.displayName}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void connect(target.service)}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-foreground hover:border-primary hover:text-primary"
                        data-testid={`connect-${target.service}`}
                      >
                        Connect {target.displayName}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Apple Music and Tidal playlist connections are not configured here.
            </p>
          )}
          {actionError ? (
            <p className="mt-3 text-sm text-destructive-foreground" role="alert">{actionError}</p>
          ) : null}
          {materialization ? (
            <div className="mt-4 rounded-lg border border-border bg-background/70 p-3" data-testid="materialization-status">
              {materialization.status === "pending" || materialization.status === "running" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating {materialization.name}…
                </p>
              ) : materialization.status === "error" ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-destructive-foreground">
                    {materialization.error ?? "Playlist creation failed."}
                    {materialization.errorRetryable ? " You can retry." : ""}
                  </p>
                  {materialization.errorRetryable ? (
                    <button
                      type="button"
                      onClick={() => void materialize(materialization.service as ReplayPlaylistTarget["service"])}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-primary hover:underline"
                    >
                      <RefreshCw className="h-3 w-3" /> Retry
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <Check className="h-4 w-4 text-primary" />
                    {materialization.accepted} of {materialization.total} broadcast entries added
                    {materialization.playlistUrl ? (
                      <a
                        href={materialization.playlistUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-primary hover:underline"
                      >
                        Open playlist <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </p>
                  {materialization.missing + materialization.rejected > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {materialization.missing} missing and {materialization.rejected} rejected entries remain in the receipt.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}