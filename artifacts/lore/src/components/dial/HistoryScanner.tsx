/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { usePlayer } from "../../player/PlayerProvider";
import { getPreviewCached } from "../../player/previewCache";
import { KeepButton } from "../KeepButton";
import type { CrossingScope } from "../../lib/crossingScope";
import type { StationCategory } from "../../lib/dialCategories";

export type HistoryFilter = "all" | "crossings" | "firstPlays";
export interface HistoryItem {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playedAt: string;
  station: { slug: string; name: string };
  show: { name: string; djName: string | null } | null;
  isCrossing: boolean;
  isFirstPlay: boolean;
}

const PAGE_SIZE = 40;
const DWELLS = [3000, 7000, 15000] as const;
const STORE_KEY = "lore:historyScan:v1";
const STORE_CAP = 24;
type Progress = Record<string, { snapshot: string; furthest: number; seen: number[]; at: number }>;

function readProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) as Progress : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function saveProgress(key: string, value: Progress[ string ]): void {
  try {
    const next = readProgress();
    next[key] = value;
    const keys = Object.keys(next).sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0));
    for (const old of keys.slice(0, Math.max(0, keys.length - STORE_CAP))) delete next[old];
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch { /* private mode or quota: playback still works */ }
}

function scopeLabel(scope: CrossingScope): string {
  return scope === "set" ? "this set" : scope === "lifetime" ? "all time" : scope;
}

export function HistoryScanner({
  scope,
  categories,
  stationSlug = null,
}: {
  scope: CrossingScope;
  categories: readonly StationCategory[];
  stationSlug?: string | null;
}) {
  const { radio } = usePlayer();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [dwellMs, setDwellMs] = useState<number>(7000);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [noPreview, setNoPreview] = useState(false);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decks = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const deckIndex = useRef(0);
  const selectionKey = useMemo(
    () => `${scope}|${[...categories].sort().join(",")}|${stationSlug ?? "*"}|${filter}`,
    [scope, categories, stationSlug, filter],
  );

  const silenceDecks = useCallback(() => {
    token.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (const deck of decks.current) {
      deck?.pause();
      if (deck) { deck.removeAttribute("src"); deck.load(); }
    }
    setPlaying(false);
    setPaused(false);
  }, []);
  const stop = useCallback(() => {
    silenceDecks();
    // Older provider test doubles omit the optional scan duck methods.
    radio.restoreDuck?.();
  }, [radio, silenceDecks]);

  const togglePause = useCallback(() => {
    const deck = decks.current[deckIndex.current];
    if (!deck || !playing) return;
    if (paused) {
      void deck.play().then(() => setPaused(false)).catch(() => undefined);
    } else {
      deck.pause();
      setPaused(true);
    }
  }, [paused, playing]);

  const loadPage = useCallback(async (reset = false) => {
    if (loading) return;
    setLoading(true); setError(null);
    const params = new URLSearchParams({
      scope,
      filter,
      limit: String(PAGE_SIZE),
    });
    if (snapshot && !reset) params.set("snapshot", snapshot);
    if (categories.length) params.set("categories", categories.join(","));
    if (stationSlug) params.set("station", stationSlug);
    if (!reset && cursor) {
      const [before, beforeId] = cursor.split("|");
      params.set("before", before ?? cursor);
      if (beforeId) params.set("beforeId", beforeId);
    }
    try {
      const response = await fetch(`/api/player/history?${params}`);
      if (!response.ok) throw new Error("History unavailable");
      const page = await response.json() as {
        snapshot: string; items: HistoryItem[]; nextBefore: string | null; nextBeforeId: number | null;
      };
      setSnapshot((prev) => reset || !prev ? page.snapshot : prev);
      setItems((prev) => reset ? page.items : [...prev, ...page.items]);
      setCursor(page.nextBefore && page.nextBeforeId != null ? `${page.nextBefore}|${page.nextBeforeId}` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "History unavailable");
    } finally { setLoading(false); }
  }, [categories, cursor, filter, loading, scope, snapshot, stationSlug]);

  // A selection change is a cancellation boundary and cannot borrow old pages.
  // This effect resets external playback and the selection-owned page state.
  useEffect(() => {
    stop();
    setItems([]); setCursor(null); setSnapshot(null); setIndex(0);
    if (open) void loadPage(true);
  // loadPage is intentionally not a dependency: its cursor belongs to the old selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, open]);

  const markSeen = useCallback((at: number) => {
    const progress = readProgress()[selectionKey];
    const seen = [...new Set([...(progress?.seen ?? []), at])].slice(-500);
    saveProgress(selectionKey, {
      snapshot: snapshot ?? "", furthest: Math.max(progress?.furthest ?? -1, at), seen, at: Date.now(),
    });
  }, [selectionKey, snapshot]);

  // Recursive advancement is deliberate: unavailable previews are skipped
  // without making the listener press Next repeatedly.
  const playAt = useCallback(async (at: number) => {
    const item = items[at];
    if (!item) return;
    silenceDecks();
    token.current += 1;
    markSeen(at);
    radio.duck?.();
    const myToken = token.current;
    const deck = decks.current[deckIndex.current] ?? (typeof Audio === "undefined" ? null : new Audio());
    if (!deck) return;
    decks.current[deckIndex.current] = deck;
    try {
      const preview = await getPreviewCached(item.mbid);
      if (myToken !== token.current) return;
      if (!preview.previewUrl) {
        setNoPreview(true);
        if (at + 1 < items.length) void playAt(at + 1);
        else if (cursor) void loadPage();
        return;
      }
      setNoPreview(false);
      // Audio elements are intentionally owned by this scanner's stable ref.
      deck.src = preview.previewUrl; deck.volume = 1; deck.preload = "auto";
      await deck.play();
      if (myToken !== token.current) return;
      setIndex(at); setPlaying(true);
      timer.current = setTimeout(() => {
        deck.pause();
        if (at + 1 < items.length) void playAt(at + 1);
        else if (cursor) void loadPage();
        else { setPlaying(false); radio.restoreDuck?.(); }
      }, dwellMs);
    } catch {
      if (myToken === token.current) setNoPreview(true);
      if (at + 1 < items.length) void playAt(at + 1);
    }
  }, [cursor, dwellMs, items, loadPage, markSeen, radio, silenceDecks]);

  useEffect(() => () => stop(), [stop]);

  const start = () => {
    const saved = readProgress()[selectionKey];
    const resume = saved?.snapshot === snapshot ? Math.min(saved.furthest + 1, items.length - 1) : 0;
    void playAt(Math.max(0, resume));
  };
  const current = items[index] ?? null;

  return (
    <section className="dial-history" data-testid="dial-history-scanner">
      <div className="dial-history__header">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          History scan · {scopeLabel(scope)}
        </button>
        {open && <span>{items.length}{cursor ? "+" : ""} tracks</span>}
      </div>
      {open && (
        <>
          <div className="dial-history__filters" role="group" aria-label="History track set">
            {(["all", "crossings", "firstPlays"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value}
                onClick={() => { if (playing) stop(); setFilter(value); }}>
                {value === "firstPlays" ? "first plays" : value}
              </button>
            ))}
          </div>
          {loading && <p>Loading archived spins…</p>}
          {error && <p role="status">{error}</p>}
          {current && (
            <article className="dial-history__current">
              {current.artworkUrl && <img src={current.artworkUrl} alt="" width={48} height={48} />}
              <div><b>{current.title}</b> · {current.artist}
                <small>{current.station.name} · {new Date(current.playedAt).toLocaleString()}</small>
              </div>
              <KeepButton mbid={current.mbid} spinId={current.id} provenance={{ stationSlug: current.station.slug }} compact />
            </article>
          )}
          <div className="dial-history__controls">
            <button type="button" onClick={() => void playAt(Math.max(0, index - 1))} aria-label="Previous scan track"><SkipBack size={14} /></button>
            <button type="button" onClick={() => playing ? togglePause() : start()} aria-label={playing ? (paused ? "Resume scan" : "Pause scan") : "Start history scan"}>
              {playing && !paused ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button type="button" onClick={() => void playAt(index + 1)} aria-label="Next scan track"><SkipForward size={14} /></button>
            <button type="button" onClick={stop} aria-label="Stop history scan"><Square size={14} /></button>
            {DWELLS.map((d) => <button key={d} type="button" aria-pressed={dwellMs === d} onClick={() => setDwellMs(d)}>{d / 1000}s</button>)}
          </div>
          {noPreview && <p role="status">No sample for that track — continuing…</p>}
          {cursor && <button type="button" onClick={() => void loadPage()} disabled={loading}>Load more history</button>}
        </>
      )}
    </section>
  );
}