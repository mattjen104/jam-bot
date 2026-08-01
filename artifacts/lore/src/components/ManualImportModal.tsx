import { useState, useRef } from "react";
import { X, Upload, FileText } from "lucide-react";
import { postStartManualImport, ME_LATEST_IMPORT_JOB_KEY } from "../lib/meHooks";
import { useQueryClient } from "@tanstack/react-query";

interface Track { artist: string; title: string }

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into tracks.  Handles Spotify Exportify headers
 * ("Track Name", "Artist Name") and Apple Music export headers
 * ("Name", "Artist").  Falls back to the first two columns if neither
 * header pattern matches.
 */
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

/** Minimal CSV column splitter — handles quoted fields. */
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

/**
 * Parse plain-text lines of the form "Artist – Title" or "Artist - Title".
 * Lines without a separator are skipped.
 */
function parsePlainText(text: string): Track[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // Match "Artist – Title" or "Artist - Title" (greedy artist, last sep is the split point)
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
  // Heuristic: if the first non-empty line contains commas, try CSV first.
  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  if (firstLine.includes(",")) {
    const csv = parseCsv(trimmed);
    if (csv.length > 0) return csv;
  }
  return parsePlainText(trimmed);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props { onClose(): void }

export function ManualImportModal({ onClose }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const tracks = parseTracks(text);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setText(content);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
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
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm font-semibold text-foreground">Import your tracks</h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              Paste a track list or upload a CSV from Spotify, Apple Music, or any service.
            </p>
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

        {/* Format hints */}
        <div
          className="rounded-lg border border-border px-3 py-2.5 font-mono text-[10px] text-muted-foreground"
          style={{ background: "hsl(var(--muted)/0.3)" }}
        >
          <p className="mb-1 font-semibold text-foreground/70 uppercase tracking-wide">Accepted formats</p>
          <ul className="space-y-0.5">
            <li>• CSV from <span className="text-foreground/80">Spotify Exportify</span> or <span className="text-foreground/80">Apple Music</span> export</li>
            <li>• One track per line: <span className="text-foreground/80">Artist – Title</span> or <span className="text-foreground/80">Artist - Title</span></li>
          </ul>
        </div>

        {/* File upload */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Upload size={11} aria-hidden />
            Upload CSV
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">or paste below</span>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
        </div>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Artist – Title\nArtist – Title\n…"}
          rows={8}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          spellCheck={false}
        />

        {/* Parse preview */}
        {text.trim() && (
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
            onClick={() => void handleSubmit()}
            disabled={submitting || tracks.length === 0}
            className="rounded-full border border-primary bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {submitting ? "Starting…" : `Import ${tracks.length > 0 ? tracks.length.toLocaleString() + " " : ""}tracks`}
          </button>
        </div>

        {/* Inline tip */}
        <p className="font-mono text-[10px] text-muted-foreground/60">
          <FileText size={10} className="inline mr-1 -mt-px" aria-hidden />
          Matching runs overnight for unrecognised tracks. Spotify users: connect your account for richer matching.
        </p>
      </div>
    </div>
  );
}
