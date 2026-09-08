/**
 * Batched "what played around it" context for Library crate rows.
 *
 * Kept tracks anchor on the exact broadcast the keep came from (retained
 * spin); artist-file saves and spinless keeps anchor on the most recent
 * resolved spin of that artist across visible stations. The server returns
 * the anchor spin plus its immediate before/after neighbors and the
 * station's homepage URL.
 *
 * Anchors are POSTed in chunks so a large crate costs a handful of requests
 * rather than one per row. Results are plain JSON (non-orval fast lane).
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

export interface SetContextTrack {
  spinId: number;
  mbid: string | null;
  title: string | null;
  artist: string | null;
  albumTitle: string | null;
  artworkUrl: string | null;
  releaseGroupMbid: string | null;
  playedAt: string;
}

export interface SetContextStation {
  slug: string;
  name: string;
  homepageUrl: string | null;
}

export interface SetContext {
  station: SetContextStation;
  /**
   * "kept-spin": the anchor is the exact broadcast the keep came from.
   * "artist-fallback": the anchor is the artist's most recent resolved spin —
   * a different song than any kept track; label it honestly ("latest set").
   */
  anchorKind: "kept-spin" | "artist-fallback";
  anchor: SetContextTrack;
  before: SetContextTrack | null;
  after: SetContextTrack | null;
}

export type SetContextAnchor =
  | { kind: "mbid"; mbid: string }
  | { kind: "artist"; artist: string };

export function anchorKey(anchor: SetContextAnchor): string {
  return anchor.kind === "mbid"
    ? `mbid:${anchor.mbid}`
    : `artist:${anchor.artist.trim().toLowerCase()}`;
}

const CHUNK_SIZE = 60;
const STALE_MS = 10 * 60 * 1000;

async function postSetContexts(
  anchors: SetContextAnchor[],
): Promise<Record<string, SetContext | null>> {
  const res = await fetch("/api/me/library/set-contexts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      anchors: anchors.map((a) =>
        a.kind === "mbid" ? { mbid: a.mbid } : { artist: a.artist }
      ),
    }),
  });
  if (!res.ok) throw new Error(`set-contexts failed: ${res.status}`);
  const data = (await res.json()) as { contexts: Record<string, SetContext | null> };
  return data.contexts;
}

/**
 * Resolve set contexts for the given anchors. Returns a Map keyed by
 * anchorKey(); missing keys are still loading, explicit nulls mean "no set
 * found". The anchor list is compared by its joined key so callers can pass
 * a freshly built array every render without retriggering fetches.
 */
export function useSetContexts(
  anchors: SetContextAnchor[],
): Map<string, SetContext | null> {
  const joined = anchors.map(anchorKey).join("");

  const chunks = useMemo(() => {
    void joined;
    const deduped = [...new Map(anchors.map((a) => [anchorKey(a), a])).values()];
    const out: SetContextAnchor[][] = [];
    for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
      out.push(deduped.slice(i, i + CHUNK_SIZE));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ["set-contexts", chunk.map(anchorKey)],
      queryFn: () => postSetContexts(chunk),
      staleTime: STALE_MS,
      enabled: chunk.length > 0,
    })),
  });

  // Merging a few bounded chunks per render is cheap; skip memoization so the
  // dependency list stays simple and honest.
  const map = new Map<string, SetContext | null>();
  for (const q of queries) {
    if (!q.data) continue;
    for (const [key, value] of Object.entries(q.data)) map.set(key, value);
  }
  return map;
}
