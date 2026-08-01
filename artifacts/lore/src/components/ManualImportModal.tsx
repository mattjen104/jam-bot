import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { X, Upload, FileText, ArrowLeft, ChevronRight } from "lucide-react";
import {
  postStartManualImport,
  postStartListenBrainzImport,
  ME_LATEST_IMPORT_JOB_KEY,
} from "../lib/meHooks";
import { useQueryClient } from "@tanstack/react-query";

interface Track { artist: string; title: string }

// ---------------------------------------------------------------------------
// Parsers (unchanged from previous implementation)
// ---------------------------------------------------------------------------

function parseCsv(text: string): Track[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());

  const titleIdx = headers.findIndex((h) =>
    h === "track name" || h === "name" || h === "title" || h === "song",
  );
  const artistIdx = headers.findIndex((h) =>
    h === "artist name" || h === "artist" || h === "artist(s)" || h === "artists",
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

function splitCsvLine(line: string): string[] {
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

function parsePlainText(text: string): Track[] {
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

function parseTracks(text: string): Track[] {
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
// Mode types
// ---------------------------------------------------------------------------

/**
 * input     — initial state: combined text input + file drop zone
 * username  — single token submitted; showing LB / Last.fm disambiguation
 * tracks    — multiline content detected; textarea + parse count
 * lfm-hint  — user tapped Last.fm from disambiguation; showing export hint
 */
type Mode = "input" | "username" | "tracks" | "lfm-hint";

interface Props { onClose(): void }

export function ManualImportModal({ onClose }: Props) {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("input");
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const singleInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();

  // Derived
  const tracks = mode === "tracks" ? parseTracks(rawInput) : [];
  const detectedUsername = mode === "username" ? rawInput.trim() : "";

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
    if (tracks.length === 0) { setError("No tracks found — check the format below."); return; }
    setError(null);
    setSubmitting(true);
    try {
      await postStartManualImport(tracks);
      await qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed — try again.");
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setMode("input");
    setError(null);
    // Keep rawInput so the user doesn't lose what they typed
    requestAnimationFrame(() => singleInputRef.current?.focus());
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const showBack = mode !== "input";

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
                {mode === "username" ? "Import your tracks" :
                 mode === "lfm-hint" ? "Import from Last.fm" :
                 "Import your tracks"}
              </h2>
              {mode === "input" && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  Enter a username, paste tracks, or drop a file.
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

        {/* ── Input mode ─────────────────────────────────────────────── */}
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
                placeholder="Username or paste tracks here…"
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
              Accepts ListenBrainz / Last.fm usernames, Spotify Exportify CSV, or lines of Artist – Title.
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

        {/* ── Tracks mode ────────────────────────────────────────────────── */}
        {mode === "tracks" && (
          <>
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
              placeholder={"Artist – Title\nArtist – Title\n…"}
              rows={8}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
            />

            {/* Parse preview */}
            {rawInput.trim() && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {tracks.length > 0
                  ? <><span className="text-foreground">{tracks.length.toLocaleString()}</span> tracks found</>
                  : <span className="text-destructive">No tracks recognised — check the format above.</span>}
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
                {submitting ? "Starting…" : `Import ${tracks.length > 0 ? tracks.length.toLocaleString() + " " : ""}tracks`}
              </button>
            </div>

            {/* Inline tip */}
            <p className="font-mono text-[10px] text-muted-foreground/60">
              <FileText size={10} className="inline mr-1 -mt-px" aria-hidden />
              Accepts Spotify Exportify CSV, Apple Music CSV, or lines of Artist – Title.
            </p>
          </>
        )}

        {/* ── Spotify advanced link (all modes except lfm-hint) ─────────── */}
        {mode !== "lfm-hint" && (
          <p className="font-mono text-[10px] text-muted-foreground/50 border-t border-border/50 pt-3 -mb-1">
            Advanced:{" "}
            <a
              href="/library"
              className="underline underline-offset-2 hover:text-muted-foreground"
              onClick={(e) => { e.preventDefault(); onClose(); navigate("/library"); }}
            >
              use your own Spotify credentials
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
