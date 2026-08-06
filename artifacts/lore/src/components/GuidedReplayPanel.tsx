import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Ghost, Loader2, Play, X } from "lucide-react";
import type { ReplayManifest } from "@workspace/api-client-react";
import {
  GUIDED_SERVICE_OPTIONS,
  computeAvailableServices,
  getOfficialReplayDoors,
  guidedMissingLabel,
  materializeGuidedReplay,
  officialEmbedStatus,
  serviceSupportsEmbed,
  type GuidedReplayMaterialization,
} from "../lib/guidedReplay";

type ReplayEntry = ReplayManifest["entries"][number];

function materialize(entries: ReplayEntry[], service: string): GuidedReplayMaterialization {
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
    embedFacts: entry.embedFacts,
  })), service);
}

function serviceLabel(service: string): string {
  return (
    GUIDED_SERVICE_OPTIONS.find((o) => o.service === service)?.label ??
    // Unknown services: title-case the raw DB key (e.g. "tidal_hifi" → "Tidal Hifi")
    service.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Account-free Ghost Replay guide. This owns only the official iframe (for
 * embed services) or an external-open link (for all other services) and the
 * manifest cursor. It intentionally does not enter the normal ride/player
 * state machine or fetch audio through Lore.
 *
 * Service tabs are derived from the manifest's `guidedLinks` via
 * `computeAvailableServices`, so a new service mapped in `service_track_map`
 * automatically gains a tab on any replay that has coverage — no frontend
 * code change required. Iframe embeds (Bandcamp, YouTube) are handled
 * generically by `sourceForLink`; SDK-based services still require a handler.
 */
export function GuidedReplayPanel({
  entries,
  label,
  broadcastHref,
}: {
  entries: ReplayEntry[];
  label: string;
  broadcastHref?: string;
}) {
  const [service, setService] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("lore:guided-replay-service");
      if (stored && stored.length > 0) return stored;
    } catch {
      // localStorage unavailable (e.g. SSR or private browsing with storage blocked)
    }
    return "bandcamp";
  });
  const [active, setActive] = useState(false);
  const [playableIndex, setPlayableIndex] = useState(0);
  const [embedState, setEmbedState] = useState<"loading" | "ready" | "error">("loading");
  const [officialDoor, setOfficialDoor] = useState<"current" | "album" | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const youtubePlayerRef = useRef<{ destroy?: () => void } | null>(null);
  const currentEmbedUrlRef = useRef<string | null>(null);
  /** Services that have at least one live link for this specific manifest. */
  const availableServices = useMemo(() => computeAvailableServices(entries), [entries]);

  // Persist the selected service so the listener doesn't re-pick it every visit.
  useEffect(() => {
    try {
      localStorage.setItem("lore:guided-replay-service", service);
    } catch {
      // localStorage unavailable
    }
  }, [service]);

  // If the active service has no coverage in this manifest (e.g. a persisted
  // preference from a different replay), fall back to the first available tab.
  useEffect(() => {
    if (availableServices.length > 0 && !availableServices.some((o) => o.service === service)) {
      setService(availableServices[0].service);
    }
  }, [availableServices, service]);

  const guide = useMemo(() => materialize(entries, service), [entries, service]);
  const current = guide.playable[playableIndex] ?? null;
  const firstOfficialEntry = entries.find((entry) => entry.recording != null) ?? null;
  const officialDoors = useMemo(
    () => getOfficialReplayDoors(firstOfficialEntry),
    [firstOfficialEntry],
  );
  const officialSource =
    officialDoor === "album" ? officialDoors.album : officialDoor === "current" ? officialDoors.current : null;
  const currentEmbedUrl = officialSource?.embedUrl ?? current?.source?.embedUrl ?? null;
  currentEmbedUrlRef.current = currentEmbedUrl;
  const isEmbed = currentEmbedUrl != null;

  useEffect(() => {
    setPlayableIndex(0);
    setEmbedState("loading");
    setOfficialDoor(null);
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
    const isYouTube = officialSource?.provider === "youtube" || current?.source?.service === "youtube";
    if (!active || !isEmbed || !isYouTube || !iframeRef.current || !currentEmbedUrl) return;
    let cancelled = false;
    const iframe = iframeRef.current;
    const subscribingTo = currentEmbedUrl;
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
      if (currentEmbedUrlRef.current !== subscribingTo) return;
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
  }, [active, current, currentEmbedUrl, isEmbed, officialSource]);

  useEffect(() => () => {
    youtubePlayerRef.current?.destroy?.();
    youtubePlayerRef.current = null;
    iframeRef.current?.setAttribute("src", "about:blank");
  }, []);

  const start = () => {
    if (!guide.playable.length && !officialDoors.current) return;
    setPlayableIndex(0);
    setEmbedState("loading");
    setOfficialDoor(null);
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
  // Unknown services are never embed-capable; serviceSupportsEmbed checks the
  // embedUrlBuilder field on GUIDED_SERVICE_OPTIONS so the definition stays in one place.
  const isEmbedService = serviceSupportsEmbed(service);

  return (
    <section className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.04] p-4" data-testid="guided-replay">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.2em] text-primary">
            <Ghost className="h-3.5 w-3.5" />
            Guided Ghost Replay
          </div>
          <p className="mt-1 max-w-xl text-base leading-relaxed text-muted-foreground">
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
            disabled={!guide.available && !officialDoors.current}
            className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-40"
            data-testid="guided-start"
          >
            <Play className="h-3.5 w-3.5" />
            Enter guided mode
          </button>
        ) : (
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            data-testid="guided-close"
          >
            <X className="h-3.5 w-3.5" />
            Leave guide
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] uppercase tracking-wide text-muted-foreground">Service</span>
        {availableServices.map(({ service: option, label: optLabel }) => (
          <button
            key={option}
            type="button"
            onClick={() => setService(option)}
            aria-pressed={service === option}
            className={`rounded-full border px-3 py-1 font-mono text-[13px] transition-colors ${
              service === option
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`guided-service-${option}`}
          >
            {optLabel}
          </button>
        ))}
        <span className="ml-auto font-mono text-[13px] text-muted-foreground" data-testid="guided-coverage">
          {guide.available} of {guide.total} available
        </span>
      </div>

      <div
        className="mt-4 grid gap-2 sm:grid-cols-3"
        aria-label="Replay doors"
        data-testid="guided-doors"
      >
        <button
          type="button"
          disabled={!officialDoors.current}
          onClick={() => {
            setOfficialDoor("current");
            setActive(true);
            setEmbedState("loading");
          }}
          className="rounded-lg border border-border px-3 py-2 text-left disabled:opacity-45"
          data-testid="guided-door-current"
        >
          <span className="block font-mono text-[12px] uppercase tracking-wide text-primary">Current song</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {officialDoors.current
              ? officialDoors.current.embedUrl ? "Open the verified official embed." : "Open the verified provider link."
              : officialEmbedStatus(firstOfficialEntry?.embedFacts)}
          </span>
        </button>
        <button
          type="button"
          disabled={!officialDoors.album}
          onClick={() => {
            setOfficialDoor("album");
            setActive(true);
            setEmbedState("loading");
          }}
          className="rounded-lg border border-border px-3 py-2 text-left disabled:opacity-45"
          data-testid="guided-door-album"
        >
          <span className="block font-mono text-[12px] uppercase tracking-wide text-primary">Whole album</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {officialDoors.album ? "Known Bandcamp release · begins at track one." : "Only available for a known release."}
          </span>
        </button>
        {broadcastHref ? (
          <a
            href={broadcastHref}
            className="rounded-lg border border-border px-3 py-2 text-left hover:border-primary"
            data-testid="guided-door-broadcast"
          >
            <span className="block font-mono text-[12px] uppercase tracking-wide text-primary">Broadcast context</span>
            <span className="mt-1 block text-sm text-muted-foreground">Return to Lore’s ordered broadcast receipt.</span>
          </a>
        ) : null}
      </div>

      {active && (current || officialSource) ? (
        <div className="mt-4 rounded-lg border border-card-border bg-card p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-serif text-lg font-normal text-foreground">
                {officialDoor === "album" ? "Whole album" : current?.title ?? firstOfficialEntry?.recording?.title ?? "Current song"}
              </p>
              <p className="truncate font-mono text-[13px] text-muted-foreground">
                {officialDoor === "album"
                  ? "Bandcamp · starts at track one"
                  : `${current?.artist ?? firstOfficialEntry?.recording?.artist ?? ""} · ${
                    current ? `manifest position ${current.position + 1} · ` : ""
                  }${serviceLabel(officialSource?.provider ?? current?.source?.service ?? service)}`}
              </p>
            </div>
            <span className="font-mono text-[12px] uppercase tracking-wide text-muted-foreground">
              {officialDoor ? "official result" : `${playableIndex + 1} of ${guide.playable.length}`}
            </span>
          </div>

          {/* Embed path: Bandcamp EmbeddedPlayer or YouTube iframe */}
          {isEmbed ? (
            <div className="overflow-hidden rounded-md bg-black/20">
              {embedState === "loading" ? (
                <div className="flex h-20 items-center justify-center gap-2 font-mono text-[13px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading official embed…
                </div>
              ) : null}
              {embedState === "error" ? (
                <div
                  role="status"
                  data-testid="guided-embed-error"
                  className="flex min-h-20 items-center justify-center gap-2 px-4 text-center font-mono text-[13px] text-muted-foreground"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
                  This official embed could not load. The manifest row remains in the receipt.
                </div>
              ) : null}
              <iframe
                ref={iframeRef}
                key={currentEmbedUrl}
                title={`${current?.artist ?? firstOfficialEntry?.recording?.artist ?? ""} — ${current?.title ?? firstOfficialEntry?.recording?.title ?? "official replay"} on ${serviceLabel(officialSource?.provider ?? current?.source?.service ?? service)}`}
                src={currentEmbedUrl ?? undefined}
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
                href={officialSource?.url ?? current?.source?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-primary/50 px-4 py-2 font-mono text-sm text-primary hover:bg-primary/10 transition-colors"
                data-testid="guided-external-link"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open on {serviceLabel(officialSource?.provider ?? current?.source?.service ?? service)}
              </a>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={previous}
              disabled={officialDoor != null || playableIndex === 0}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-mono text-[13px] text-muted-foreground disabled:opacity-35"
              data-testid="guided-previous"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>
            <span className="font-mono text-[12px] text-muted-foreground">
              {officialSource?.autoAdvance || current?.source?.autoAdvance
                ? "YouTube advances automatically when the embed reports ended."
                : isEmbed
                  ? officialDoor === "album"
                    ? "Bandcamp does not report ended; continue manually in the album."
                    : "Use Next — this embed does not report ended."
                  : "Use Next to open the following track."}
            </span>
            <button
              type="button"
              onClick={next}
              disabled={officialDoor != null || playableIndex >= guide.playable.length - 1}
              className="inline-flex items-center gap-1 rounded-full border border-primary/50 px-3 py-1.5 font-mono text-[13px] text-primary disabled:opacity-35"
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
              className="rounded-full border border-border px-2 py-1 font-mono text-[12px] text-muted-foreground"
            >
              {entry.position + 1} · {guidedMissingLabel(entry.missingReason!)}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
