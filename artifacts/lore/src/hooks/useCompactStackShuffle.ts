/**
 * useCompactStackShuffle — auto-advancing shuffle cursor for the SplitHome
 * compact Stack band.
 *
 * Mirrors the compact dial scan's scheduleNextHop pattern, but hops between
 * library album groups instead of stations:
 *   - "page" shuffle samples random albums within the visible five-row window;
 *   - "all"  shuffle random-walks the full library, dragging the stack page
 *     window along so the sampled album is always rendered + highlighted.
 *
 * Each hop plays the album preview through the exact same path as a row's
 * play button (useAlbumPlay.launch's body: getRecordingAlbumTracks →
 * ride.startReplay). Albums with no resolved recording are highlight-only —
 * the row lights up for the dwell interval, analogous to an unplayable
 * station during a scan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getRecordingAlbumTracks } from "@workspace/api-client-react";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import type { AlbumGroup } from "../pages/Library";

export type ShuffleMode = "page" | "all" | null;

/** Same dwell as the compact dial scan (SplitHome's SCAN_DWELL_MS). */
export const SHUFFLE_DWELL_MS = 7000;

/** Newest resolved recording MBID in a group — mirrors CompactStack's primaryMbid. */
function firstMbid(group: AlbumGroup): string | null {
  return group.items.find((i) => i.mbid !== null)?.mbid ?? null;
}

export function useCompactStackShuffle({
  groups,
  stackOffset,
  pageSize = 5,
  onSetStackOffset,
}: {
  /** All library album groups (unwindowed). */
  groups: AlbumGroup[];
  /** Current stack page offset (multiple of the page size). */
  stackOffset: number;
  /**
   * Albums per page at the current stack density (5 normal, 10 compact,
   * 15 micro). The "page" shuffle scope and the shuffle-all window snap
   * both follow it.
   */
  pageSize?: number;
  /** Moves the stack page window (used by shuffle-all so the hop stays visible). */
  onSetStackOffset: (offset: number) => void;
}) {
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>(null);
  const [shuffleGroupKey, setShuffleGroupKey] = useState<string | null>(null);

  const rt = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    active: boolean;
    mode: "page" | "all" | null;
    /** Key of the group the current hop landed on (dedupes consecutive hops). */
    key: string | null;
  }>({ timer: null, active: false, mode: null, key: null });

  // Refs so timer callbacks always see the latest values (same pattern as
  // SplitHome's filteredRowsRef / scanOffsetRef).
  const groupsRef = useRef(groups);
  const offsetRef = useRef(stackOffset);
  const pageSizeRef = useRef(pageSize);
  const offsetSetterRef = useRef(onSetStackOffset);
  useEffect(() => {
    groupsRef.current = groups;
    offsetRef.current = stackOffset;
    pageSizeRef.current = pageSize;
    offsetSetterRef.current = onSetStackOffset;
  });

  const { ride } = usePlayer();
  const rideRef = useRef(ride);
  // eslint-disable-next-line react-hooks/refs
  rideRef.current = ride;

  const stopShuffle = useCallback(() => {
    rt.current.active = false;
    rt.current.mode = null;
    rt.current.key = null;
    if (rt.current.timer != null) {
      clearTimeout(rt.current.timer);
      rt.current.timer = null;
    }
    setShuffleMode(null);
    setShuffleGroupKey(null);
  }, []);

  // Play one group's album preview — the same fetch + startReplay body as
  // useAlbumPlay.launch. Unresolved/failed albums degrade to highlight-only.
  const previewGroup = useCallback((group: AlbumGroup) => {
    const mbid = firstMbid(group);
    if (!mbid) return;
    void (async () => {
      try {
        const data = await getRecordingAlbumTracks(mbid);
        const seeds: RideSeed[] = data.tracks.map((track) => ({
          mbid: track.mbid,
          title: track.title,
          artist: track.artist,
          artworkUrl: null,
          links: [],
        }));
        if (seeds.length === 0) return;
        // The shuffle may have hopped on (or stopped) while the album-tracks
        // request was in flight — only start playback for the current hop.
        if (!rt.current.active || rt.current.key !== group.key) return;
        rideRef.current.startReplay(seeds, data.rgTitle ?? group.albumTitle, {
          timeOrientation: "curated",
          context: "library",
        });
      } catch {
        // Unresolvable album: the row highlight is the whole preview.
      }
    })();
  }, []);

  // Land on a random group from the shuffle's scope. Returns false when the
  // scope is empty (caller stops the shuffle).
  const hopToRandom = useCallback((mode: "page" | "all"): boolean => {
    const allGroups = groupsRef.current;
    const size = pageSizeRef.current;
    const list =
      mode === "page"
        ? allGroups.slice(offsetRef.current, offsetRef.current + size)
        : allGroups;
    if (list.length === 0) return false;
    let idx = Math.floor(Math.random() * list.length);
    // Never dwell twice in a row on the same album when there's a choice.
    if (list.length > 1 && list[idx].key === rt.current.key) {
      idx = (idx + 1) % list.length;
    }
    const group = list[idx];
    rt.current.key = group.key;
    // A library-wide shuffle drives the visible window along with it, so the
    // sampled album is always rendered and highlighted (CompactStack only
    // shows the current page — 5 rows in normal, 10 in compact, 15 in micro).
    if (mode === "all") {
      const globalIdx = allGroups.indexOf(group);
      offsetSetterRef.current(Math.floor(globalIdx / size) * size);
    }
    setShuffleGroupKey(group.key);
    previewGroup(group);
    return true;
  }, [previewGroup]);

  // Self-referential reschedule via an inner named function (the useCallback
  // const can't reference itself under the compiler rules) — same shape as
  // SplitHome's scheduleNextHop.
  const scheduleNextHop = useCallback((mode: "page" | "all") => {
    function hop() {
      rt.current.timer = setTimeout(() => {
        if (!rt.current.active) return;
        if (!hopToRandom(mode)) {
          stopShuffle();
          return;
        }
        hop();
      }, SHUFFLE_DWELL_MS);
    }
    hop();
  }, [hopToRandom, stopShuffle]);

  const startShuffle = useCallback((mode: "page" | "all") => {
    const allGroups = groupsRef.current;
    const list =
      mode === "page"
        ? allGroups.slice(offsetRef.current, offsetRef.current + pageSizeRef.current)
        : allGroups;
    if (list.length === 0) return;
    rt.current.active = true;
    rt.current.mode = mode;
    rt.current.key = null;
    setShuffleMode(mode);
    hopToRandom(mode);
    scheduleNextHop(mode);
  }, [hopToRandom, scheduleNextHop]);

  // Toggle semantics match the scan remote: clicking the active mode's
  // button stops; clicking the other mode's button switches (stop + start).
  const onShufflePage = useCallback(() => {
    const wasMode = rt.current.mode;
    if (rt.current.active) stopShuffle();
    if (wasMode === "page") return;
    startShuffle("page");
  }, [stopShuffle, startShuffle]);

  const onShuffleAll = useCallback(() => {
    const wasMode = rt.current.mode;
    if (rt.current.active) stopShuffle();
    if (wasMode === "all") return;
    startShuffle("all");
  }, [stopShuffle, startShuffle]);

  // Clean up timers on unmount.
  useEffect(() => () => {
    if (rt.current.timer != null) clearTimeout(rt.current.timer);
  }, []);

  return { shuffleMode, shuffleGroupKey, onShufflePage, onShuffleAll, stopShuffle };
}
