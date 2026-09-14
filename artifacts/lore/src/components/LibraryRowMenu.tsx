import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MoreHorizontal, MinusCircle, History } from "lucide-react";
import { type LibraryItem, useSetLibraryRemoved } from "../lib/meHooks";

interface LibraryRowMenuProps {
  item: LibraryItem;
}

export function LibraryRowMenu({
  item,
}: LibraryRowMenuProps) {
  const [open, setOpen] = useState(false);
  const setRemoved = useSetLibraryRemoved();
  const [showUndo, setShowUndo] = useState(false);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
  }, []);
  
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
            className="library-row-menu__trigger w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground"
            aria-label="More options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <>
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
          </>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
