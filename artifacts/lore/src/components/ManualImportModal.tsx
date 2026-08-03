import { useState, useRef, useCallback, useEffect } from "react";
import { X, Upload, FileText, ArrowLeft, ChevronRight, Image as ImageIcon, Loader2, Trash2, RotateCcw, Copy, Download, Clock, CheckCircle2 } from "lucide-react";
import {
  postStartManualImport,
  postStartListenBrainzImport,
  postStartLastFmImport,
  postStartImport,
  postExtractLibraryImages,
  startSpotifyLibraryConnect,
  useMyConnections,
  useLatestImportJob,
  useMyAlbumAvatar,
  useSetAlbumAvatar,
  useSetTasteSeeds,
  useMyTasteSeeds,
  ME_LATEST_IMPORT_JOB_KEY,
  ME_CONNECTIONS_KEY,
} from "../lib/meHooks";
import {
  useGetStationsArtistFrequency,
  getGetStationsArtistFrequencyQueryKey,
} from "@workspace/api-client-react";
import { mergeOnboardingArtists, liveIdentityKey } from "../hooks/useDialData";
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
// Service definitions — redesigned service-first picker
// ---------------------------------------------------------------------------

export type ServiceId =
  | "spotify"
  | "applemusic"
  | "youtubemusic"
  | "lastfm"
  | "listenbrainz"
  | "typeorpaste"
  // legacy IDs kept for internal routing
  | "exportify"
  | "applemusiccsv"
  | "other"
  | "screenshots";

export interface ServiceTile {
  id: ServiceId;
  label: string;
  hint: string;
}

/** Top-level service tiles shown on the picker screen */
export const SERVICE_TILES: ServiceTile[] = [
  { id: "spotify",      label: "Spotify",        hint: "Import your saved tracks" },
  { id: "applemusic",   label: "Apple Music",    hint: "Import your library" },
  { id: "youtubemusic", label: "YouTube Music",  hint: "Import your library" },
  { id: "lastfm",       label: "Last.fm",        hint: "Import your loved tracks" },
  { id: "listenbrainz", label: "ListenBrainz",   hint: "Import loved recordings by username" },
  { id: "typeorpaste",  label: "Type or paste",  hint: "Type, paste, or screenshot anything" },
];

// ---------------------------------------------------------------------------
// Mode types
// ---------------------------------------------------------------------------

/**
 * service-picker  — initial screen: grid of service tiles
 * service-guide   — per-service instructions (selectedService is set)
 * listenbrainz    — username input for ListenBrainz
 * username        — username disambiguation (LB vs Last.fm)
 * lfm-hint        — Last.fm export guide
 * tracks          — text paste / CSV mode
 * images          — screenshot upload/paste
 * review          — OCR review
 * artist-seeds    — compact chip grid of Lore artists for quick taste seeding
 * avatar          — album-cover avatar picker shown after any completion path
 */
type Mode =
  | "service-picker"
  | "service-guide"
  | "listenbrainz"
  | "username"
  | "tracks"
  | "lfm-hint"
  | "images"
  | "review"
  | "artist-seeds"
  | "avatar";

interface Props {
  onClose(): void;
  onImportStarted?(): void;
  /** @deprecated Spotify is always shown. Kept for callers that still pass it. */
  spotifyImportEnabled?: boolean;
  /**
   * When set, the modal opens directly at that service's guide screen instead
   * of the top-level service picker. Used to reopen at the Spotify guide after
   * a successful OAuth redirect.
   */
  initialService?: ServiceId;
  /**
   * When set to "artist-seeds", the modal opens directly at the artist-seeds
   * chip grid instead of the service picker. Used by the Dial "Edit artists →"
   * shortcut so returning users don't have to navigate through the picker.
   */
  initialMode?: "artist-seeds";
}

// ---------------------------------------------------------------------------
// Import history row (shown at top of picker when a previous import exists)
// ---------------------------------------------------------------------------
function ImportHistoryRow({ job, onClose }: { job: NonNullable<ReturnType<typeof useLatestImportJob>["data"]>; onClose(): void }) {
  const serviceLabel: Record<string, string> = {
    spotify: "Spotify",
    manual: "Paste / CSV",
    listenbrainz: "ListenBrainz",
  };
  const label = serviceLabel[job.service] ?? job.service;
  const isDone = job.status === "done";
  const isRunning = job.status === "running" || job.status === "pending";
  const statusText = isRunning
    ? "In progress…"
    : isDone
    ? `${job.resolved.toLocaleString()} of ${job.total.toLocaleString()} tracks matched`
    : job.status === "error"
    ? "Import failed"
    : "";

  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border px-4 py-2.5"
      style={{ background: "hsl(var(--muted)/0.15)" }}
      data-testid="import-history-row"
    >
      <div className="shrink-0">
        {isDone ? (
          <CheckCircle2 size={13} style={{ color: "hsl(var(--keep))" }} aria-hidden />
        ) : isRunning ? (
          <Loader2 size={13} className="animate-spin" style={{ color: "hsl(var(--primary))" }} aria-hidden />
        ) : (
          <Clock size={13} style={{ color: "hsl(var(--faint))" }} aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <p className="font-mono text-[11px] text-foreground">{label}</p>
        {statusText && (
          <p className="font-mono text-[10px] text-muted-foreground truncate">{statusText}</p>
        )}
      </div>
      {isRunning && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 font-mono text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Track progress
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screenshot drop zone — reusable inline component
// ---------------------------------------------------------------------------
function ScreenshotDropZone({
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFilePick,
  imageRef,
}: {
  isDragging: boolean;
  onDragOver(e: React.DragEvent): void;
  onDragLeave(): void;
  onDrop(e: React.DragEvent): void;
  onFilePick(files: File[]): void;
  imageRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => imageRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Paste or drop a library screenshot"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); imageRef.current?.click(); } }}
      className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-3 font-mono text-[11px] text-muted-foreground transition-colors"
      style={{
        borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
        background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.08)",
      }}
    >
      <ImageIcon size={13} aria-hidden className={isDragging ? "text-primary" : "text-muted-foreground/60"} />
      <span className={isDragging ? "text-primary" : "text-muted-foreground/70"}>
        {isDragging ? "Drop screenshot here" : "Have the library open? Paste or drop a screenshot ↓"}
      </span>
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => { onFilePick(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ManualImportModal({ onClose, onImportStarted, initialService, initialMode }: Props) {
  const [mode, setMode] = useState<Mode>(() => {
    if (initialMode === "artist-seeds") return "artist-seeds";
    if (!initialService) return "service-picker";
    if (initialService === "listenbrainz") return "listenbrainz";
    if (initialService === "lastfm") return "lfm-hint";
    if (initialService === "typeorpaste") return "tracks";
    // spotify, applemusic, youtubemusic → service-guide
    return "service-guide";
  });
  const [selectedService, setSelectedService] = useState<ServiceId | null>(initialService ?? null);
  const [rawInput, setRawInput] = useState("");
  const [lbUsername, setLbUsername] = useState("");
  const [lfmUsername, setLfmUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [images, setImages] = useState<ScreenshotImage[]>([]);
  const [reviewTracks, setReviewTracks] = useState<ReviewTrack[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  /** True while we're waiting for the Spotify OAuth tab to complete. */
  const [spotifyOAuthWaiting, setSpotifyOAuthWaiting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const screenshotInGuideRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lbInputRef = useRef<HTMLInputElement>(null);
  const lfmInputRef = useRef<HTMLInputElement>(null);
  /** Handle to the OAuth tab so we can detect when it closes. */
  const oauthWindowRef = useRef<Window | null>(null);

  // Existing taste seeds — used to pre-select chips when opening in edit mode
  const { data: existingSeeds } = useMyTasteSeeds();

  // Artist-seeds state
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [seedSaving, setSeedSaving] = useState(false);

  // Pre-populate selectedArtists once existingSeeds resolves, but only on the
  // first resolution and only when the modal opened in edit mode (initialMode
  // === "artist-seeds"). A ref guards against re-running if the query refires.
  const preSeededRef = useRef(false);
  useEffect(() => {
    if (initialMode !== "artist-seeds") return;
    if (preSeededRef.current) return;
    if (!Array.isArray(existingSeeds)) return;
    preSeededRef.current = true;
    if (existingSeeds.length > 0) {
      setSelectedArtists(new Set(existingSeeds));
    }
  }, [initialMode, existingSeeds]);
  // Avatar state
  const [avatarChosen, setAvatarChosen] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);

  const qc = useQueryClient();
  const { data: connections } = useMyConnections();
  const { data: latestJob } = useLatestImportJob();
  const hasSpotify = Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Onboarding artists for the chip grid
  const { data: artistFreqData, isLoading: artistFreqLoading } = useGetStationsArtistFrequency({
    query: { queryKey: getGetStationsArtistFrequencyQueryKey(), staleTime: 10 * 60_000 },
  });
  const onboardingArtists = mergeOnboardingArtists(
    artistFreqData?.artists ?? [],
    [],
  );

  // Album avatar data — used to decide whether to show the avatar step
  const { data: albumAvatarData } = useMyAlbumAvatar();
  const setTasteSeeds = useSetTasteSeeds();
  const setAvatarMutation = useSetAlbumAvatar();

  // After any completion path: show avatar if needsChoice, else close
  const maybeShowAvatar = useCallback(() => {
    if (albumAvatarData?.needsChoice) {
      setAvatarChosen(null);
      setMode("avatar");
    } else {
      onClose();
    }
  }, [albumAvatarData, onClose]);

  // Whether we should show the history row at the top of the picker
  const showHistory = latestJob != null && (
    latestJob.status === "done" || latestJob.status === "running" || latestJob.status === "pending"
  );

  // Derived
  const tracks = mode === "tracks" ? parseTracks(rawInput) : reviewTracks;
  const reviewReadyTracks = dedupeTracks(reviewTracks).map(({ artist, title }) => ({ artist, title }));
  const pendingImageCount = images.filter((image) => image.status === "ready" || image.status === "error").length;
  const failedImageCount = images.filter((image) => image.status === "error").length;

  // Focus textarea when switching to tracks mode
  useEffect(() => {
    if (mode === "tracks") {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    if (mode === "listenbrainz") {
      requestAnimationFrame(() => lbInputRef.current?.focus());
    }
    if (mode === "lfm-hint") {
      requestAnimationFrame(() => lfmInputRef.current?.focus());
    }
  }, [mode]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSpotifyDirectImport = async () => {
    if (hasSpotify) {
      setSubmitting(true);
      try {
        await postStartImport("spotify");
        await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
        onImportStarted?.();
        maybeShowAvatar();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed — try again.");
        setSubmitting(false);
      }
    } else {
      setError(null);
      try {
        const win = await startSpotifyLibraryConnect();
        oauthWindowRef.current = win;
        setSpotifyOAuthWaiting(true);
        // Modal stays open — polling effect below watches the tab and connections.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not connect to Spotify.");
      }
    }
  };

  // ── OAuth tab watcher ────────────────────────────────────────────────────

  // Poll while the OAuth tab is open: re-fetch connections every 1.5 s.
  // When the tab closes (or times out), do a definitive fresh fetch before
  // deciding success/failure to avoid a stale-cache false negative.
  useEffect(() => {
    if (!spotifyOAuthWaiting) return;

    const POLL_INTERVAL_MS = 1500;
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    const startedAt = Date.now();
    let stopped = false;

    const tick = async () => {
      if (stopped) return;

      const win = oauthWindowRef.current;
      const elapsed = Date.now() - startedAt;

      const timedOut = elapsed > TIMEOUT_MS;
      const windowClosed = win == null || win.closed;

      if (windowClosed || timedOut) {
        stopped = true;
        clearInterval(interval);
        if (win && !win.closed) win.close();
        oauthWindowRef.current = null;
        setSpotifyOAuthWaiting(false);

        // Await a definitive fresh fetch so we don't read a stale pre-connect
        // snapshot. invalidateQueries is async (fire-and-forget), so calling
        // getQueryData immediately after would race; refetchQueries awaits the
        // network response before returning.
        try {
          await qc.refetchQueries({ queryKey: ME_CONNECTIONS_KEY });
        } catch { /* network error during check — treat as unresolved */ }

        const fresh = qc.getQueryData<{ service: string }[] | null>(ME_CONNECTIONS_KEY);
        const connected = Array.isArray(fresh) && fresh.some((c) => c.service === "spotify");
        if (!connected) {
          setError(
            timedOut
              ? "The connection request timed out — try again."
              : "Spotify wasn't connected. Did you approve the request?",
          );
        }
        // If connected, hasSpotify becomes true naturally via the query; the
        // button label flips to "Import saved tracks" with no extra action needed.
      } else {
        // Keep connections fresh so hasSpotify updates automatically during polling.
        void qc.invalidateQueries({ queryKey: ME_CONNECTIONS_KEY });
      }
    };

    const interval = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);

    return () => { stopped = true; clearInterval(interval); };
  }, [spotifyOAuthWaiting, qc]);

  const handleServiceTileClick = (id: ServiceId) => {
    setError(null);
    setSelectedService(id);
    if (id === "typeorpaste") {
      setMode("tracks");
    } else if (id === "listenbrainz") {
      setMode("listenbrainz");
    } else if (id === "lastfm") {
      setMode("lfm-hint");
    } else {
      setMode("service-guide");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
    setError(null);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRawInput(e.target.value);
    setError(null);
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

  // Drag-and-drop for CSV
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Import actions ───────────────────────────────────────────────────────

  const handleLastFmImport = async () => {
    const username = lfmUsername.trim();
    if (!username) return;
    setError(null);
    setSubmitting(true);
    try {
      await postStartLastFmImport(username);
      await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      onImportStarted?.();
      maybeShowAvatar();
    } catch (err) {
      const isNotFound = err instanceof Error && err.message.includes("404");
      setError(
        isNotFound
          ? "Direct username import isn't available yet — please use the CSV export above."
          : (err instanceof Error ? err.message : "Import failed — check the username and try again."),
      );
      setSubmitting(false);
    }
  };

  const handleListenBrainzImport = async () => {
    const username = lbUsername.trim();
    if (!username) return;
    setError(null);
    setSubmitting(true);
    try {
      await postStartListenBrainzImport(username);
      await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      onImportStarted?.();
      maybeShowAvatar();
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
      onImportStarted?.();
      maybeShowAvatar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed — try again.");
      setSubmitting(false);
    }
  };

  // Artist-seeds: toggle selection up to 30
  const toggleArtist = (artist: string) => {
    setSelectedArtists((prev) => {
      const next = new Set(prev);
      if (next.has(artist)) {
        next.delete(artist);
      } else if (next.size < 30) {
        next.add(artist);
      }
      return next;
    });
  };

  // Artist-seeds "Done": save selected artists as taste seeds, then show avatar if needed
  const handleArtistSeedsDone = async () => {
    if (selectedArtists.size === 0) {
      maybeShowAvatar();
      return;
    }
    setSeedSaving(true);
    try {
      await setTasteSeeds.mutateAsync(Array.from(selectedArtists));
      maybeShowAvatar();
    } catch {
      setError("Couldn't save your artists — try again.");
    } finally {
      setSeedSaving(false);
    }
  };

  // Avatar step: save chosen cover then close
  const handleAvatarConfirm = async () => {
    if (!avatarChosen) { onClose(); return; }
    setAvatarSaving(true);
    try {
      await setAvatarMutation.mutateAsync(avatarChosen);
      onClose();
    } catch {
      setError("Couldn't save your cover — try again.");
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleBack = () => {
    // When opened directly in artist-seeds edit mode (from the Dial shortcut),
    // "back" has nowhere sensible to go — close the modal instead.
    if (initialMode === "artist-seeds" && mode === "artist-seeds") {
      onClose();
      return;
    }
    setMode("service-picker");
    setError(null);
    setSelectedService(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // Avatar mode has no back button — it's a terminal step
  const showBack = mode !== "service-picker" && mode !== "avatar";

  const headerTitle: Partial<Record<Mode, string>> = {
    "service-picker": "Where is your music?",
    "service-guide": selectedService === "spotify" ? "Spotify" :
                     selectedService === "applemusic" ? "Apple Music" :
                     selectedService === "youtubemusic" ? "YouTube Music" :
                     "Import",
    "listenbrainz": "ListenBrainz",
    "lfm-hint": "Last.fm",
    "images": "Library screenshots",
    "review": "Review screenshots",
    "tracks": selectedService === "typeorpaste" ? "Type or paste" : "Paste or upload",
    "username": "Import your tracks",
    "artist-seeds": "Artists you love",
    "avatar": "Choose your cover",
  };

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
        style={{ background: "hsl(var(--card))", maxHeight: "90vh", overflowY: "auto" }}
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
                {headerTitle[mode] ?? "Import your tracks"}
              </h2>
              {mode === "service-picker" && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  Imports are additive — they never remove anything.
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

        {/* ── Import history row ─────────────────────────────────────── */}
        {mode === "service-picker" && showHistory && latestJob && (
          <ImportHistoryRow job={latestJob} onClose={onClose} />
        )}

        {/* ── Service picker ─────────────────────────────────────────── */}
        {mode === "service-picker" && (
          <>
            <div className="flex flex-col gap-2" data-testid="service-picker">
              {/* Quick-start: artist seeds from Lore — always the first option */}
              <button
                type="button"
                data-testid="service-tile-artist-seeds"
                onClick={() => { setError(null); setMode("artist-seeds"); }}
                className="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors"
                style={{
                  background: "hsl(var(--primary)/0.12)",
                  borderColor: "hsl(var(--primary)/0.4)",
                }}
              >
                <div>
                  <p className="font-mono text-[12px] font-semibold" style={{ color: "hsl(var(--primary))" }}>
                    Start with artists you love
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    Pick from Lore's most-played artists — no account needed
                  </p>
                </div>
                <ChevronRight size={14} className="shrink-0" style={{ color: "hsl(var(--primary))" }} aria-hidden />
              </button>

              {/* Divider */}
              <div className="flex items-center gap-2 py-0.5">
                <div className="flex-1 border-t border-border" />
                <span className="font-mono text-[10px] text-muted-foreground/50">or import from a service</span>
                <div className="flex-1 border-t border-border" />
              </div>

              {SERVICE_TILES.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  data-testid={`service-tile-${tile.id}`}
                  onClick={() => handleServiceTileClick(tile.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary"
                  style={{ background: "hsl(var(--muted)/0.2)" }}
                >
                  <div>
                    <p className="font-mono text-[12px] font-semibold text-foreground">{tile.label}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{tile.hint}</p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
            </div>

            {/* "Come back later" callout */}
            <p className="font-mono text-[10px] text-muted-foreground/60 text-center">
              Imports run in the background and are always additive — close anytime and the strip at the top will track progress.
            </p>
          </>
        )}

        {/* ── Spotify service guide ───────────────────────────────────── */}
        {mode === "service-guide" && selectedService === "spotify" && (
          <>
            <div className="flex flex-col gap-3">
              {/* Option 1: Direct connect */}
              <div
                className="rounded-xl border border-border px-4 py-4 flex flex-col gap-3"
                style={{ background: "hsl(var(--muted)/0.2)" }}
              >
                <div>
                  <p className="font-mono text-[12px] font-semibold text-foreground">Connect Spotify</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground leading-relaxed">
                    {hasSpotify
                      ? "Your Spotify account is already connected. Click below to pull your saved tracks."
                      : "This will open Spotify and ask permission to read your saved tracks. Lore never sees your password."}
                  </p>
                </div>
                {error && mode === "service-guide" && (
                  <p className="font-mono text-[11px] text-destructive">{error}</p>
                )}
                {spotifyOAuthWaiting && (
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    <Loader2 size={11} className="animate-spin shrink-0" aria-hidden />
                    Waiting for Spotify authorization in the other tab…
                  </p>
                )}
                <button
                  type="button"
                  disabled={submitting || spotifyOAuthWaiting}
                  onClick={() => void handleSpotifyDirectImport()}
                  className="self-start rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground disabled:opacity-40"
                >
                  {submitting ? "Starting…" : spotifyOAuthWaiting ? "Waiting for Spotify…" : hasSpotify ? "Import saved tracks" : "Connect Spotify"}
                </button>
              </div>

              {/* Option 2: Exportify CSV */}
              <div
                className="rounded-xl border border-border px-4 py-4 flex flex-col gap-2"
                style={{ background: "hsl(var(--muted)/0.1)" }}
              >
                <p className="font-mono text-[12px] font-semibold text-foreground">Export a playlist via Exportify</p>
                <ol className="space-y-1.5 font-mono text-[11px] text-muted-foreground list-none">
                  {[
                    <>Go to <a href="https://exportify.net" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">exportify.net</a> and log in with Spotify.</>,
                    <>Click Export next to the playlist you want.</>,
                    <>Drop the CSV below or paste its contents.</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))" }} aria-hidden>{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload or drop a CSV file"
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                  className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 font-mono text-[11px] text-muted-foreground transition-colors"
                  style={{
                    borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                    background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.08)",
                  }}
                >
                  <Upload size={13} aria-hidden />
                  <span>{isDragging ? "Drop to import" : "Drop CSV or click to browse"}</span>
                  <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
                </div>
              </div>

              {/* Screenshot hint */}
              <ScreenshotDropZone
                isDragging={isDragging}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); void addImages(Array.from(e.dataTransfer.files)); setMode("images"); }}
                onFilePick={(files) => { void addImages(files); setMode("images"); }}
                imageRef={screenshotInGuideRef}
              />
              <input ref={screenshotInGuideRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); setMode("images"); e.target.value = ""; }} />
            </div>
          </>
        )}

        {/* ── Apple Music service guide ────────────────────────────────── */}
        {mode === "service-guide" && selectedService === "applemusic" && (
          <div className="flex flex-col gap-3">
            {/* Option 1: TuneMyMusic CSV */}
            <div className="rounded-xl border border-border px-4 py-4 flex flex-col gap-2" style={{ background: "hsl(var(--muted)/0.2)" }}>
              <p className="font-mono text-[12px] font-semibold text-foreground">Export via TuneMyMusic</p>
              <ol className="space-y-1.5 font-mono text-[11px] text-muted-foreground list-none">
                {[
                  <>Go to <a href="https://www.tunemymusic.com/transfer" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">tunemymusic.com</a> and choose Apple Music as the source.</>,
                  <>Choose "To File" and download the CSV.</>,
                  <>Drop the CSV below or paste its contents.</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))" }} aria-hidden>{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                role="button" tabIndex={0}
                aria-label="Upload or drop a CSV file"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 font-mono text-[11px] text-muted-foreground transition-colors"
                style={{ borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))", background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.08)" }}
              >
                <Upload size={13} aria-hidden />
                <span>{isDragging ? "Drop to import" : "Drop CSV or click to browse"}</span>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
              </div>
            </div>

            {/* Option 2: Screenshot */}
            <div className="rounded-xl border border-border px-4 py-3 flex flex-col gap-2" style={{ background: "hsl(var(--muted)/0.1)" }}>
              <p className="font-mono text-[12px] font-semibold text-foreground">Paste a screenshot</p>
              <p className="font-mono text-[11px] text-muted-foreground">Open your Apple Music library, take a screenshot, and paste it here — we'll recognize the track rows automatically.</p>
              <ScreenshotDropZone
                isDragging={isDragging}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); void addImages(Array.from(e.dataTransfer.files)); setMode("images"); }}
                onFilePick={(files) => { void addImages(files); setMode("images"); }}
                imageRef={screenshotInGuideRef}
              />
              <input ref={screenshotInGuideRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); setMode("images"); e.target.value = ""; }} />
            </div>
          </div>
        )}

        {/* ── YouTube Music service guide ──────────────────────────────── */}
        {mode === "service-guide" && selectedService === "youtubemusic" && (
          <div className="flex flex-col gap-3">
            {/* Primary: Screenshot */}
            <div className="rounded-xl border border-border px-4 py-3 flex flex-col gap-2" style={{ background: "hsl(var(--muted)/0.2)" }}>
              <p className="font-mono text-[12px] font-semibold text-foreground">Paste a screenshot</p>
              <p className="font-mono text-[11px] text-muted-foreground">Open your YouTube Music library, take a screenshot of your liked songs or playlists, and paste it here — we'll recognize the track rows automatically.</p>
              <ScreenshotDropZone
                isDragging={isDragging}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); void addImages(Array.from(e.dataTransfer.files)); setMode("images"); }}
                onFilePick={(files) => { void addImages(files); setMode("images"); }}
                imageRef={screenshotInGuideRef}
              />
              <input ref={screenshotInGuideRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); setMode("images"); e.target.value = ""; }} />
            </div>

            {/* Secondary: TuneMyMusic */}
            <div className="rounded-xl border border-border px-4 py-3 flex flex-col gap-2" style={{ background: "hsl(var(--muted)/0.1)" }}>
              <p className="font-mono text-[12px] font-semibold text-foreground">Export via TuneMyMusic</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                <a href="https://www.tunemymusic.com/transfer" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">tunemymusic.com</a>
                {" "}can export a YouTube Music playlist as a CSV — then drop it here.
              </p>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                role="button" tabIndex={0}
                aria-label="Upload or drop a CSV file"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 font-mono text-[11px] text-muted-foreground transition-colors"
                style={{ borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))", background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.08)" }}
              >
                <Upload size={13} aria-hidden />
                <span>{isDragging ? "Drop to import" : "Drop CSV or click to browse"}</span>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
              </div>
            </div>
          </div>
        )}

        {/* ── Last.fm hint ─────────────────────────────────────────────── */}
        {mode === "lfm-hint" && (
          <>
            {/* Option 1: CSV export (established path) */}
            <div
              className="rounded-xl border border-border px-4 py-4 flex flex-col gap-2"
              style={{ background: "hsl(var(--muted)/0.2)" }}
            >
              <p className="font-mono text-[12px] font-semibold text-foreground">Export your Last.fm loved tracks</p>
              <ol className="space-y-1.5 font-mono text-[11px] text-muted-foreground list-none">
                {[
                  <>Open <a href="https://benjaminbenben.com/lastfm-to-csv/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Last.fm to CSV</a> (free, no login beyond Last.fm).</>,
                  <>Enter your username and export your loved tracks.</>,
                  <>Download the CSV, then drop it below or paste the contents.</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))" }} aria-hidden>{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Upload or drop a CSV file"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 font-mono text-[11px] text-muted-foreground transition-colors"
                style={{
                  borderColor: isDragging ? "hsl(var(--primary))" : "hsl(var(--border))",
                  background: isDragging ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted)/0.08)",
                }}
              >
                <Upload size={13} aria-hidden />
                <span>{isDragging ? "Drop to import" : "Drop CSV or click to browse"}</span>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
              </div>
            </div>

            {/* Option 2: Username import */}
            <div
              className="rounded-xl border border-border px-4 py-4 flex flex-col gap-3"
              style={{ background: "hsl(var(--muted)/0.1)" }}
            >
              <div>
                <p className="font-mono text-[12px] font-semibold text-foreground">Or enter your Last.fm username</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground leading-relaxed">
                  We'll import your loved tracks directly — no CSV export needed. No account connection required.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  ref={lfmInputRef}
                  type="text"
                  value={lfmUsername}
                  onChange={(e) => { setLfmUsername(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleLastFmImport(); }}
                  placeholder="Your Last.fm username"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  spellCheck={false}
                  data-testid="lastfm-username-input"
                />
                <button
                  type="button"
                  onClick={() => void handleLastFmImport()}
                  disabled={!lfmUsername.trim() || submitting}
                  className="shrink-0 rounded-lg border border-primary bg-primary px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  {submitting ? "…" : "Import"}
                </button>
              </div>
              {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}
              {submitting && (
                <p className="font-mono text-[11px] text-muted-foreground">Starting import…</p>
              )}
            </div>

            <ScreenshotDropZone
              isDragging={isDragging}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); void addImages(Array.from(e.dataTransfer.files)); setMode("images"); }}
              onFilePick={(files) => { void addImages(files); setMode("images"); }}
              imageRef={screenshotInGuideRef}
            />
            <input ref={screenshotInGuideRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); setMode("images"); e.target.value = ""; }} />
          </>
        )}

        {/* ── ListenBrainz username input ──────────────────────────────── */}
        {mode === "listenbrainz" && (
          <>
            <div
              className="rounded-lg border border-border px-3 py-3 font-mono text-[11px] text-muted-foreground"
              style={{ background: "hsl(var(--muted)/0.3)" }}
            >
              <p className="font-semibold text-foreground mb-1">Enter your ListenBrainz username</p>
              <p>We'll import your loved recordings using the public ListenBrainz API. No account connection needed.</p>
            </div>

            <div className="flex gap-2">
              <input
                ref={lbInputRef}
                type="text"
                value={lbUsername}
                onChange={(e) => { setLbUsername(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void handleListenBrainzImport(); }}
                placeholder="Your ListenBrainz username"
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
                data-testid="listenbrainz-username-input"
              />
              <button
                type="button"
                onClick={() => void handleListenBrainzImport()}
                disabled={!lbUsername.trim() || submitting}
                className="shrink-0 rounded-lg border border-primary bg-primary px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {submitting ? "…" : "Import"}
              </button>
            </div>

            {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}

            {submitting && (
              <p className="font-mono text-[11px] text-muted-foreground">Starting import…</p>
            )}
          </>
        )}

        {/* ── "Type or paste" mode / tracks mode ─────────────────────── */}
        {mode === "tracks" && (
          <>
            {/* Service summary banner for CSV services */}
            {(selectedService === "exportify" || selectedService === "applemusiccsv") && (
              <div
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[10px] text-muted-foreground"
                style={{ background: "hsl(var(--muted)/0.15)" }}
                data-testid="service-summary-banner"
              >
                <FileText size={10} aria-hidden className="shrink-0" />
                <span>
                  {selectedService === "exportify"
                    ? "Importing from Exportify — paste or drop your CSV"
                    : "Importing from TuneMyMusic — paste or drop your CSV"}
                </span>
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={rawInput}
              onChange={handleTextareaChange}
              placeholder={
                selectedService === "typeorpaste" || selectedService === null
                  ? "David Bowie – Space Oddity\nFrank Ocean – Pyramids\nNina Simone – Feeling Good\n…\n\nPaste an Artist – Title list, a CSV with artist and title columns, or drop a file."
                  : "Artist – Title\nArtist – Title\n…"
              }
              rows={7}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
              data-testid="tracks-textarea"
            />

            {/* File upload + Screenshot inline */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Upload size={11} aria-hidden />
                Upload file
              </button>
              <button
                type="button"
                onClick={() => { setMode("images"); setSelectedService("screenshots"); }}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <ImageIcon size={11} aria-hidden />
                Paste screenshot
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.json" className="hidden" onChange={handleFileInput} />
            </div>

            {/* Parse preview */}
            {rawInput.trim() && tracks.length > 0 && (
              <div
                className="rounded-lg border border-border overflow-hidden"
                style={{ background: "hsl(var(--muted)/0.15)" }}
                data-testid="track-preview"
              >
                <div className="px-3 py-1.5 border-b border-border/50 font-mono text-[10px] text-muted-foreground">
                  <span className="text-foreground">{tracks.length.toLocaleString()}</span> tracks found
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: "200px" }} data-testid="track-preview-list">
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
                  ? "Couldn\u2019t find \u2018Track Name\u2019 or \u2018Artist Name(s)\u2019 columns \u2014 try re-exporting your CSV"
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

            <p className="font-mono text-[10px] text-muted-foreground/60">
              <FileText size={10} className="inline mr-1 -mt-px" aria-hidden />
              Accepts any CSV with artist and title columns, or lines of Artist – Title.
            </p>
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

        {/* ── Artist seeds — compact chip grid ───────────────────────────── */}
        {mode === "artist-seeds" && (
          <>
            <p className="font-mono text-[11px] text-muted-foreground">
              Pick the artists you love. Lore will show you live when they're on air.
            </p>

            {/* Chip grid */}
            <div className="import-modal-chips" role="group" aria-label="Select artists">
              {artistFreqLoading && onboardingArtists.length === 0 && (
                <span className="font-mono text-[11px] text-muted-foreground/60">Loading artists…</span>
              )}
              {onboardingArtists.slice(0, 80).map((a) => {
                const key = liveIdentityKey(a.artist);
                const selected = selectedArtists.has(a.artist);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? "Deselect" : "Select"} ${a.artist}`}
                    onClick={() => toggleArtist(a.artist)}
                    className={`import-modal-chip${selected ? " import-modal-chip--selected" : ""}${a.live ? " import-modal-chip--live" : ""}`}
                  >
                    {a.live && (
                      <span className="import-modal-chip__dot" aria-hidden />
                    )}
                    {a.artist}
                  </button>
                );
              })}
              {!artistFreqLoading && onboardingArtists.length === 0 && (
                <span className="font-mono text-[11px] text-muted-foreground/60">
                  No artists available right now — come back soon or import a library above.
                </span>
              )}
            </div>

            {selectedArtists.size >= 30 && (
              <p className="font-mono text-[10px] text-muted-foreground/70" role="status">
                30 artists selected — deselect one to choose another.
              </p>
            )}

            {error && (
              <p className="font-mono text-[11px] text-destructive" role="alert">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setMode("service-picker"); setError(null); }}
                className="rounded-full border border-border px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleArtistSeedsDone()}
                disabled={seedSaving}
                className="rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground disabled:opacity-40"
              >
                {seedSaving
                  ? "Saving…"
                  : selectedArtists.size > 0
                  ? `Done — ${selectedArtists.size} artist${selectedArtists.size === 1 ? "" : "s"} selected`
                  : "Skip"}
              </button>
            </div>
          </>
        )}

        {/* ── Avatar picker ─────────────────────────────────────────────── */}
        {mode === "avatar" && (
          <>
            <p className="font-mono text-[11px] text-muted-foreground">
              Your listener cover is anonymous — it only appears as "listening here" on a station, never with your name.
            </p>

            {albumAvatarData?.needsChoice && albumAvatarData.candidates.length > 0 ? (
              <>
                <div className="import-modal-avatar-grid" role="group" aria-label="Choose a cover">
                  {albumAvatarData.candidates.slice(0, 12).map((c) => {
                    const chosen = avatarChosen === c.recordingMbid;
                    return (
                      <button
                        key={c.recordingMbid}
                        type="button"
                        aria-pressed={chosen}
                        aria-label={`${chosen ? "Selected:" : "Choose"} ${c.albumTitle} by ${c.artist}`}
                        onClick={() => setAvatarChosen(c.recordingMbid)}
                        className={`import-modal-avatar-cell${chosen ? " import-modal-avatar-cell--chosen" : ""}`}
                      >
                        <img
                          src={c.artworkUrl}
                          alt={`${c.albumTitle} by ${c.artist}`}
                          className="import-modal-avatar-img"
                          loading="lazy"
                        />
                      </button>
                    );
                  })}
                </div>
                {avatarChosen && (() => {
                  const c = albumAvatarData.candidates.find((x) => x.recordingMbid === avatarChosen);
                  return c ? (
                    <p className="font-mono text-[10px] text-muted-foreground text-center">
                      {c.albumTitle} · {c.artist}
                    </p>
                  ) : null;
                })()}
              </>
            ) : (
              <p className="font-mono text-[11px] text-muted-foreground/60">
                {albumAvatarData?.needsChoice ? "Loading your covers…" : "You're all set — cover already chosen."}
              </p>
            )}

            {error && (
              <p className="font-mono text-[11px] text-destructive" role="alert">{error}</p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleAvatarConfirm()}
                disabled={avatarSaving || (albumAvatarData?.needsChoice === true && !avatarChosen)}
                className="rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground disabled:opacity-40"
              >
                {avatarSaving ? "Saving…" : avatarChosen ? "Use this cover" : "Continue →"}
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

      </div>
    </div>
  );
}
