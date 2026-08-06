import { useEffect, useMemo, useState } from "react";
import {
  useGetGuidedReplayQueue,
  type GuidedReplayQueue,
} from "@workspace/api-client-react";

type GuidedReplayQueueEntry = GuidedReplayQueue["entries"][number];
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Ghost,
  Loader2,
  Smartphone,
} from "lucide-react";
import { KeepButton } from "./KeepButton";
import { safeHttpUrl } from "../lib/utils";

const MISSING_REASON: Record<string, string> = {
  not_mapped: "No service mapping",
  dead_mapping: "Mapping marked unavailable",
  not_exact: "Only a search match exists",
  unusable_mapping: "Link cannot be opened safely",
};

function entryName(entry: GuidedReplayQueueEntry): string {
  return `${entry.title || "Untitled"} — ${entry.artist || "Unknown artist"}`;
}

/**
 * A deliberately separate replay surface for native-app link-outs. It never
 * calls PlayerProvider: the listener is working through another app, not
 * asking Lore to play or advance anything.
 */
export function GuidedReplayQueue({ replayId }: { replayId: number }) {
  const [service, setService] = useState<string | undefined>();
  const { data, isLoading, isError } = useGetGuidedReplayQueue(
    replayId,
    service ? { service } : undefined,
  );
  const [position, setPosition] = useState(0);
  const [activity, setActivity] = useState("Choose Open to visit the selected service.");
  const [wasHidden, setWasHidden] = useState(false);

  useEffect(() => {
    setPosition(0);
    setActivity("Choose Open to visit the selected service.");
  }, [service, data?.service]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setWasHidden(true);
      } else if (wasHidden) {
        setWasHidden(false);
        setActivity("Back in Lore. Choose Next when you are ready; nothing was marked complete.");
      }
    };
    const onPageShow = () => {
      if (wasHidden) {
        setWasHidden(false);
        setActivity("Back in Lore. Choose Next when you are ready; nothing was marked complete.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [wasHidden]);

  const current = data?.entries[position] ?? null;
  const hasPrevious = position > 0;
  const hasNext = data ? position < data.entries.length - 1 : false;
  const coverageLabel = data
    ? `${data.coverage.available} of ${data.coverage.total} tracks have a ${data.serviceLabel} link`
    : "";

  const services = useMemo(() => data?.services ?? [], [data?.services]);

  if (isLoading) {
    return (
      <section className="mb-8 rounded-xl border border-card-border bg-card p-5" data-testid="guided-queue">
        <div className="flex items-center gap-2 font-mono text-sm uppercase tracking-wide text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing guided queue
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="mb-8 rounded-xl border border-card-border bg-card p-5" data-testid="guided-queue">
        <p className="font-mono text-sm uppercase tracking-wide text-muted-foreground">
          Guided queue unavailable right now
        </p>
      </section>
    );
  }

  const openCurrent = () => {
    if (!current?.target) {
      setActivity("This row has no usable service link. It remains a gap.");
      return;
    }
    setActivity(
      `Opened ${entryName(current)}. Return to Lore when you are ready; the row is not marked complete automatically.`,
    );
  };

  const previous = () => {
    setPosition((value) => Math.max(0, value - 1));
    setActivity("Moved to the previous broadcast position.");
  };

  const next = () => {
    setPosition((value) => Math.min(data.entries.length - 1, value + 1));
    setActivity("Moved to the next broadcast position. Choose Open when ready.");
  };

  return (
    <section
      aria-label="Guided native-app replay queue"
      className="mb-8 rounded-xl border border-primary/30 bg-primary/5 p-5"
      data-testid="guided-queue"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.2em] text-primary">
            <Smartphone className="h-4 w-4" />
            Guided queue · {data.serviceLabel}
          </div>
          <h2 className="mt-2 font-serif text-2xl font-normal text-foreground">
            Work through the broadcast in order
          </h2>
          <p className="mt-1 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Lore opens one link at a time in the service you choose. It does not
            play the track, detect completion, or change the live player.
          </p>
        </div>
        {services.length > 1 ? (
          <label className="font-mono text-[13px] uppercase tracking-wide text-muted-foreground">
            Service
            <select
              value={data.service}
              onChange={(event) => setService(event.target.value)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              data-testid="guided-queue-service"
            >
              {services.map((item) => (
                <option key={item.service} value={item.service}>
                  {item.label} · {item.available}/{item.total}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-3">
        <p className="font-mono text-sm text-muted-foreground" data-testid="guided-queue-coverage">
          Coverage · {coverageLabel}
        </p>
        <p className="font-mono text-sm text-primary" aria-live="polite" data-testid="guided-queue-status">
          {activity}
        </p>
      </div>

      {current ? (
        <div className="mt-4 rounded-lg border border-border bg-card p-4" data-testid="guided-queue-current">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="w-8 shrink-0 pt-1 text-right font-mono text-sm text-muted-foreground">
                {current.position + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate font-serif text-xl font-normal text-foreground">
                  {current.title || "Untitled"}
                </p>
                <p className="truncate font-mono text-sm text-muted-foreground">
                  {current.artist || "Unknown artist"}
                </p>
                <p className="mt-2 font-mono text-[12px] uppercase tracking-wide text-muted-foreground/80">
                  Spin {current.spinId} · position {current.position + 1} of {data.entries.length}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {current.target ? (
                <>
                  <a
                    href={current.target.url}
                    onClick={openCurrent}
                    target={current.target.kind === "web" ? "_blank" : undefined}
                    rel={current.target.kind === "web" ? "noreferrer" : undefined}
                    className="hover-elevate inline-flex items-center gap-1.5 rounded-full border border-primary-border bg-primary px-3 py-2 font-mono text-[13px] uppercase tracking-wide text-primary-foreground"
                    data-testid="guided-queue-open"
                  >
                    {current.target.kind === "native" ? <Smartphone className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    Open {data.serviceLabel}
                  </a>
                  {current.target.fallbackUrl ? (
                    <a
                      href={safeHttpUrl(current.target.fallbackUrl) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[12px] uppercase tracking-wide text-primary hover:underline"
                    >
                      Use web link
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-2 font-mono text-[13px] uppercase tracking-wide text-muted-foreground">
                  <Ghost className="h-3.5 w-3.5" />
                  {MISSING_REASON[current.missingReason ?? "not_mapped"]}
                </span>
              )}
              <KeepButton mbid={current.recordingMbid} spinId={current.spinId} compact />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={previous}
          disabled={!hasPrevious}
          className="hover-elevate inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 font-mono text-[13px] uppercase tracking-wide text-muted-foreground disabled:opacity-40"
          data-testid="guided-queue-previous"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </button>
        <p className="font-mono text-[13px] uppercase tracking-wide text-muted-foreground">
          Current · {current ? current.position + 1 : 0} / {data.entries.length}
        </p>
        <button
          type="button"
          onClick={next}
          disabled={!hasNext}
          className="hover-elevate inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 font-mono text-[13px] uppercase tracking-wide text-muted-foreground disabled:opacity-40"
          data-testid="guided-queue-next"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}