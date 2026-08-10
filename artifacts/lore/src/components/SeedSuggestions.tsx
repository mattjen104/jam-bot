import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useGetStationsPopularArtists,
  getGetStationsPopularArtistsQueryKey,
  useGetStationsRecentArtists,
  getGetStationsRecentArtistsQueryKey,
} from "@workspace/api-client-react";
import { liveIdentityKey, type LiveArtistSuggestion } from "../hooks/useDialData";
import { postExtractLibraryImages } from "../lib/meHooks";

// ---------------------------------------------------------------------------
// SeedSuggestions — quick-add artist chips below the onboarding SeedInput.
//
// Three rows, strongest signal first:
//   On right now      — artists live on a dial station this second
//   Playing recently  — artists aired in the last few hours (not live now)
//   Popular on Lore   — top artists by 7-day spin count (server endpoint)
//
// Tapping a chip adds the artist as a taste seed via the caller's onAddSeed
// (which drives PUT /api/me/taste-seeds). Already-added artists show a
// checked state and stay tappable-off only via the seed chip list above.
// ---------------------------------------------------------------------------

const ROW_COLLAPSED_COUNT = 6;
const MAX_SEEDS = 50;

function SuggestionRow({
  label,
  hint,
  items,
  seedKeys,
  atLimit,
  onAddSeed,
}: {
  label: string;
  hint?: string;
  items: { artist: string; context: string | null }[];
  seedKeys: Set<string>;
  atLimit: boolean;
  onAddSeed: (artist: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, ROW_COLLAPSED_COUNT);
  return (
    <div className="seed-suggest__row">
      <div className="seed-suggest__row-head">
        <span className="seed-suggest__row-label">{label}</span>
        {hint && <span className="seed-suggest__row-hint">{hint}</span>}
      </div>
      <div className="seed-suggest__chips">
        {visible.map((item) => {
          const selected = seedKeys.has(liveIdentityKey(item.artist));
          return (
            <button
              key={item.artist.toLocaleLowerCase()}
              type="button"
              className={`seed-suggest__chip${selected ? " seed-suggest__chip--selected" : ""}`}
              aria-pressed={selected}
              disabled={selected || atLimit}
              title={item.context ?? undefined}
              onClick={() => onAddSeed(item.artist)}
            >
              {selected ? "✓ " : "+ "}{item.artist}
            </button>
          );
        })}
        {items.length > ROW_COLLAPSED_COUNT && (
          <button
            type="button"
            className="seed-suggest__chip seed-suggest__chip--more"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "less" : `+${items.length - ROW_COLLAPSED_COUNT} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screenshot → artist candidates (existing vision endpoint, wired to seeds)
// ---------------------------------------------------------------------------

async function fileToBase64(file: File): Promise<{ mediaType: string; data: string }> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
  return { mediaType: file.type || "image/png", data };
}

/** Extract unique artist names from screenshot files via the vision endpoint. */
export async function extractArtistsFromImageFiles(files: File[]): Promise<string[]> {
  const images = await Promise.all(files.map(fileToBase64));
  const { results } = await postExtractLibraryImages(images);
  const seen = new Set<string>();
  const artists: string[] = [];
  for (const result of results) {
    if (result.status !== "ok") continue;
    for (const track of result.tracks ?? []) {
      const artist = track.artist.replace(/\s+/g, " ").trim();
      const key = liveIdentityKey(artist);
      if (!artist || !key || seen.has(key)) continue;
      seen.add(key);
      artists.push(artist);
    }
  }
  return artists;
}

export function imageFilesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  const files: File[] = [];
  if (!list) return files;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const file = entry instanceof File ? entry : (entry as DataTransferItem).getAsFile?.();
    if (file && file.type.startsWith("image/")) files.push(file);
  }
  return files;
}

export function SeedSuggestions({
  liveSuggestions,
  seeds,
  onAddSeed,
  children,
}: {
  liveSuggestions: LiveArtistSuggestion[];
  seeds: string[];
  onAddSeed: (artist: string) => void;
  /** Rendered inside the drop target, above the suggestion rows (the SeedInput). */
  children?: ReactNode;
}) {
  const { data: popularData, isLoading: popularLoading } = useGetStationsPopularArtists({
    query: {
      queryKey: getGetStationsPopularArtistsQueryKey(),
      staleTime: 10 * 60_000,
    },
  });
  // Server-side rolling 4h window — immune to calendar-midnight boundaries
  // and the per-station timeline cap that limit the client's spin data.
  const { data: recentData } = useGetStationsRecentArtists({
    query: {
      queryKey: getGetStationsRecentArtistsQueryKey(),
      staleTime: 5 * 60_000,
    },
  });

  const seedKeys = useMemo(
    () => new Set(seeds.map((seed) => liveIdentityKey(seed))),
    [seeds],
  );
  const atLimit = seeds.length >= MAX_SEEDS;

  const liveItems = useMemo(() => liveSuggestions.map((s) => ({
    artist: s.artist,
    context: [s.showName, s.stationName, "live now"].filter(Boolean).join(" · ") || null,
  })), [liveSuggestions]);

  const recentItems = useMemo(() => {
    const liveKeys = new Set(liveSuggestions.map((s) => liveIdentityKey(s.artist)));
    const seen = new Set<string>();
    const items: { artist: string; context: string | null }[] = [];
    for (const item of recentData?.artists ?? []) {
      const artist = item.artist.replace(/\s+/g, " ").trim();
      const key = liveIdentityKey(artist);
      if (!artist || !key || seen.has(key) || liveKeys.has(key)) continue;
      seen.add(key);
      items.push({ artist, context: item.stationName || null });
    }
    return items;
  }, [recentData, liveSuggestions]);

  const popularItems = useMemo(() => {
    const items: { artist: string; context: string | null }[] = [];
    const seen = new Set<string>();
    for (const item of popularData?.artists ?? []) {
      const artist = item.artist.replace(/\s+/g, " ").trim();
      const key = liveIdentityKey(artist);
      if (!artist || !key || seen.has(key)) continue;
      seen.add(key);
      items.push({
        artist,
        context: item.playCount != null ? `${item.playCount} plays this week` : null,
      });
    }
    return items;
  }, [popularData]);

  // ── screenshot extraction state ────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runExtraction = useCallback(async (files: File[]) => {
    if (files.length === 0 || extracting) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const artists = await extractArtistsFromImageFiles(files);
      if (artists.length === 0) {
        setExtractError("No artist names found in that image.");
      } else {
        setCandidates((prev) => {
          const keys = new Set(prev.map((a) => liveIdentityKey(a)));
          return [...prev, ...artists.filter((a) => !keys.has(liveIdentityKey(a)))];
        });
      }
    } catch {
      setExtractError("Couldn't read that image. Try again.");
    } finally {
      setExtracting(false);
    }
  }, [extracting]);

  const candidateItems = useMemo(
    () => candidates.filter((artist) => !seedKeys.has(liveIdentityKey(artist))),
    [candidates, seedKeys],
  );

  return (
    <div
      className={`seed-suggest${dragOver ? " seed-suggest--dragover" : ""}`}
      onDragOver={(e) => {
        if (imageFilesFrom(e.dataTransfer.items).length > 0 || e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const files = imageFilesFrom(e.dataTransfer.files);
        if (files.length === 0) return;
        e.preventDefault();
        setDragOver(false);
        void runExtraction(files);
      }}
      onPaste={(e) => {
        const files = imageFilesFrom(e.clipboardData?.files);
        if (files.length === 0) return;
        e.preventDefault();
        void runExtraction(files);
      }}
    >
      {children}

      {/* Screenshot path — the vision endpoint already exists; this makes it
          reachable from onboarding: drop/paste anywhere in this block, or tap. */}
      <div className="seed-suggest__ocr">
        <button
          type="button"
          className="seed-suggest__ocr-btn"
          disabled={extracting}
          onClick={() => fileInputRef.current?.click()}
        >
          {extracting ? "Reading screenshot…" : "or add artists from a screenshot"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = imageFilesFrom(e.target.files);
            e.target.value = "";
            void runExtraction(files);
          }}
        />
        {extractError && (
          <div className="seed-suggest__ocr-error" role="alert">{extractError}</div>
        )}
        {candidateItems.length > 0 && (
          <div className="seed-suggest__row" role="group" aria-label="Artists found in your screenshot">
            <div className="seed-suggest__row-head">
              <span className="seed-suggest__row-label">Found in your screenshot</span>
              <button
                type="button"
                className="seed-suggest__row-action"
                disabled={atLimit}
                onClick={() => candidateItems.forEach((artist) => onAddSeed(artist))}
              >
                Add all
              </button>
              <button
                type="button"
                className="seed-suggest__row-action"
                onClick={() => setCandidates([])}
              >
                Dismiss
              </button>
            </div>
            <div className="seed-suggest__chips">
              {candidateItems.map((artist) => (
                <button
                  key={artist.toLocaleLowerCase()}
                  type="button"
                  className="seed-suggest__chip"
                  disabled={atLimit}
                  onClick={() => onAddSeed(artist)}
                >
                  + {artist}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <SuggestionRow
        label="On right now"
        hint="live this second"
        items={liveItems}
        seedKeys={seedKeys}
        atLimit={atLimit}
        onAddSeed={onAddSeed}
      />
      <SuggestionRow
        label="Playing recently"
        hint="last few hours"
        items={recentItems}
        seedKeys={seedKeys}
        atLimit={atLimit}
        onAddSeed={onAddSeed}
      />
      <SuggestionRow
        label="Popular on Lore"
        hint="this week"
        items={popularItems}
        seedKeys={seedKeys}
        atLimit={atLimit}
        onAddSeed={onAddSeed}
      />
      {popularLoading && popularItems.length === 0 && liveItems.length === 0 && recentItems.length === 0 && (
        <div className="seed-suggest__loading" role="status">Listening for artists on air…</div>
      )}
      {atLimit && (
        <div className="seed-suggest__limit" role="status">
          Seed limit reached — remove an artist above to add another.
        </div>
      )}
    </div>
  );
}
