/**
 * useSeedManager — optimistic taste-seed add/remove with serialized writes.
 *
 * Extracted from DialView.tsx. Also wires the custom event bridge so the
 * PlayerBar ticker can add an artist without sharing component state.
 *
 * Returns:
 *   visibleSeeds — optimistic mirror of the server list (fast UI response)
 *   addSeed      — append an artist (serialized, case-insensitive dedup)
 *   removeSeed   — remove an artist (serialized, case-insensitive match)
 */
import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ME_TASTE_SEEDS_KEY, useMyTasteSeeds, useSetTasteSeeds } from "../lib/meHooks";
import { MAX_TASTE_SEEDS } from "./useDialData";

let seedWriteQueue: Promise<string[]> = Promise.resolve([]);

function normalizeSeeds(artists: string[]): string[] {
  const seen = new Set<string>();
  return artists
    .map((artist) => artist.trim())
    .filter((artist) => {
      const key = artist.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export class TasteSeedLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TasteSeedLimitError";
  }
}

export function useSeedManager() {
  const queryClient = useQueryClient();
  const { data: seedArtists = [] } = useMyTasteSeeds();
  const setSeedsMutation = useSetTasteSeeds();

  const enqueue = useCallback((change: (current: string[]) => string[]) => {
    const operation = seedWriteQueue.catch(() => []).then(async () => {
      const current = queryClient.getQueryData<string[]>(ME_TASTE_SEEDS_KEY) ?? seedArtists;
      const next = normalizeSeeds(change(current));
      if (next.length > MAX_TASTE_SEEDS) {
        throw new TasteSeedLimitError(`You can keep up to ${MAX_TASTE_SEEDS} artists.`);
      }
      if (next.length === current.length && next.every((artist, index) => artist === current[index])) {
        return current;
      }
      // Put the optimistic list in the shared query cache so an open document,
      // Radio crossings, and Library placeholders all update together.
      queryClient.setQueryData(ME_TASTE_SEEDS_KEY, next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        queryClient.setQueryData(ME_TASTE_SEEDS_KEY, result.artists);
        return result.artists;
      } catch (cause) {
        // Restore the last confirmed list; never replace a failed write with
        // an empty or partially-normalised fallback.
        queryClient.setQueryData(ME_TASTE_SEEDS_KEY, current);
        throw cause;
      }
    });
    seedWriteQueue = operation.catch(() => queryClient.getQueryData<string[]>(ME_TASTE_SEEDS_KEY) ?? seedArtists);
    return operation;
  }, [queryClient, seedArtists, setSeedsMutation]);

  const addSeed = useCallback(
    (artist: string) => enqueue((current) => [...current, artist]),
    [enqueue],
  );

  const removeSeed = useCallback(
    (artist: string) => enqueue((current) => current.filter((seed) => seed.toLocaleLowerCase() !== artist.trim().toLocaleLowerCase())),
    [enqueue],
  );

  const replaceSeeds = useCallback(
    (artists: string[]) => enqueue(() => artists),
    [enqueue],
  );

  // Bridge: player-ticker artist clicks → addSeed (ticker lives in PlayerBar)
  useEffect(() => {
    const handler = (e: Event) => { void addSeed((e as CustomEvent<string>).detail).catch(() => undefined); };
    window.addEventListener("lore:add-ticker-artist", handler);
    return () => window.removeEventListener("lore:add-ticker-artist", handler);
  }, [addSeed]);

  return { visibleSeeds: seedArtists, addSeed, removeSeed, replaceSeeds };
}
