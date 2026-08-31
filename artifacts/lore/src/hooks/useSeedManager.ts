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
import { useState, useRef, useCallback, useEffect } from "react";
import { useMyTasteSeeds, useSetTasteSeeds } from "../lib/meHooks";
import { MAX_TASTE_SEEDS } from "./useDialData";

export function useSeedManager() {
  const { data: seedArtists = [] } = useMyTasteSeeds();
  const setSeedsMutation = useSetTasteSeeds();
  const seedWriteRef = useRef<Promise<string[]> | null>(null);
  // Keep the cloud responsive while the serialized PUT queue is in flight.
  // The server query remains the source of truth; this optimistic mirror only
  // prevents a fast click from looking unselected until the round trip ends.
  const [optimisticSeeds, setOptimisticSeeds] = useState<string[] | null>(null);
  const visibleSeeds = optimisticSeeds ?? seedArtists;

  const addSeed = useCallback((artist: string) => {
    const trimmed = artist.trim();
    if (!trimmed) return Promise.resolve(visibleSeeds);
    // Serialize rapid picker clicks. Without this, two clicks in the same
    // render both read the old query result and the later PUT can overwrite
    // the first selected artist.
    const pending = seedWriteRef.current;
    const base = pending ? pending.catch(() => seedArtists) : Promise.resolve(visibleSeeds);
    seedWriteRef.current = base.then(async (current) => {
      const lower = trimmed.toLowerCase();
      if (current.some((s) => s.toLowerCase() === lower) || current.length >= MAX_TASTE_SEEDS) return current;
      const next = [...current, trimmed];
      setOptimisticSeeds(next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        setOptimisticSeeds(result.artists);
        return result.artists;
      } catch (error) {
        setOptimisticSeeds(null);
        throw error;
      }
    });
    return seedWriteRef.current;
  }, [seedArtists, setSeedsMutation, visibleSeeds]);

  const removeSeed = useCallback((artist: string) => {
    const pending = seedWriteRef.current;
    const base = pending ? pending.catch(() => seedArtists) : Promise.resolve(visibleSeeds);
    seedWriteRef.current = base.then(async (current) => {
      const lower = artist.toLowerCase();
      const next = current.filter((s) => s.toLowerCase() !== lower);
      if (next.length === current.length) return current;
      setOptimisticSeeds(next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        setOptimisticSeeds(result.artists);
        return result.artists;
      } catch (error) {
        setOptimisticSeeds(null);
        throw error;
      }
    });
    void seedWriteRef.current.catch(() => undefined);
  }, [seedArtists, setSeedsMutation, visibleSeeds]);

  // Bridge: player-ticker artist clicks → addSeed (ticker lives in PlayerBar)
  useEffect(() => {
    const handler = (e: Event) => { void addSeed((e as CustomEvent<string>).detail).catch(() => undefined); };
    window.addEventListener("lore:add-ticker-artist", handler);
    return () => window.removeEventListener("lore:add-ticker-artist", handler);
  }, [addSeed]);

  return { visibleSeeds, addSeed, removeSeed };
}
