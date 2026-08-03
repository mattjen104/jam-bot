import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Ghost, Loader2, Play, X } from "lucide-react";
import type { ReplayManifest } from "@workspace/api-client-react";
import {
  EMBED_SERVICES,
  GUIDED_SERVICE_OPTIONS,
  guidedMissingLabel,
  materializeGuidedReplay,
  type GuidedReplayMaterialization,
  type GuidedService,
} from "../lib/guidedReplay";

type ReplayEntry = ReplayManifest["entries"][number];

function materialize(entries: ReplayEntry[], service: GuidedService): GuidedReplayMaterialization {
  return materializeGuidedReplay(entries.map((entry) => ({
    position: entry.position,
    rawTitle: entry.rawTitle,
    rawArtist: entry.rawArtist,
    recording: entry.recording
      ? {
          mbid: entry.recording.mbid,
          title: entry.recording.title,
          artist: entry.recording.artist,
          links: entry.recording.links,
        }
      : null,
    guidedLinks: entry.guidedLinks,
  })), service);
}

function serviceLabel(service: GuidedService): string {
  return GUIDED_SERVICE_OPTIONS.find((o) => o.service === service)?.label ?? service;
}

/**
 * Account-free Ghost Replay guide. This owns only the official iframe (for
 * embed services) or an external-open link (for all other services) and the
 * manifest cursor. It intentionally does not enter the normal ride/player
 * state machine or fetch audio through Lore.
 */
export function GuidedReplayPanel({
  entries,
  label,
}: {
  entries: ReplayEntry[];
  label: string;
}) {
  const [service, setService] = useState<GuidedService>("bandcamp");
  const [active, setActive] = useState(false);
  const [playableIndex, setPlayableIndex] = useState(0);
  const [embedState, setEmbedState] = useState<"loading" | "ready" | "error">("loading");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const youtubePlayerRef = useRef<{ destroy?: () => void } | null>(null);
  const guide = useMemo(() => materialize(entries, service), [entries, service]);
  const current = guide.playable[playableIndex] ?? null;
  const isEmbed = current?.source != null && !current.source.externalOnly;

  useEffect(() => {
    setPlayableIndex(0);
    setEmbedState("loading");
  }, [service]);

  const next = () => {
    setPlayableIndex((index) => Math.min(index + 1, Math.max(0, guide.playable.length - 1)));
    setEmbedState("loading");
  };
  const previous = () => {
    setPlayableIndex((index) => Math.max(0, index - 1));
    setEmbedState("loading");
  };

  // YouTube IFrame API: subscribe to state changes and auto-advance on ENDED (info === 0).
  useEffect(() => {
    if (!active || !isEmbed || current?.source?.service !== "youtube" || !iframeRef.current) return;
    let cancelled = false;
    const iframe = iframeRef.current;
    const subscribeToYouTubeState = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({
          event: "command",
          func: "addEventListener",
          args: ["onStateChange"],
        }),
        "https://www.youtube.com",
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.youtube.com" ||
        event.source !== iframe.contentWindow ||
        cancelled
      ) return;
      if (typeof event.data !== "string") return;
      try {
        const payload = JSON.parse(event.data);
        if (payload?.event === "onStateChange" && payload.info === 0) next();
      } catch {
        // YouTube also sends non-JSON postMessage traffic; ignore it.
      }
    };
    window.addEventListener("message", onMessage);
    subscribeToYouTubeState();
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      youtubePlayerRef.current?.destroy?.();
      youtubePlayerRef.current = null;
    };
  }, [active, current, isEmbed]);

  useEffect(() => () => {
    youtubePlayerRef.current?.destroy?.();
    youtubePlayerRef.current = null;
    iframeRef.current?.setAttribute("src", "about:blank");
  }, []);

  const start = () => {
    if (!guide.playable.length) return;
    setPlayableIndex(0);
    setEmbedState("loading");
    setActive(true);
  };
  const close = () => {
    setActive(false);
    setEmbedState("loading");
    youtubePlayerRef.current?.destroy?.();
    youtubePlayerRef.current = null;
    if (iframeRef.current) iframeRef.current.src = "about:blank";
  };

  const currentLabel = serviceLabel(service);
  const isEmbedService = EMBED_SERVICES.has(service);

  return (
    <section className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.04] p-4" data-testid="guided-replay">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            <Ghost className="h-3.5 w-3.5" />
            Guided Ghost Replay
          </div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {isEmbedService
              ? `Hear the reconstruction through official ${currentLabel} embeds.`
              : `Step through the reconstruction with official ${currentLabel} links.`}
            {active ? ` ${label}` : " No audio is hosted or stitched by Lore."}
          </p>
        </div>
        {!active ? (
          <button
            type="button"
            onClick={start}
            disabled={!guide.available}
            className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-xs uppercase tracking-wide text-primary-foreground disabled:opacity-40"
            data-testid="guided-start"
          >
            <Play className="h-3.5 w-3.5" />
            Enter guided mode
          </button>
        ) : (
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            data-testid="guided-close"
          >
            <X className="h-3.5 w-3.5" />
            Leave guide
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Service</span>
        {GUIDED_SERVICE_OPTIONS.map(({ service: option, label: optLabel }) => (
          <button
            key={option}
            type="button"
            onClick={() => setService(option)}
            aria-pressed={service === option}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
              service === option
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`guided-service-${option}`}
          >
            {optLabel}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground" data-testid="guided-coverage">
          {guide.available} of {guide.total} available
        </span>
      </div>

      {active && current ? (
        <div className="mt-4 rounded-lg border border-card-border bg-card p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-serif text-base font-semibold text-foreground">{current.title}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {current.artist} · manifest position {current.position + 1} · {serviceLabel(current.source?.service ?? service)}
              </p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {playableIndex + 1} of {guide.playable.length}
            </span>
          </div>

          {/* Embed path: Bandcamp EmbeddedPlayer or YouTube iframe */}
          {isEmbed ? (
            <div className="overflow-hidden rounded-md bg-black/20">
              {embedState === "loading" ? (
                <div className="flex h-20 items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading official embed…
                </div>
              ) : null}
              {embedState === "error" ? (
                <div
                  role="status"
                  data-testid="guided-embed-error"
                  className="flex min-h-20 items-center justify-center gap-2 px-4 text-center font-mono text-[11px] text-muted-foreground"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
                  This official embed could not load. The manifest row remains in the receipt.
                </div>
              ) : null}
              <iframe
                ref={iframeRef}
                key={current.source?.embedUrl}
                title={`${current.artist} — ${current.title} on ${serviceLabel(current.source?.service ?? service)}`}
                src={current.source?.embedUrl ?? undefined}
                allow="autoplay; encrypted-media"
                className={`h-40 w-full border-0 ${embedState === "error" ? "hidden" : ""}`}
                onLoad={() => setEmbedState("ready")}
                onError={() => setEmbedState("error")}
                data-testid="guided-embed"
              />
            </div>
          ) : (
            /* External-open path: all non-embed services, or embed services without an embeddable URL */
            <div className="flex items-center justify-center rounded-md bg-black/20 py-5">
              <a
                href={current.source?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-primary/50 px-4 py-2 font-mono text-xs text-primary hover:bg-primary/10 transition-colors"
                data-testid="guided-external-link"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open on {serviceLabel(current.source?.service ?? service)}
              </a>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={previous}
              disabled={playableIndex === 0}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground disabled:opacity-35"
              data-testid="guided-previous"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>
            <span className="font-mono text-[10px] text-muted-foreground">
              {current.source?.autoAdvance
                ? "YouTube advances automatically when the embed reports ended."
                : isEmbed
                  ? "Use Next — this embed does not report ended."
                  : "Use Next to open the following track."}
            </span>
            <button
              type="button"
              onClick={next}
              disabled={playableIndex >= guide.playable.length - 1}
              className="inline-flex items-center gap-1 rounded-full border border-primary/50 px-3 py-1.5 font-mono text-[11px] text-primary disabled:opacity-35"
              data-testid="guided-next"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {active ? (
        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="guided-receipt">
          {guide.missing.map((entry) => (
            <span
              key={`${entry.position}-${entry.recordingMbid ?? "missing"}`}
              className="rounded-full border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground"
            >
              {entry.position + 1} · {guidedMissingLabel(entry.missingReason!)}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
