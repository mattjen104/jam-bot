import { useEffect, useState, useRef, useMemo } from "react";
import type { Station, StationNowPlaying } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { usePlayer } from "../player/PlayerProvider";
import { useDialData } from "../hooks/useDialData";
import { KeepButton } from "./KeepButton";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import { SetContextSheet } from "./SetContextSheet";
import { ChevronDown, Pause, Play, Loader2, MoreHorizontal, SkipForward } from "lucide-react";
import { anchorKey, useSetContexts, type SetContextTrack } from "../lib/setContexts";
import { clockTime } from "../lib/format";
import { Link, useLocation, useSearch } from "wouter";
import { useAppConfig } from "../lib/meHooks";
import { buildLibraryEntityUrl } from "../lib/libraryFocusedNavigation";

interface DemoPlayerSheetProps {
  station: Station;
  nowPlayingData: StationNowPlaying | undefined;
  status: PlayerStatus;
  onToggle: (station: Station) => void;
  onCollapse: () => void;
  djName?: string | null;
}

export function DemoPlayerSheet({
  station,
  nowPlayingData,
  status,
  onToggle,
  onCollapse,
  djName
}: DemoPlayerSheetProps) {
  const { radio } = usePlayer();
  const [location] = useLocation();
  const search = useSearch();
  const { data: appConfig } = useAppConfig();
  const demoSurface = appConfig?.demoSurface === true;
  const returnContext = `${location.split("?")[0]}${search ? `?${search.replace(/^\?/, "")}` : ""}`;
  const { stations } = useDialData("personal");
  const [historyState, setHistoryState] = useState<{ stationSlug: string; items: SetContextTrack[] }>({
    stationSlug: station.slug,
    items: [],
  });
  const history = historyState.stationSlug === station.slug ? historyState.items : [];
  const prevLiveRef = useRef<SetContextTrack | null>(null);
  
  useEffect(() => {
    const controller = new AbortController();
    if (!station.slug) return;

    prevLiveRef.current = null;

    void fetch(`/api/stations/${encodeURIComponent(station.slug)}/recent-spins`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404) return { items: [] };
        if (!res.ok) throw new Error(`recent-spins failed: ${res.status}`);
        return res.json();
      })
      .then((data: { items?: Array<{ spins?: Array<Partial<SetContextTrack> & { spinId: number; playedAt: string }> }> }) => {
        const spins = data.items?.[0]?.spins ?? [];
        setHistoryState({ stationSlug: station.slug, items: spins.slice(0, 3).map((spin) => ({
          spinId: spin.spinId,
          mbid: spin.mbid ?? null,
          title: spin.title ?? null,
          artist: spin.artist ?? null,
          artistMbid: spin.artistMbid ?? null,
          albumTitle: spin.albumTitle ?? null,
          artworkUrl: spin.artworkUrl ?? null,
          releaseGroupMbid: spin.releaseGroupMbid ?? null,
          playedAt: spin.playedAt,
          previewUrl: spin.previewUrl ?? null,
          isKept: spin.isKept ?? false,
          show: spin.show ?? null,
        })) });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setHistoryState({ stationSlug: station.slug, items: [] });
        }
      });

    return () => controller.abort();
  }, [station.slug]);
  
  useEffect(() => {
    const np = nowPlayingData?.nowPlaying;
    if (np) {
      const track: SetContextTrack = {
        spinId: np.spinId ?? 0,
        mbid: np.recording?.mbid ?? null,
        title: np.recording?.title ?? np.rawTitle ?? null,
        artist: np.recording?.artist ?? np.rawArtist ?? null,
        artistMbid: np.recording?.artistMbid ?? null,
        albumTitle: null,
        artworkUrl: np.recording?.artworkUrl ?? null,
        releaseGroupMbid: null,
        playedAt: np.playedAt ?? new Date().toISOString(),
        previewUrl: null,
        isKept: false,
        show: np.show ? { name: np.show.name ?? "", djName: np.show.djName ?? null } : null
      };
      
      if (prevLiveRef.current && prevLiveRef.current.spinId !== track.spinId && prevLiveRef.current.spinId !== 0) {
        setHistoryState((previous) => {
          const previousItems = previous.stationSlug === station.slug ? previous.items : [];
          const updated = [prevLiveRef.current!, ...previousItems].filter((v, i, a) => a.findIndex(t => t.spinId === v.spinId) === i);
          return { stationSlug: station.slug, items: updated.slice(0, 3) };
        });
      }
      prevLiveRef.current = track;
    }
  }, [nowPlayingData?.nowPlaying, station.slug]);

  const liveSpinId = nowPlayingData?.nowPlaying?.spinId;
  const justPlayed = history.filter(h => h.spinId !== liveSpinId).slice(0, 2);

  const [sheetAnchorId, setSheetAnchorId] = useState<number | null>(null);

  const sheetAnchors = useMemo(
    () => sheetAnchorId == null ? [] : [{ kind: "spin" as const, spinId: sheetAnchorId }],
    [sheetAnchorId],
  );
  const sheetContexts = useSetContexts(sheetAnchors);
  const sheetContext = sheetAnchorId == null
    ? null
    : sheetContexts.get(anchorKey({ kind: "spin", spinId: sheetAnchorId }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sheetAnchorId == null) onCollapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCollapse, sheetAnchorId]);

  const isPlaying = status === "playing";
  const isLoading = status === "loading" || status === "reconnecting";

  const onNextStation = () => {
    const currentIndex = stations.findIndex(s => s.station.slug === station.slug);
    if (currentIndex !== -1 && stations.length > 0) {
      const nextStation = stations[(currentIndex + 1) % stations.length];
      if (nextStation) radio.toggle(nextStation.station);
    }
  };

  const np = nowPlayingData?.nowPlaying;
  const title = np?.recording?.title ?? np?.rawTitle ?? "—";
  const artist = np?.recording?.artist ?? np?.rawArtist ?? "—";
  const showName = np?.show?.name;
  const startedAt = np?.playedAt ? clockTime(np.playedAt) : "";
  const claimText = np?.show?.djName ? `Selected by ${np.show.djName}` : (djName ? `Selected by ${djName}` : `Played on ${station.name}`);

  return (
    <>
      <div
        className="player-sheet"
        role="dialog"
        aria-label={`Now playing — ${station.name}`}
        data-testid="player-sheet"
        style={{ padding: '16px 20px 20px', height: '100dvh', overflowY: 'auto' }}
      >
        <div className="np-top flex items-center justify-between mb-4 text-[12px] text-muted-foreground">
          <button onClick={onCollapse} className="p-1 -ml-1"><ChevronDown className="w-5 h-5" /></button>
          <div className="st flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#9da38d]" /> {station.name} · live</div>
          <Link href={`/archive/stations/${station.slug}`} className="p-1 -mr-1"><MoreHorizontal className="w-5 h-5" /></Link>
        </div>

        <div className="np-cov w-full aspect-square rounded-lg bg-muted mb-4 overflow-hidden">
          {np?.recording?.artworkUrl && (
            <img src={proxyArtUrl(np.recording.artworkUrl)!} onError={onArtError} className="w-full h-full object-cover" alt="" />
          )}
        </div>
        
        <div className="t text-[20px] font-medium leading-snug">
          {np?.recording?.mbid ? (
            <Link href={buildLibraryEntityUrl(`/song/${encodeURIComponent(np.recording.mbid)}`, returnContext, { demoSurface })}>
              {title}
            </Link>
          ) : title}
        </div>
        <div className="a text-[15px] text-muted-foreground mt-0.5">
          {np?.recording?.artistMbid ? (
            <Link href={buildLibraryEntityUrl(`/artist/${encodeURIComponent(np.recording.artistMbid)}`, returnContext, { demoSurface })}>
              {artist}
            </Link>
          ) : artist}
        </div>
        <div className="claim text-[14px] font-serif mt-2">{claimText}</div>
        {(showName || startedAt) && <div className="cite font-mono text-[11px] text-muted-foreground mt-0.5 block">{[showName, startedAt ? `started ${startedAt}` : null].filter(Boolean).join(' · ')}</div>}

        <div className="ctl flex items-center gap-3 my-[18px]">
          <KeepButton 
            mbid={np?.recording?.mbid} 
            spinId={np?.spinId} 
            provenance={{ kind: "keep", stationSlug: station.slug, stationName: station.name, surface: "expanded_player" }}
            className="flex-1 h-11 rounded-lg border border-border bg-foreground text-background flex items-center justify-center gap-1.5 text-[15px] transition-opacity hover:opacity-90 aria-pressed:bg-muted aria-pressed:text-foreground"
          />
          <button 
            className="w-11 h-11 rounded-full border border-border bg-transparent flex items-center justify-center text-foreground shrink-0" 
            aria-label={isPlaying ? "Pause" : "Play"} 
            onClick={() => onToggle(station)}
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>
          <button 
            className="w-11 h-11 rounded-full border border-border bg-transparent flex items-center justify-center text-foreground shrink-0" 
            aria-label="Next station" 
            onClick={onNextStation}
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
        </div>

        {justPlayed.length > 0 && <div className="just text-[11px] text-muted-foreground tracking-widest uppercase mt-[22px] mb-[6px]">Just played</div>}
        
        {justPlayed.map(jp => (
          <div 
            key={jp.spinId} 
            className="row flex items-center gap-3 py-2.5 border-t border-border cursor-pointer hover:bg-muted/50 -mx-5 px-5 transition-colors"
            role="button"
            tabIndex={0}
            aria-label={`Open set for ${jp.title ?? "this track"}`}
            onClick={() => setSheetAnchorId(jp.spinId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSheetAnchorId(jp.spinId);
              }
            }}
          >
            <div className="cov w-11 h-11 rounded bg-muted shrink-0 overflow-hidden">
              {jp.artworkUrl && <img src={proxyArtUrl(jp.artworkUrl)!} onError={onArtError} className="w-full h-full object-cover" alt="" />}
            </div>
            <div className="body flex-1 min-w-0">
              <div className="ttl text-[14px] font-medium truncate">{jp.title ?? "Unknown"}</div>
              <div className="art text-[12px] text-muted-foreground truncate">{jp.artist ?? "Unknown"}</div>
              <div className="cl font-mono text-[11px] text-muted-foreground mt-0.5">{clockTime(jp.playedAt)}</div>
            </div>
            <div className="shrink-0" onClick={e => e.stopPropagation()}>
              <KeepButton 
                mbid={jp.mbid} 
                spinId={jp.spinId} 
                provenance={{ kind: "keep", source: "set_adjacent", stationSlug: station.slug, stationName: station.name, anchorSpinId: np?.spinId ?? undefined, surface: "just_played" }}
                className="h-8 px-3 rounded-lg border border-border bg-transparent flex items-center gap-1.5 text-[13px] text-foreground transition-colors hover:bg-muted aria-pressed:border-transparent aria-pressed:text-muted-foreground aria-pressed:pointer-events-none"
              />
            </div>
          </div>
        ))}
      </div>
      
      <SetContextSheet 
        open={sheetAnchorId !== null && sheetContext !== undefined}
        onOpenChange={(op) => !op && setSheetAnchorId(null)}
        context={sheetContext ?? null}
      />
    </>
  );
}
