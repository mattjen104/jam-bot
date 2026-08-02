import { useState, useRef, useCallback, useEffect } from "react";
import { X, Upload, FileText, ArrowLeft, ChevronRight, Image as ImageIcon, Loader2, Trash2, RotateCcw, Copy, Download } from "lucide-react";
import {
  postStartManualImport,
  postStartListenBrainzImport,
  postStartImport,
  postExtractLibraryImages,
  startSpotifyLibraryConnect,
  useMyConnections,
  ME_LATEST_IMPORT_JOB_KEY,
} from "../lib/meHooks";
import { useQueryClient } from "@tanstack/react-query";

export interface Track { artist: string; title: string }

export interface ScreenshotImage {
  id: string;
  name: string;
  mediaType: string;
  data: string;
  status: "ready" | "extracting" | "done" | "error";
  tracks: Track[];
  error?: string;
}

interface ReviewTrack extends Track {
  sourceId: string;
}

const IMAGE_MAX_COUNT = 4;
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = `${track.artist.trim().toLocaleLowerCase()}\u001f${track.title.trim().toLocaleLowerCase()}`;
    if (!track.artist.trim() || !track.title.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeReviewTracks(tracks: ReviewTrack[]): ReviewTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = `${track.artist.trim().toLocaleLowerCase()}\u001f${track.title.trim().toLocaleLowerCase()}`;
    if (!track.artist.trim() || !track.title.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Parsers — exported so they can be unit-tested independently
// ---------------------------------------------------------------------------

export function parseCsv(text: string): Track[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());

  const titleIdx = headers.findIndex((h) =>
    h === "track name" || h === "name" || h === "title" || h === "song",
  );
  const artistIdx = headers.findIndex((h) =>
    h === "artist name" || h === "artist" || h === "artist(s)" || h === "artists" || h === "artist name(s)",
  );

  const tIdx = titleIdx >= 0 ? titleIdx : 0;
  const aIdx = artistIdx >= 0 ? artistIdx : 1;

  const tracks: Track[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const title = cols[tIdx]?.trim() ?? "";
    const artist = cols[aIdx]?.trim() ?? "";
    if (title && artist) tracks.push({ artist, title });
  }
  return tracks;
}

export function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { cols.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

export function parsePlainText(text: string): Track[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const sep = line.lastIndexOf(" – ") !== -1 ? " – " : line.lastIndexOf(" - ") !== -1 ? " - " : null;
      if (!sep) return [];
      const idx = line.lastIndexOf(sep);
      const artist = line.slice(0, idx).trim();
      const title = line.slice(idx + sep.length).trim();
      return artist && title ? [{ artist, title }] : [];
    });
}

export function parseTracks(text: string): Track[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  if (firstLine.includes(",")) {
    const csv = parseCsv(trimmed);
    if (csv.length > 0) return csv;
  }
  return parsePlainText(trimmed);
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** A username is a single non-empty token with no whitespace. */
function isUsername(value: string): boolean {
  const t = value.trim();
  return t.length > 0 && !/\s/.test(t);
}

/** True when the pasted value looks like multi-line track data. */
function isMultilineContent(value: string): boolean {
  return value.includes("\n") || value.includes("\r");
}

// ---------------------------------------------------------------------------
// Service picker data
// ---------------------------------------------------------------------------

export type ServiceId = "spotify" | "exportify" | "applemusiccsv" | "listenbrainz" | "lastfm" | "other" | "screenshots";

export interface ServiceDef {
  id: ServiceId;
  label: string;
  hint: string;
  steps?: Array<{ text: string; linkHref?: string; linkLabel?: string }>;
  externalHref?: string;
  externalLabel?: string;
}

export const IMPORT_SERVICES: ServiceDef[] = [
  {
    id: "spotify",
    label: "Spotify (direct)",
    hint: "Pull your saved tracks directly — Spotify connection required",
  },
  {
    id: "exportify",
    label: "Spotify / Exportify",
    hint: "Export any Spotify playlist as a CSV",
    externalHref: "https://exportify.net",
    externalLabel: "Open Exportify",
    steps: [
      { text: "Go to Exportify and log in with your Spotify account.", linkHref: "https://exportify.net", linkLabel: "exportify.net" },
      { text: "Click Export next to the playlist you want to import." },
      { text: "Drop the downloaded CSV below, or paste its contents." },
    ],
  },
  {
    id: "applemusiccsv",
    label: "Apple Music / TuneMyMusic",
    hint: "Export your Apple Music library via TuneMyMusic",
    externalHref: "https://www.tunemymusic.com/transfer",
    externalLabel: "Open TuneMyMusic",
    steps: [
      { text: "Go to TuneMyMusic and choose Apple Music as the source.", linkHref: "https://www.tunemymusic.com/transfer", linkLabel: "tunemymusic.com" },
      { text: "Export your library — choose 'To File' and download the CSV." },
      { text: "Drop the downloaded CSV below, or paste its contents." },
    ],
  },
  {
    id: "listenbrainz",
    label: "ListenBrainz",
    hint: "Import loved recordings by username",
  },
  {
    id: "lastfm",
    label: "Last.fm",
    hint: "Export loved tracks then drop the CSV here",
  },
  {
    id: "other",
    label: "Other / paste",
    hint: "Paste tracks or drop any CSV file",
  },
  {
    id: "screenshots",
    label: "Library screenshots",
    hint: "Paste or upload screenshots — we’ll recognize the visible rows",
  },
];

// ---------------------------------------------------------------------------
// Mode types
// ---------------------------------------------------------------------------

/**
 * service-picker — initial mode: grid of service tiles
 * service-steps  — per-service instruction pane (selectedService is set)
 * input          — legacy combined text/file mode (kept as internal fallback)
 * username       — single token submitted; showing LB / Last.fm disambiguation
 * tracks         — multiline content detected; textarea + parse count
 * lfm-hint       — user tapped Last.fm from disambiguation; showing export hint
 */
type Mode = "service-picker" | "service-steps" | "input" | "username" | "tracks" | "lfm-hint" | "images" | "review";

interface Props { onClose(): void }

export function ManualImportModal({ onClose }: Props) {
  const [mode, setMode] = useState<Mode>("service-picker");
  const [selectedService, setSelectedService] = useState<ServiceId | null>(null);
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [images, setImages] = useState<ScreenshotImage[]>([]);
  const [reviewTracks, setReviewTracks] = useState<ReviewTrack[]>([]);
  const [imageBusy, setImageBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const singleInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const { data: connections } = useMyConnections();
  const hasSpotify = Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Derived
  const tracks = mode === "tracks" ? parseTracks(rawInput) : reviewTracks;
  const reviewReadyTracks = dedupeTracks(reviewTracks).map(({ artist, title }) => ({ artist, title }));
  const detectedUsername = mode === "username" ? rawInput.trim() : "";
  const pendingImageCount = images.filter((image) => image.status === "ready" || image.status === "error").length;
  const failedImageCount = images.filter((image) => image.status === "error").length;

  // Auto-switch to tracks mode when multiline content is pasted
  useEffect(() => {
    if (mode === "input" && isMultilineContent(rawInput)) {
      setMode("tracks");
    }
  }, [rawInput, mode]);

  // Focus textarea when switching to tracks mode
  useEffect(() => {
    if (mode === "tracks") {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [mode]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSpotifyDirectImport = async () => {
    if (hasSpotify) {
      setSubmitting(true);
      try {
        await postStartImport("spotify");
        await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed — try again.");
        setSubmitting(false);
      }
    } else {
      try {
        await startSpotifyLibraryConnect();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not connect to Spotify.");
      }
    }
  };

  const handleServiceSelect = (svc: ServiceDef) => {
    setError(null);
    if (svc.id === "spotify") {
      void handleSpotifyDirectImport();
      return;
    }
    if (svc.id === "other") {
      setSelectedService("other");
      setMode("tracks");
      return;
    }
    if (svc.id === "screenshots") {
      setSelectedService("screenshots");
      setMode("images");
      setError(null);
      return;
    }
    if (svc.id === "listenbrainz") {
      setSelectedService("listenbrainz");
      setMode("input");
      return;
    }
    if (svc.id === "lastfm") {
      setSelectedService("lastfm");
      setMode("lfm-hint");
      return;
    }
    // exportify / applemusiccsv — show per-service steps
    setSelectedService(svc.id);
    setMode("service-steps");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
    setError(null);
    // If mode was username/lfm-hint but user is editing, go back to input
    if (mode !== "input" && mode !== "tracks") setMode("input");
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRawInput(e.target.value);
    setError(null);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleDetect();
    }
  };

  const handleDetect = () => {
    const val = rawInput.trim();
    if (!val) return;
    if (isMultilineContent(rawInput)) {
      setMode("tracks");
      return;
    }
    if (isUsername(val)) {
      setMode("username");
      return;
    }
    // Fallback: treat as tracks
    setMode("tracks");
  };

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setRawInput(content);
      setMode("tracks");
      setError(null);
    };
    reader.readAsText(file);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const readImage = useCallback((file: File): Promise<ScreenshotImage> => new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.has(file.type)) {
      reject(new Error(`${file.name}: use a PNG, JPEG, WebP, or GIF image.`));
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      reject(new Error(`${file.name}: images must be 4 MB or smaller.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}: could not read this image.`));
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result : "";
      const comma = data.indexOf(",");
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}`,
        name: file.name,
        mediaType: file.type,
        data: comma >= 0 ? data.slice(comma + 1) : data,
        status: "ready",
        tracks: [],
      });
    };
    reader.readAsDataURL(file);
  }), []);

  const addImages = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    if (images.length + files.length > IMAGE_MAX_COUNT) {
      setError(`You can add up to ${IMAGE_MAX_COUNT} screenshots at a time.`);
      return;
    }
    try {
      const added = await Promise.all(files.map((file) => readImage(file)));
      setImages((current) => [...current, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    }
  }, [images.length, readImage]);

  const handleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    void addImages(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void addImages(Array.from(e.dataTransfer.files));
  };

  const handleImagePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && IMAGE_TYPES.has(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0) {
      e.preventDefault();
      setSelectedService("screenshots");
      setMode("images");
      void addImages(files);
    }
  };

  const removeImage = (id: string) => {
    setImages((current) => current.filter((image) => image.id !== id));
    setReviewTracks((current) => current.filter((track) => track.sourceId !== id));
  };

  const extractImages = async (retryIds?: string[]) => {
    const ids = retryIds ?? images.filter((image) => image.status === "ready" || image.status === "error").map((image) => image.id);
    const selected = images.filter((image) => ids.includes(image.id));
    if (selected.length === 0) return;
    setError(null);
    setImageBusy(true);
    setImages((current) => current.map((image) => ids.includes(image.id)
      ? { ...image, status: "extracting", error: undefined }
      : image));
    try {
      const response = await postExtractLibraryImages(selected.map(({ mediaType, data }) => ({ mediaType, data })));
      const extracted = new Map(response.results.map((result) => [selected[result.index]?.id, result]));
      const nextImages: ScreenshotImage[] = images.map((image): ScreenshotImage => {
        if (!ids.includes(image.id)) return image;
        const result = extracted.get(image.id);
        if (!result || result.status === "error") {
          return { ...image, status: "error", error: result?.error ?? "No result returned for this image." };
        }
        return {
          ...image,
          status: "done",
          tracks: result.tracks?.map(({ artist, title }) => ({ artist, title })) ?? [],
          error: undefined,
        };
      });
      setImages(nextImages);
      const freshRows: ReviewTrack[] = nextImages
        .filter((image) => image.status === "done")
        .flatMap((image) => image.tracks.map((track) => ({ ...track, sourceId: image.id })));
      setReviewTracks((current) => {
        const unchangedRows = current.filter((track) => !ids.includes(track.sourceId));
        return dedupeReviewTracks([...unchangedRows, ...freshRows]);
      });
      const failed = response.results.filter((result) => result.status === "error");
      if (failed.length > 0) {
        setError(`${failed.length} screenshot${failed.length === 1 ? "" : "s"} could not be read. You can retry it or continue with the rows that were recognized.`);
      }
      setMode("review");
    } catch (err) {
      setImages((current) => current.map((image) => ids.includes(image.id)
        ? { ...image, status: "error", error: err instanceof Error ? err.message : "Extraction failed." }
        : image));
      setError(err instanceof Error ? err.message : "Screenshot extraction failed — try again.");
    } finally {
      setImageBusy(false);
    }
  };

  const updateReviewTrack = (index: number, field: keyof Track, value: string) => {
    setReviewTracks((current) => current.map((track, i) => i === index ? { ...track, [field]: value } : track));
  };

  const deleteReviewTrack = (index: number) => {
    setReviewTracks((current) => current.filter((_, i) => i !== index));
  };

  const exportReview = async (format: "text" | "csv") => {
    const content = format === "csv"
      ? ["Artist,Title", ...reviewTracks.map(({ artist, title }) => `"${artist.replaceAll('"', '""')}","${title.replaceAll('"', '""')}"`)].join("\n")
      : reviewTracks.map(({ artist, title }) => `${artist} – ${title}`).join("\n");
    if (navigator.clipboard && format === "text") {
      try { await navigator.clipboard.writeText(content); setError("Recognized tracks copied to your clipboard."); return; } catch { /* download fallback */ }
    }
    const blob = new Blob([content], { type: format === "csv" ? "text/csv" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lore-recognized-tracks.${format === "csv" ? "csv" : "txt"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Drag-and-drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Import actions ───────────────────────────────────────────────────────

  const handleListenBrainzImport = async () => {
    if (!detectedUsername) return;
    setError(null);
    setSubmitting(true);
    try {
      await postStartListenBrainzImport(detectedUsername);
      await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed — check the username and try again.");
      setSubmitting(false);
    }
  };

  const handleManualImport = async () => {
    const importTracks = mode === "review" ? reviewReadyTracks : tracks;
    if (importTracks.length === 0) { setError("No tracks found — check the format below."); return; }
    setError(null);
    setSubmitting(true);
    try {
      await postStartManualImport(importTracks);
      await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed — try again.");
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    // Always return to the service picker from any downstream mode
    setMode("service-picker");
    setError(null);
    setSelectedService(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const showBack = mode !== "service-picker";

  const currentServiceDef = selectedService
    ? IMPORT_SERVICES.find((s) => s.id === selectedService) ?? null
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" aria-hidden />

      {/* Panel */}
      <div
        className="relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-t-2xl sm:rounded-2xl border border-border p-5"
        style={{ background: "hsl(var(--card))" }}
        onPaste={handleImagePaste}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {showBack && (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Back"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft size={15} aria-hidden />
              </button>
            )}
            <div>
              <h2 className="font-mono text-sm font-semibold text-foreground">
                {mode === "service-picker" ? "Import your tracks" :
                 mode === "service-steps" && currentServiceDef ? currentServiceDef.label :
                 mode === "username" ? "Import your tracks" :
                 mode === "lfm-hint" ? "Import from Last.fm" :
                 mode === "images" ? "Library screenshots" :
                 mode === "review" ? "Review screenshots" :
                 "Import your tracks"}
              </h2>
              {mode === "service-picker" && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  Choose where your tracks are coming from.
                </p>
              )}
              {mode === "username" && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  Where should we look for <span className="text-foreground">{detectedUsername}</span>?
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        {/* ── Service picker ─────────────────────────────────────────── */}
        {mode === "service-picker" && (
          <div className="flex flex-col gap-2" data-testid="service-picker">
            {IMPORT_SERVICES.map((svc) => (
              <button
                key={svc.id}
                type="button"
                data-testid={`service-tile-${svc.id}`}
                onClick={() => handleServiceSelect(svc)}
                className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary"
                style={{ background: "hsl(var(--muted)/0.2)" }}
              >
                <div>
                  <p className="font-mono text-[12px] font-semibold text-foreground">{svc.label}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{svc.hint}</p>
                </div>
                <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        )}

        {/* ── Service steps ──────────────────────────────────────────── */}
        {mode === "service-steps" && currentServiceDef && (
          <>
            <div
              className="rounded-lg border border-border px-3 py-3 font-mono text-[11px] text-muted-foreground space-y-2"
              style={{ background: "hsl(var(--muted)/0.3)" }}
              data-testid="service-steps-panel"
            >
              <p className="font-semibold text-foreground">{currentServiceDef.label}</p>
              {currentServiceDef.steps && (
                <ol className="space-y-1.5 list-none">
                  {currentServiceDef.steps.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span
                        className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                        style={{ background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))" }}
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <span>
                        {step.linkHref ? (
                          <>
                            {step.text.split(step.linkLabel ?? step.linkHref)[0]}
                            <a
                              href={step.linkHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-2"
                            >
                              {step.linkLabel ?? step.linkHref}
                            </a>
                            {step.text.split(step.linkLabel ?? step.linkHref)[1]}
                          </>
                        ) : step.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {currentServiceDef.externalHref && (
                <a
                  href={currentServiceDef.externalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                  data-testid="service-external-link"
                >
                  {currentServiceDef.externalLabel ?? currentServiceDef.externalHref}
                </a>
              )}
            </div>

            {/* Upload zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload or drop a CSV file"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 font-mono text-[11px] text-muted-foreground transition-colors"
              style={{
                borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.15)",
              }}
            >
              <Upload size={14} aria-hidden />
              <span>{isDragging ? "Drop to import" : "Drop CSV or click to browse"}</span>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
            </div>
          </>
        )}

        {/* ── Input mode (ListenBrainz path) ─────────────────────────── */}
        {mode === "input" && (
          <>
            {/* Single-line text input */}
            <div className="flex gap-2">
              <input
                ref={singleInputRef}
                type="text"
                value={rawInput}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder="Enter your ListenBrainz username…"
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleDetect}
                disabled={!rawInput.trim()}
                className="shrink-0 rounded-lg border border-primary bg-primary px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-primary-foreground transition-opacity disabled:opacity-40"
              >
                <ChevronRight size={13} aria-hidden />
              </button>
            </div>

            {/* Drag-and-drop / file upload zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload or drop a CSV or text file"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 font-mono text-[11px] text-muted-foreground transition-colors"
              style={{
                borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.15)",
              }}
            >
              <Upload size={16} aria-hidden className={isDragging ? "text-primary" : "text-muted-foreground/50"} />
              <span className={isDragging ? "text-primary" : ""}>
                {isDragging ? "Drop to import" : "Drop a CSV or text file, or click to browse"}
              </span>
              <input ref={fileRef} type="file" accept=".csv,.txt,.json" className="hidden" onChange={handleFileInput} />
            </div>

            {/* Hint */}
            <p className="font-mono text-[10px] text-muted-foreground/60">
              Accepts ListenBrainz usernames, or paste tracks directly.
            </p>
          </>
        )}

        {/* ── Username disambiguation ─────────────────────────────────── */}
        {mode === "username" && (
          <>
            {/* Username pill */}
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2" style={{ background: "hsl(var(--muted)/0.2)" }}>
              <span className="flex-1 font-mono text-[12px] text-foreground truncate">{detectedUsername}</span>
              <button
                type="button"
                onClick={handleBack}
                className="font-mono text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Edit
              </button>
            </div>

            {/* Primary action: ListenBrainz */}
            <button
              type="button"
              onClick={() => void handleListenBrainzImport()}
              disabled={submitting}
              className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary"
              style={{ background: "hsl(var(--muted)/0.2)" }}
            >
              <div>
                <p className="font-mono text-[12px] font-semibold text-foreground">
                  Import from ListenBrainz
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  Loved recordings with full MusicBrainz IDs — best match quality.
                </p>
              </div>
              <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden />
            </button>

            {/* Secondary action: Last.fm hint */}
            <button
              type="button"
              onClick={() => { setMode("lfm-hint"); setError(null); }}
              disabled={submitting}
              className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-border/80"
              style={{ background: "transparent" }}
            >
              <div>
                <p className="font-mono text-[12px] text-muted-foreground">
                  Importing from Last.fm instead?
                </p>
              </div>
              <ChevronRight size={14} className="shrink-0 text-muted-foreground/50" aria-hidden />
            </button>

            {error && (
              <p className="font-mono text-[11px] text-destructive">{error}</p>
            )}

            {submitting && (
              <p className="font-mono text-[11px] text-muted-foreground">Starting import…</p>
            )}
          </>
        )}

        {/* ── Last.fm hint ─────────────────────────────────────────────── */}
        {mode === "lfm-hint" && (
          <>
            <div
              className="rounded-lg border border-border px-3 py-3 font-mono text-[11px] text-muted-foreground space-y-2"
              style={{ background: "hsl(var(--muted)/0.3)" }}
            >
              <p className="font-semibold text-foreground">Export your Last.fm loved tracks</p>
              <ol className="space-y-1.5 list-none">
                {[
                  <>Open <a href="https://benjaminbenben.com/lastfm-to-csv/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Last.fm to CSV</a> (free, no login needed beyond Last.fm).</>,
                  <>Enter your Last.fm username and export your loved tracks.</>,
                  <>Download the CSV, then drop it on the import zone or paste the contents below.</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                      style={{ background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))" }}
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Switch to paste/upload zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload or drop a CSV file"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 font-mono text-[11px] text-muted-foreground transition-colors"
              style={{
                borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.15)",
              }}
            >
              <Upload size={14} aria-hidden />
              <span>{isDragging ? "Drop to import" : "Drop CSV or click to browse"}</span>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-border px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── Screenshot capture ───────────────────────────────────────── */}
        {mode === "images" && (
          <>
            <div
              className="rounded-lg border border-border px-3 py-3 font-mono text-[11px] text-muted-foreground space-y-1.5"
              style={{ background: "hsl(var(--muted)/0.3)" }}
            >
              <p className="font-semibold text-foreground">Recognize library screenshots</p>
              <p>Paste a screenshot here, or add up to {IMAGE_MAX_COUNT} images. Clear song rows are kept for your review; menus and album art are ignored.</p>
            </div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleImageDrop}
              onClick={() => imageRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload or drop library screenshots"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  imageRef.current?.click();
                }
              }}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 font-mono text-[11px] text-muted-foreground transition-colors"
              style={{
                borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.15)",
              }}
            >
              <ImageIcon size={18} aria-hidden className={isDragging ? "text-primary" : "text-muted-foreground/60"} />
              <span className={isDragging ? "text-primary" : ""}>
                {isDragging ? "Drop screenshots to add" : "Drop screenshots, click to browse, or paste"}
              </span>
              <span className="text-[10px] text-muted-foreground/60">PNG, JPEG, WebP, or GIF · 4 MB each</span>
              <input ref={imageRef} data-testid="screenshot-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={handleImageInput} />
            </div>
            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2" data-testid="image-preview-list">
                {images.map((image) => (
                  <div key={image.id} className="relative overflow-hidden rounded-lg border border-border" data-testid={`image-preview-${image.id}`}>
                    <img src={`data:${image.mediaType};base64,${image.data}`} alt={`Screenshot ${image.name}`} className="h-24 w-full object-cover" />
                    <div className="flex items-center justify-between gap-1 px-2 py-1 font-mono text-[9px] text-muted-foreground">
                      <span className="truncate">{image.name}</span>
                      <button type="button" onClick={() => removeImage(image.id)} aria-label={`Remove ${image.name}`} className="shrink-0 hover:text-foreground">
                        <Trash2 size={11} aria-hidden />
                      </button>
                    </div>
                    {image.status === "extracting" && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><Loader2 size={16} className="animate-spin text-white" aria-label="Extracting" /></div>}
                    {image.status === "error" && (
                      <div className="flex items-center justify-between gap-1 border-t border-destructive/40 px-2 py-1">
                        <span className="truncate font-mono text-[9px] text-destructive">{image.error}</span>
                        <button type="button" onClick={() => void extractImages([image.id])} aria-label={`Retry ${image.name}`} className="shrink-0 text-destructive hover:text-foreground">
                          <RotateCcw size={11} aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="font-mono text-[11px] text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Cancel</button>
              <button type="button" onClick={() => void extractImages()} disabled={imageBusy || pendingImageCount === 0} className="rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground disabled:opacity-40">
                {imageBusy ? "Reading…" : `Read ${pendingImageCount} screenshot${pendingImageCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}

        {/* ── OCR review ────────────────────────────────────────────────── */}
        {mode === "review" && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[12px] font-semibold text-foreground">Review recognized tracks</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{reviewTracks.length} track{reviewTracks.length === 1 ? "" : "s"} recognized · edit or remove anything incorrect</p>
              </div>
              <button type="button" onClick={() => setMode("images")} className="rounded-full border border-border px-3 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground">Add screenshots</button>
            </div>
            {reviewTracks.length > 0 ? (
              <div className="max-h-72 space-y-2 overflow-y-auto" data-testid="ocr-review-list">
                {reviewTracks.map((track, index) => (
                  <div key={`${index}-${track.artist}-${track.title}`} className="flex items-center gap-1.5">
                    <span className="w-5 shrink-0 text-right font-mono text-[9px] text-muted-foreground">{index + 1}</span>
                    <input value={track.artist} onChange={(e) => updateReviewTrack(index, "artist", e.target.value)} aria-label={`Artist ${index + 1}`} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-foreground" />
                    <input value={track.title} onChange={(e) => updateReviewTrack(index, "title", e.target.value)} aria-label={`Title ${index + 1}`} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-foreground" />
                    <button type="button" onClick={() => deleteReviewTrack(index)} aria-label={`Delete track ${index + 1}`} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 size={12} aria-hidden /></button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center font-mono text-[11px] text-muted-foreground">No clear song rows found. Try another screenshot or retry an unreadable one.</div>
            )}
            {error && <p className="font-mono text-[11px] text-muted-foreground" role="status">{error}</p>}
            {failedImageCount > 0 && (
              <p className="font-mono text-[10px] text-destructive" role="alert">
                {failedImageCount} screenshot{failedImageCount === 1 ? "" : "s"} could not be read. Add or retry them from the screenshot step.
                <button type="button" onClick={() => setMode("images")} className="ml-1 underline underline-offset-2">Review errors</button>
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void exportReview("text")} disabled={reviewTracks.length === 0} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground disabled:opacity-40"><Copy size={10} aria-hidden /> Copy text</button>
                <button type="button" onClick={() => void exportReview("csv")} disabled={reviewTracks.length === 0} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground disabled:opacity-40"><Download size={10} aria-hidden /> CSV</button>
              </div>
              <button type="button" onClick={() => void handleManualImport()} disabled={submitting || reviewReadyTracks.length === 0} className="rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground disabled:opacity-40">
                {submitting ? "Starting…" : `Import ${reviewReadyTracks.length} tracks`}
              </button>
            </div>
          </>
        )}

        {/* ── Tracks mode ────────────────────────────────────────────────── */}
        {mode === "tracks" && (
          <>
            {/* Collapsed instructions summary (shown after arriving from a service with steps) */}
            {(selectedService === "exportify" || selectedService === "applemusiccsv") && (
              <div
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[10px] text-muted-foreground"
                style={{ background: "hsl(var(--muted)/0.15)" }}
                data-testid="service-summary-banner"
              >
                <FileText size={10} aria-hidden className="shrink-0" />
                <span>
                  {selectedService === "exportify"
                    ? "Imported from exportify.net"
                    : "Imported from TuneMyMusic"}
                </span>
              </div>
            )}

            {/* File upload button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Upload size={11} aria-hidden />
                Upload file
              </button>
              <span className="font-mono text-[10px] text-muted-foreground">or edit below</span>
              <input ref={fileRef} type="file" accept=".csv,.txt,.json" className="hidden" onChange={handleFileInput} />
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={rawInput}
              onChange={handleTextareaChange}
              placeholder={
                selectedService === "other"
                  ? "Artist – Title\nArtist – Title\n…\n\nOr paste any CSV with artist and title columns."
                  : "Artist – Title\nArtist – Title\n…"
              }
              rows={8}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
              data-testid="tracks-textarea"
            />

            {/* Parse preview — track list or error */}
            {rawInput.trim() && tracks.length > 0 && (
              <div
                className="rounded-lg border border-border overflow-hidden"
                style={{ background: "hsl(var(--muted)/0.15)" }}
                data-testid="track-preview"
              >
                <div className="px-3 py-1.5 border-b border-border/50 font-mono text-[10px] text-muted-foreground">
                  <span className="text-foreground">{tracks.length.toLocaleString()}</span> tracks found
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: "250px" }} data-testid="track-preview-list">
                  <ul>
                    {tracks.slice(0, 50).map((track, i) => (
                      <li
                        key={i}
                        className="px-3 py-1 font-mono text-[11px] text-foreground border-b border-border/20 last:border-0"
                      >
                        <span className="text-muted-foreground">{track.artist}</span>
                        <span className="mx-1 text-muted-foreground/50">–</span>
                        {track.title}
                      </li>
                    ))}
                    {tracks.length > 50 && (
                      <li className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground/60">
                        …and {(tracks.length - 50).toLocaleString()} more
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            {rawInput.trim() && tracks.length === 0 && (
              <p className="font-mono text-[11px] text-destructive" data-testid="track-count">
                {rawInput.includes(",")
                  ? "Couldn\u2019t find \u2018Track Name\u2019 or \u2018Artist Name(s)\u2019 columns \u2014 try re-exporting from exportify.net"
                  : "No tracks recognised \u2014 use one track per line: Artist \u2013 Title"}
              </p>
            )}

            {error && (
              <p className="font-mono text-[11px] text-destructive">{error}</p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-border px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleManualImport()}
                disabled={submitting || tracks.length === 0}
                className="rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {submitting ? "Starting…" : `Import ${tracks.length} tracks`}
              </button>
            </div>

            {/* Inline tip */}
            <p className="font-mono text-[10px] text-muted-foreground/60">
              <FileText size={10} className="inline mr-1 -mt-px" aria-hidden />
              {selectedService === "other"
                ? "Accepts any CSV with artist and title columns, or lines of Artist – Title."
                : "Accepts Spotify Exportify CSV, Apple Music CSV, or lines of Artist – Title."}
            </p>
          </>
        )}

      </div>
    </div>
  );
}
