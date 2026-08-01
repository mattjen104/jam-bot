/**
 * useFrontDoorScan — auto-advancing scan cursor for the dial front door.
 *
 * Extracted to its own module so tests can vi.mock it without mocking the
 * entire DialView file.
 */
import { useState, useEffect, useRef, useCallback } from "react";

const DWELL_PRESETS = [3000, 5000, 7000, 12000, 20000] as const;

export function useFrontDoorScan(count: number) {
  const [scanning, setScanning] = useState(false);
  const [samplingIdx, setSamplingIdx] = useState<number | null>(null);
  const [dwellMs, setDwellMs] = useState(7000);
  const [progress, setProgress] = useState(0);

  // All mutable timer state in a single ref — avoids stale closures
  const rt = useRef({ timer: null as ReturnType<typeof setTimeout> | null, raf: null as number | null, t0: 0, idx: 0, active: false });
  const countRef = useRef(count);
  const dwellRef = useRef(7000);
  useEffect(() => { countRef.current = count; }, [count]);
  useEffect(() => { dwellRef.current = dwellMs; }, [dwellMs]);

  const cancelTimers = useCallback(() => {
    if (rt.current.timer != null) { clearTimeout(rt.current.timer); rt.current.timer = null; }
    if (rt.current.raf != null) { cancelAnimationFrame(rt.current.raf); rt.current.raf = null; }
  }, []);

  const tick = useCallback(() => {
    if (!rt.current.active) return;
    const p = Math.min(1, (Date.now() - rt.current.t0) / dwellRef.current);
    setProgress(p);
    if (p < 1) rt.current.raf = requestAnimationFrame(tick);
  }, []);

  const hop = useCallback((idx: number) => {
    const n = countRef.current;
    if (!n) return;
    const i = ((idx % n) + n) % n;
    rt.current.idx = i;
    rt.current.t0 = Date.now();
    cancelTimers();
    setSamplingIdx(i);
    setProgress(0);
    rt.current.raf = requestAnimationFrame(tick);
    rt.current.timer = setTimeout(() => hop(i + 1), dwellRef.current);
  }, [cancelTimers, tick]);

  const stop = useCallback(() => {
    rt.current.active = false;
    cancelTimers();
    setScanning(false);
    setSamplingIdx(null);
    setProgress(0);
  }, [cancelTimers]);

  const start = useCallback(() => {
    if (!countRef.current) return;
    rt.current.active = true;
    setScanning(true);
    hop(0);
  }, [hop]);

  const toggle = useCallback(() => { if (rt.current.active) stop(); else start(); }, [stop, start]);

  /** Back-one: go to previous sample, restart dwell from that position */
  const back = useCallback(() => { if (rt.current.active) hop(rt.current.idx - 1); }, [hop]);
  const next = useCallback(() => { if (rt.current.active) hop(rt.current.idx + 1); }, [hop]);

  /** Land: commit current sample — stop auto-advance, keep highlight */
  const land = useCallback(() => {
    rt.current.active = false;
    cancelTimers();
    setScanning(false);
    setProgress(0);
    // samplingIdx intentionally kept so caller can read which row was landed on
  }, [cancelTimers]);

  const adjustDwell = useCallback((dir: 1 | -1) => {
    setDwellMs(prev => {
      const idx = DWELL_PRESETS.indexOf(prev as (typeof DWELL_PRESETS)[number]);
      const ni = Math.max(0, Math.min(DWELL_PRESETS.length - 1, (idx < 0 ? 2 : idx) + dir));
      return DWELL_PRESETS[ni];
    });
    if (rt.current.active) setTimeout(() => hop(rt.current.idx), 0);
  }, [hop]);

  useEffect(() => () => cancelTimers(), [cancelTimers]);

  return { scanning, samplingIdx, dwellMs, progress, toggle, back, next, land, adjustDwell, stop };
}
