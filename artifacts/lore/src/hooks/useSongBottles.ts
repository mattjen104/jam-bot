import { useState, useEffect, useRef, useCallback } from "react";
import { getStoredAvatar } from "../lib/social";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SongBottle {
  id: number;
  mbid: string;
  handle: string;
  avatar: string;
  body: string | null;
  progressMs: number | null;
  playsRemaining: number;
  createdAt: string;
  stationId: number;
}

interface BottlesResponse {
  bottles: SongBottle[];
  archivedCount: number;
}

interface UseSongBottlesResult {
  bottles: SongBottle[];
  archivedCount: number;
  hasUnread: boolean;
  markRead: () => void;
  send: (args: {
    body: string;
    avatar: string;
    stationId: number;
    progressMs?: number;
  }) => Promise<SongBottle>;
  loading: boolean;
  error: string | null;
}

const API = "/api";

function apiUrl(path: string): string {
  return `${API}${path}`;
}

/**
 * Fetches and subscribes to song bottles for a given MBID.
 *
 * - Loads initial bottles from GET /api/songs/:mbid/bottles
 * - Subscribes to SSE on GET /api/stations/:id/bottles/stream for live pushes
 * - Exposes send() to POST a new bottle
 * - Tracks unread state (any bottle arriving via SSE since panel was last opened)
 */
export function useSongBottles(
  mbid: string | null,
  stationId: number | null,
): UseSongBottlesResult {
  const [bottles, setBottles] = useState<SongBottle[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [hasUnread, setHasUnread] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  // Fetch initial bottles
  useEffect(() => {
    if (!mbid) {
      setBottles([]);
      setArchivedCount(0);
      setHasUnread(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(apiUrl(`/songs/${encodeURIComponent(mbid)}/bottles`), {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BottlesResponse>;
      })
      .then(({ bottles: b, archivedCount: ac }) => {
        setBottles(b);
        setArchivedCount(ac);
        setHasUnread(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load bottles");
      })
      .finally(() => setLoading(false));
  }, [mbid]);

  // SSE subscription for live bottle arrivals
  useEffect(() => {
    if (!stationId) return;

    const es = new EventSource(apiUrl(`/stations/${stationId}/bottles/stream`), {
      withCredentials: true,
    });
    esRef.current = es;

    es.addEventListener("bottles", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as {
          bottles: SongBottle[];
        };
        const incoming = data.bottles.filter(
          (b) => b.mbid === mbid && b.body != null,
        );
        if (incoming.length > 0) {
          setBottles((prev) => {
            // Merge: avoid duplicates by id, keep up to 3 most recent
            const merged = [
              ...incoming,
              ...prev.filter((p) => !incoming.some((i) => i.id === p.id)),
            ]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              )
              .slice(0, 3);
            return merged;
          });
          setHasUnread(true);
        }
      } catch {
        // Malformed SSE — ignore
      }
    });

    es.onerror = () => {
      // SSE errors are non-fatal — the keepalive will reconnect automatically
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [stationId, mbid]);

  const markRead = useCallback(() => setHasUnread(false), []);

  const send = useCallback(
    async (args: {
      body: string;
      avatar: string;
      stationId: number;
      progressMs?: number;
    }): Promise<SongBottle> => {
      if (!mbid) throw new Error("no track resolved");
      const r = await fetch(apiUrl(`/songs/${encodeURIComponent(mbid)}/bottles`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: args.body,
          avatar: args.avatar,
          stationId: args.stationId,
          progress_ms: args.progressMs ?? null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const bottle = (await r.json()) as SongBottle;
      // Optimistically prepend to local list
      setBottles((prev) => [bottle, ...prev].slice(0, 3));
      return bottle;
    },
    [mbid],
  );

  return { bottles, archivedCount, hasUnread, markRead, send, loading, error };
}
