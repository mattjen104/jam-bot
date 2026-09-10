import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import * as Popover from "@radix-ui/react-popover";
import { MoreHorizontal, Disc, User, MinusCircle, History, ListVideo } from "lucide-react";
import { type LibraryItem, useSetLibraryRemoved } from "../lib/meHooks";
import { type SetContext } from "../lib/setContexts";
import { SetContextSheet } from "./SetContextSheet";

interface LibraryRowMenuProps {
  item: LibraryItem;
  setContext?: SetContext | null;
  onNavigateAction?: () => void;
  onArtistFocus?: (artistName: string) => void;
  onAlbumFocus?: () => void;
}

export function LibraryRowMenu({
  item,
  setContext,
  onNavigateAction,
  onArtistFocus,
  onAlbumFocus,
}: LibraryRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, navigate] = useLocation();
  const setRemoved = useSetLibraryRemoved();
  const [showUndo, setShowUndo] = useState(false);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
  }, []);
  
  const rec = item.recording;
  const isImport = item.provenance.kind === "import";
  const isRemoved = item.removed === true;
  
  const handleRemove = () => {
    setRemoved.mutate({ mbid: item.mbid, spotifyId: item.spotifyId, removed: true }, {
      onSuccess: () => {
        setShowUndo(true);
        undoTimerRef.current = window.setTimeout(() => setShowUndo(false), 5000);
      }
    });
    setOpen(false);
  };
  
  const handleUndo = () => {
    setRemoved.mutate({ mbid: item.mbid, spotifyId: item.spotifyId, removed: false }, {
      onSuccess: () => setShowUndo(false)
    });
  };

  if (showUndo) {
    return (
      <div className="flex items-center gap-2 pr-4 text-[13px] text-muted-foreground animate-in fade-in">
        {isImport ? "Hidden" : "Removed"} · <button onClick={handleUndo} className="hover:text-foreground hover:underline">Undo</button>
      </div>
    );
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button 
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground"
            aria-label="More options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          {open ? (
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 border-0 bg-black/55"
              onClick={() => setOpen(false)}
            />
          ) : null}
          <Popover.Content 
            align="end" 
            sideOffset={4}
            className="w-56 p-1.5 rounded-xl bg-muted border border-border shadow-lg animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 z-50"
          >
            {setContext && (
              <button 
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[14px] text-foreground hover:bg-background transition-colors"
                onClick={() => {
                  setOpen(false);
                  setSheetOpen(true);
                }}
              >
                <ListVideo className="w-[17px] h-[17px] text-muted-foreground stroke-[1.5]" />
                From the set
              </button>
            )}
            
            {rec?.releaseGroupMbid && (
              <button
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[14px] text-foreground hover:bg-background transition-colors"
                onClick={() => {
                  if (onAlbumFocus) onAlbumFocus();
                  else navigate(`/album/${rec.releaseGroupMbid}`);
                  onNavigateAction?.();
                  setOpen(false);
                }}
              >
                <Disc className="w-[17px] h-[17px] text-muted-foreground stroke-[1.5]" />
                Open album
              </button>
            )}
            
            {rec?.artistMbid && (
              <button
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[14px] text-foreground hover:bg-background transition-colors"
                onClick={() => {
                  if (onArtistFocus && rec.artist) onArtistFocus(rec.artist);
                  else navigate(`/artist/${rec.artistMbid}`);
                  onNavigateAction?.();
                  setOpen(false);
                }}
              >
                <User className="w-[17px] h-[17px] text-muted-foreground stroke-[1.5]" />
                Open artist
              </button>
            )}
            
            {!isRemoved && (
              <button
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[14px] text-dim hover:bg-background hover:text-destructive transition-colors"
                onClick={handleRemove}
              >
                {isImport ? (
                  <MinusCircle className="w-[17px] h-[17px] text-muted-foreground stroke-[1.5]" />
                ) : (
                  <History className="w-[17px] h-[17px] text-muted-foreground stroke-[1.5]" />
                )}
                {isImport ? "Hide from library" : "Remove keep"}
              </button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      
      {setContext && (
        <SetContextSheet 
          open={sheetOpen} 
          onOpenChange={setSheetOpen} 
          context={setContext}
          onNavigateAction={onNavigateAction}
        />
      )}
    </>
  );
}
