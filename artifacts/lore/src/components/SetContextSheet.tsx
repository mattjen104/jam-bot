import { useEffect, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./ui/sheet";
import { KeepButton } from "./KeepButton";
import { useInlinePreview } from "../player/inlinePreview";
import { usePlayer } from "../player/PlayerProvider";
import { useDialData } from "../hooks/useDialData";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import { type SetContext, type SetContextTrack } from "../lib/setContexts";
import { Play } from "lucide-react";
import type { LibraryProvenance } from "../lib/meHooks";
import { safeHttpUrl } from "../lib/utils";
import { buildLibraryEntityUrl } from "../lib/libraryFocusedNavigation";
import { useAppConfig } from "../lib/meHooks";

function renderClaim(claim: { kind: string; dj?: string; show?: string }, station: { name: string }) {
  if (claim.kind === "selected_by" && claim.dj) {
    return `Selected by ${claim.dj}`;
  }
  if (claim.kind === "unnameable") {
    return `${station.name} †`;
  }
  return `Played on ${station.name}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  
  if (days < 6) {
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dom = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${day} ${dom} ${month} · ${time}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ` · ${time}`;
}

interface SetContextSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: SetContext | null;
  onNavigateAction?: () => void; // call when navigating to close sheet
}

function Row({ 
  label, 
  track, 
  dimmed = false, 
  isAnchor = false,
  isLive = false,
  onPlayStart,
  provenance,
  onNavigateAction,
  onOpenChange,
  returnContext,
  demoSurface,
}: { 
  label?: string; 
  track: SetContextTrack | null; 
  dimmed?: boolean;
  isAnchor?: boolean;
  isLive?: boolean;
  onPlayStart: () => void;
   provenance?: Partial<LibraryProvenance>;
  onNavigateAction?: () => void;
  onOpenChange?: (open: boolean) => void;
  returnContext?: string;
  demoSurface?: boolean;
}) {
  const { playingMbid, loadingMbid, toggle } = useInlinePreview();
  const playable = track?.mbid != null && track.previewUrl != null;
  const isPlaying = track?.mbid != null && playingMbid === track.mbid;
  const isLoading = track?.mbid != null && loadingMbid === track.mbid;

  if (!track) {
    return (
      <>
        {label && <div className="sub mt-2 text-[11px] text-muted-foreground tracking-widest uppercase">{label}</div>}
        <div className="row dimmed opacity-50 flex items-center gap-3 py-2.5">
          <div className="cov w-11 h-11 rounded bg-muted flex-shrink-0" />
          <div className="body flex-1 font-mono text-[11px] text-muted-foreground">
            {isLive ? "Still on air" : label === "Before it" ? "Nothing logged before" : "Nothing logged after"}
          </div>
        </div>
      </>
    );
  }

  const title = track.title ?? "Unknown track";
  const artist = track.artist ?? "Unknown artist";
  const album = track.albumTitle;
  const art = track.artworkUrl ?? (track.releaseGroupMbid ? `https://coverartarchive.org/release-group/${track.releaseGroupMbid}/front-1200` : null);

  return (
    <>
      {label && !isAnchor && <div className="sub mt-2 text-[11px] text-muted-foreground tracking-widest uppercase">{label}</div>}
      <div className={`row flex items-center gap-3 py-2.5 border-t border-border ${isAnchor ? "tint bg-background -mx-5 px-5" : ""} ${dimmed ? "opacity-50" : ""}`}>
        <div className="cov w-11 h-11 rounded bg-muted flex-shrink-0 overflow-hidden">
          {art && <img src={proxyArtUrl(art) ?? art} alt="" onError={onArtError} className="w-full h-full object-cover" />}
        </div>
        <div className="body flex-1 min-w-0">
          <div className="ttl text-[14px] font-medium truncate">
            {track.mbid ? (
              <Link href={buildLibraryEntityUrl(`/song/${encodeURIComponent(track.mbid)}`, returnContext, { demoSurface: Boolean(demoSurface) })} onClick={() => { onNavigateAction?.(); onOpenChange?.(false); }}>
                {title}
              </Link>
            ) : title}
          </div>
          <div className="art text-[12px] text-muted-foreground truncate">
            {track.artistMbid ? (
               <Link href={buildLibraryEntityUrl(`/artist/${encodeURIComponent(track.artistMbid)}`, returnContext, { demoSurface: Boolean(demoSurface) })} onClick={() => { onNavigateAction?.(); onOpenChange?.(false); }} className="hover:underline">
                 {artist}
               </Link>
            ) : artist}
            {album && <>· <span className="alb text-foreground underline decoration-border underline-offset-2">{album}</span></>}
          </div>
        </div>
        {!isAnchor && playable && (
          <button 
            type="button" 
            className="btn ghost w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onPlayStart();
               void toggle(track.mbid!, track.previewUrl);
            }}
            aria-label="Preview"
          >
            {isLoading ? "…" : isPlaying ? "❚❚" : <Play className="w-4 h-4 fill-current" />}
          </button>
        )}
        <KeepButton mbid={track.mbid} spinId={track.spinId} compact provenance={provenance} />
      </div>
    </>
  );
}

export function SetContextSheet({ open, onOpenChange, context, onNavigateAction }: SetContextSheetProps) {
  const { radio } = usePlayer();
  const { stations } = useDialData("personal");
  const { stop, playingMbid, loadingMbid } = useInlinePreview();
  const [location] = useLocation();
  const search = useSearch();
  const { data: appConfig } = useAppConfig();
  const demoSurface = appConfig?.demoSurface === true;
  const returnContext = `${location.split("?")[0]}${search ? `?${search.replace(/^\?/, "")}` : ""}`;
  const duckedBySheetRef = useRef(false);
  
  // Stop preview when sheet closes
  useEffect(() => {
    if (!open) {
      stop();
      if (duckedBySheetRef.current) {
        duckedBySheetRef.current = false;
        radio.restoreDuck();
      }
    }
  }, [open, radio, stop]);

  useEffect(() => {
    if (!playingMbid && !loadingMbid && duckedBySheetRef.current) {
      duckedBySheetRef.current = false;
      radio.restoreDuck();
    }
  }, [loadingMbid, playingMbid, radio]);

  if (!context) return null;

  const yieldRadio = () => {
    if (radio.status === "playing") {
      duckedBySheetRef.current = true;
      radio.duck();
    }
  };

  const djName = context.claim?.dj ? context.claim.dj.split(' ')[0] : context.station.name;
  
  // Check if radio is currently playing this exact station
  const isPlayingThisStation = radio.status === "playing" && radio.station?.slug === context.station.slug;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="p-0 border-t rounded-t-2xl sm:max-w-md mx-auto h-auto max-h-[85vh] overflow-y-auto bg-muted">
        <SheetTitle className="sr-only">Set around {context.anchor.title ?? "this track"}</SheetTitle>
        <SheetDescription className="sr-only">
          Tracks logged immediately before and after this play on {context.station.name}.
        </SheetDescription>
        <div className="sheet p-5 pt-3 pb-8">
          <div className="grab w-9 h-1 rounded-full bg-border mx-auto mb-4" />
          
          <div className="claim font-serif text-[17px] leading-snug">
            {context.claim
              ? renderClaim(context.claim, context.station)
              : context.anchor.show?.djName
                ? `Selected by ${context.anchor.show.djName}`
                : `Played on ${context.station.name}`}
          </div>
          <div className="cite font-mono text-[11px] text-muted-foreground mt-0.5 mb-4 block">
            <span>{context.station.name}</span>
            {" · "}
            {formatDate(context.anchor.playedAt)}
          </div>

          <Row 
            label="Before it" 
            track={context.before} 
            onPlayStart={yieldRadio}
            provenance={{ source: "set_adjacent", anchorSpinId: context.anchor.spinId }}
            onNavigateAction={onNavigateAction}
            onOpenChange={onOpenChange}
            returnContext={returnContext}
            demoSurface={demoSurface}
          />
          
          <Row 
            label="Anchor"
            track={context.anchor} 
            isAnchor 
            onPlayStart={yieldRadio}
            provenance={{ kind: "keep", source: "set_adjacent", stationSlug: context.station.slug, stationName: context.station.name, anchorSpinId: context.anchor.spinId }}
            onNavigateAction={onNavigateAction}
            onOpenChange={onOpenChange} 
            returnContext={returnContext}
            demoSurface={demoSurface}
          />
          
          <Row 
            label="After it" 
            track={context.after} 
            isLive={!context.after && context.anchorIsLive}
            onPlayStart={yieldRadio}
            provenance={{ source: "set_adjacent", anchorSpinId: context.anchor.spinId }}
            onNavigateAction={onNavigateAction}
            onOpenChange={onOpenChange}
            returnContext={returnContext}
            demoSurface={demoSurface}
          />

          <button 
            type="button"
            className="btn fill w-full h-10 mt-4 rounded-lg bg-foreground text-background flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
            onClick={() => {
              if (isPlayingThisStation) return;
              const fullStation = stations.find(s => s.station.slug === context.station.slug)?.station;
              if (fullStation) radio.toggle(fullStation);
              onNavigateAction?.();
              onOpenChange(false);
            }}
            disabled={isPlayingThisStation}
          >
            <span className="w-4 h-4 rounded-full border-[1.6px] border-current flex items-center justify-center"><span className="w-1 h-1 bg-current rounded-full" /></span>
            {isPlayingThisStation ? `Listening to ${context.station.name}` : `Tune in to ${djName}'s show`}
          </button>
          
          {safeHttpUrl(context.station.homepageUrl) && (
            <a 
              href={safeHttpUrl(context.station.homepageUrl)!}
              target="_blank"
              rel="noreferrer"
              className="link block text-center mt-3 text-[13px] text-muted-foreground hover:underline"
            >
              See the whole set on {new URL(safeHttpUrl(context.station.homepageUrl)!).hostname.replace('www.', '')} ↗
            </a>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
