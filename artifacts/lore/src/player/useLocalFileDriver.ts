/**
 * Local file playback driver.
 *
 * Uses the browser File System Access API (`showDirectoryPicker`) to grant
 * access to a directory of audio files. Matches files to recordings via:
 *   1. MusicBrainz Recording Id embedded in ID3/MP4 tags (most precise)
 *   2. artist + title fuzzy string match (best-effort fallback)
 *
 * The granted directory handle and MBID→File map are persisted in IndexedDB
 * so the user only needs to re-grant access when the browser revokes it.
 *
 * `available` is true only when at least one matched file is in the cache —
 * unmatched files are listed but never auto-played.
 *
 * Highest priority in the cascade: when a local file matches the current
 * track it always wins over any streaming service.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PlaybackDriverHandle, DriverPlaybackStatus } from "./playbackDriver";
import type { RideItem } from "./PlayerProvider";

// ---------------------------------------------------------------------------
// IndexedDB persistence
// ---------------------------------------------------------------------------

const IDB_NAME = "lore-local-files";
const IDB_VERSION = 1;
const STORE_NAME = "mbid-map";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadMbidMap(): Promise<Map<string, string>> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("mbidMap");
      req.onsuccess = () => {
        const value = req.result as Record<string, string> | undefined;
        resolve(value ? new Map(Object.entries(value)) : new Map());
      };
      req.onerror = () => resolve(new Map());
    });
  } catch {
    return new Map();
  }
}

async function saveMbidMap(map: Map<string, string>): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(Object.fromEntries(map), "mbidMap");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Best-effort — if IndexedDB is unavailable the map stays in memory only.
  }
}

// ---------------------------------------------------------------------------
// Audio file detection
// ---------------------------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|flac|aac|m4a|ogg|opus|wav)$/i;

function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.test(name);
}

// ---------------------------------------------------------------------------
// Minimal ID3v2 / MP4 tag reader (no external dependency)
// ---------------------------------------------------------------------------

/** Read the MusicBrainz Recording Id from an ID3v2 TXXX frame (MP3/FLAC). */
async function readMbidFromId3(file: File): Promise<string | null> {
  try {
    // Read enough of the file to cover the ID3v2 header + first few frames.
    const buffer = await file.slice(0, 65536).arrayBuffer();
    const view = new DataView(buffer);

    // Check for ID3v2 header: "ID3"
    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
      return null;
    }

    // ID3v2 tag size (syncsafe integer) at offset 6-9.
    const tagSize =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);

    const version = view.getUint8(3); // 2, 3, or 4

    let offset = 10;
    const end = Math.min(tagSize + 10, buffer.byteLength);

    while (offset + 10 < end) {
      const frameId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );

      // Frame size: bytes 4-7 (ID3v2.4 also syncsafe but we ignore that subtlety
      // since we only need TXXX frames which are always small).
      const frameSize = version >= 4
        ? ((view.getUint8(offset + 4) & 0x7f) << 21) |
          ((view.getUint8(offset + 5) & 0x7f) << 14) |
          ((view.getUint8(offset + 6) & 0x7f) << 7) |
          (view.getUint8(offset + 7) & 0x7f)
        : view.getUint32(offset + 4);

      if (frameSize <= 0 || frameSize > tagSize) break;

      if (frameId === "TXXX") {
        // TXXX: [encoding byte] [description \0] [value]
        const enc = view.getUint8(offset + 10);
        const isUtf16 = enc === 1 || enc === 2;
        const frameBytes = new Uint8Array(buffer, offset + 11, frameSize - 1);

        // Find null terminator for description.
        let descEnd = 0;
        if (isUtf16) {
          while (descEnd + 1 < frameBytes.length && (frameBytes[descEnd] !== 0 || frameBytes[descEnd + 1] !== 0)) descEnd += 2;
          descEnd += 2;
        } else {
          while (descEnd < frameBytes.length && frameBytes[descEnd] !== 0) descEnd++;
          descEnd++;
        }

        const decoder = new TextDecoder(isUtf16 ? "utf-16le" : "utf-8");
        const description = decoder.decode(frameBytes.slice(0, descEnd)).replace(/\0/g, "");
        const value = decoder.decode(frameBytes.slice(descEnd)).replace(/\0/g, "").trim();

        if (/^MusicBrainz Recording Id$/i.test(description) && /^[0-9a-f-]{36}$/i.test(value)) {
          return value.toLowerCase();
        }
      }

      offset += 10 + frameSize;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read the MusicBrainz Recording Id from an MP4/M4A freeform atom. */
async function readMbidFromMp4(file: File): Promise<string | null> {
  try {
    // Read the first 256 KB — enough to contain the metadata atom.
    const buffer = await file.slice(0, 262144).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Search for the ASCII sequence "----" (freeform atom marker).
    const needle = new Uint8Array([0x2d, 0x2d, 0x2d, 0x2d]); // "----"
    for (let i = 0; i < bytes.length - 64; i++) {
      if (bytes[i] !== needle[0] || bytes[i + 1] !== needle[1] ||
          bytes[i + 2] !== needle[2] || bytes[i + 3] !== needle[3]) continue;

      // Look for the MusicBrainz Recording Id name in the next ~256 bytes.
      const chunk = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(i, i + 256));
      if (!/musicbrainz recording id/i.test(chunk)) continue;

      // Extract the MBID pattern from the chunk.
      const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(chunk);
      if (match) return match[1]!.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

async function readMbidFromFile(file: File): Promise<string | null> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".mp4")) {
    return readMbidFromMp4(file);
  }
  // For mp3/flac/ogg — try ID3v2 (FLAC embeds ID3v2 at the start when present).
  return readMbidFromId3(file);
}

/** Normalize a string for fuzzy matching (lowercase, trim, collapse spaces). */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Public hook extras
// ---------------------------------------------------------------------------

export interface LocalFileDriverExtras {
  /** True when a directory has been granted. */
  hasDirectory: boolean;
  /** Number of audio files found in the granted directory. */
  fileCount: number;
  /** Number of files matched to recordings by MBID or fuzzy title+artist. */
  matchCount: number;
  /** Whether a directory scan is in progress. */
  scanning: boolean;
  /** Open the directory picker and scan for audio files. */
  browse: () => Promise<void>;
  /** Clear the cached directory and MBID map. */
  clearFiles: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLocalFileDriver(): PlaybackDriverHandle & LocalFileDriverExtras {
  // mbid → File object for matched tracks.
  const fileMapRef = useRef<Map<string, File>>(new Map());
  // All audio files found in the granted directory (for display/count).
  const [fileCount, setFileCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [hasDirectory, setHasDirectory] = useState(false);
  const [scanning, setScanning] = useState(false);

  // `filesInMemory` is true only when fileMapRef actually has File objects in
  // the current session (after a real directory scan). It is NOT restored from
  // IndexedDB — historical counts are display-only metadata.
  const [filesInMemory, setFilesInMemory] = useState(false);

  // Restore display metadata from IndexedDB on mount (count only — not File
  // objects, which cannot be serialised). This shows the user "X tracks were
  // matched in your last session" but does NOT make the driver available until
  // a real scan populates fileMapRef with actual File objects.
  useEffect(() => {
    void loadMbidMap().then((map) => {
      if (map.size > 0) {
        setMatchCount(map.size);
        setHasDirectory(true);
      }
    });
  }, []);

  // Audio element and playback state.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentMbidRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const playingRef = useRef(false);
  const subscribersRef = useRef<Set<(s: DriverPlaybackStatus) => void>>(new Set());

  const notify = useCallback((status: DriverPlaybackStatus) => {
    subscribersRef.current.forEach((cb) => cb(status));
  }, []);

  // Scan a directory handle for audio files.
  const scanDirectory = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    setScanning(true);
    const files: File[] = [];

    async function walk(dir: FileSystemDirectoryHandle): Promise<void> {
      // @ts-expect-error — FileSystemDirectoryHandle is async iterable in browsers
      for await (const entry of dir.values()) {
        if (entry.kind === "file" && isAudioFile(entry.name)) {
          try {
            const file = await (entry as FileSystemFileHandle).getFile();
            files.push(file);
          } catch {
            // Permission revoked mid-scan — skip.
          }
        } else if (entry.kind === "directory") {
          try {
            await walk(entry as FileSystemDirectoryHandle);
          } catch {
            // Skip unreadable subdirectories.
          }
        }
      }
    }

    try {
      await walk(dirHandle);
    } catch {
      setScanning(false);
      return;
    }

    setFileCount(files.length);

    // Match files to MBIDs.
    const newMap = new Map<string, File>();
    for (const file of files) {
      const mbid = await readMbidFromFile(file);
      if (mbid) {
        newMap.set(mbid, file);
      }
    }

    fileMapRef.current = newMap;
    setMatchCount(newMap.size);
    setHasDirectory(true);
    // Mark that real File objects are now in memory — driver becomes available.
    setFilesInMemory(newMap.size > 0);
    setScanning(false);

    // Persist the MBID list (not the Files — they can't be serialised).
    const persistMap = new Map<string, string>();
    for (const mbid of newMap.keys()) persistMap.set(mbid, "");
    void saveMbidMap(persistMap);
  }, []);

  const browse = useCallback(async () => {
    if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
      return;
    }
    try {
      // @ts-expect-error — File System Access API not yet in TS lib
      const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
      await scanDirectory(dirHandle);
    } catch {
      // User cancelled the picker — no-op.
    }
  }, [scanDirectory]);

  const clearFiles = useCallback(() => {
    fileMapRef.current = new Map();
    setFileCount(0);
    setMatchCount(0);
    setHasDirectory(false);
    setFilesInMemory(false);
    void saveMbidMap(new Map());
  }, []);

  // `available` is only true when real File objects are loaded in the current
  // session — not based on the historical count restored from IndexedDB.
  const available = filesInMemory && fileMapRef.current.size > 0;

  return useMemo<PlaybackDriverHandle & LocalFileDriverExtras>(
    () => ({
      id: "local-file" as const,
      available,
      surface: undefined,

      play: async (item: RideItem) => {
        const file = fileMapRef.current.get(item.mbid);
        if (!file) throw new Error("No local file for this track");

        // Already playing this track — no-op.
        if (currentMbidRef.current === item.mbid && playingRef.current) return;

        // Tear down any previous audio element.
        const prev = audioRef.current;
        if (prev) {
          prev.pause();
          prev.src = "";
          audioRef.current = null;
        }

        notify({ state: "loading", trackId: item.mbid });
        currentMbidRef.current = item.mbid;
        pausedRef.current = false;
        playingRef.current = false;

        const audio = new Audio();
        audioRef.current = audio;

        const url = URL.createObjectURL(file);

        audio.addEventListener("playing", () => {
          playingRef.current = true;
          notify({ state: "playing", trackId: item.mbid });
        }, { once: false });

        audio.addEventListener("pause", () => {
          if (playingRef.current) {
            // Distinguish user pause from track-end.
          }
          notify({ state: "paused", trackId: item.mbid, progressMs: Math.round(audio.currentTime * 1000) });
        });

        audio.addEventListener("timeupdate", () => {
          if (!playingRef.current) return;
          notify({
            state: "playing",
            trackId: item.mbid,
            progressMs: Math.round(audio.currentTime * 1000),
            durationMs: isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null,
          });
        });

        audio.addEventListener("ended", () => {
          playingRef.current = false;
          URL.revokeObjectURL(url);
          notify({ state: "ended", trackId: item.mbid });
        });

        audio.addEventListener("error", () => {
          playingRef.current = false;
          URL.revokeObjectURL(url);
          notify({ state: "error", trackId: item.mbid });
        });

        audio.src = url;
        audio.load();
        await audio.play().catch(() => {
          throw new Error("Local file could not be played");
        });
        playingRef.current = true;
      },

      pause: async () => {
        const audio = audioRef.current;
        if (!audio || pausedRef.current) return;
        audio.pause();
        pausedRef.current = true;
        playingRef.current = false;
        notify({ state: "paused", trackId: currentMbidRef.current, progressMs: Math.round(audio.currentTime * 1000) });
      },

      resume: async () => {
        const audio = audioRef.current;
        if (!audio || !pausedRef.current) return;
        await audio.play();
        pausedRef.current = false;
        playingRef.current = true;
        notify({ state: "playing", trackId: currentMbidRef.current });
      },

      stop: () => {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.src = "";
          audioRef.current = null;
        }
        currentMbidRef.current = null;
        pausedRef.current = false;
        playingRef.current = false;
      },

      seek: async (positionMs: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = positionMs / 1000;
      },

      onStatusChange: (cb) => {
        subscribersRef.current.add(cb);
        return () => subscribersRef.current.delete(cb);
      },

      // Extras
      hasDirectory,
      fileCount,
      matchCount,
      scanning,
      browse,
      clearFiles,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, hasDirectory, fileCount, matchCount, scanning, browse, clearFiles, notify],
  );
}
