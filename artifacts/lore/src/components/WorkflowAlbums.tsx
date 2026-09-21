import { useState } from "react";
import { Link } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import {
  useMyLibraryAlbums,
  useUpdateLibraryAlbumState,
  useFileLibraryAlbum,
  type LibraryAlbumItem,
} from "../lib/meHooks";
import { X, RotateCcw, Save } from "lucide-react";
import { toast } from "../hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

export function WorkflowAlbums({
  workflow,
  returnContext,
}: {
  workflow: "inbox" | "rotation" | "shelf" | "passed" | "unresolved";
  returnContext: string;
}) {
  const { data, isLoading, isError } = useMyLibraryAlbums(workflow, "", true);
  const updateState = useUpdateLibraryAlbumState();
  const openImport = () => {
    window.dispatchEvent(new CustomEvent("lore:open-import-modal"));
  };

  if (isError) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--destructive))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>Couldn't load albums right now.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>Loading albums…</p>
      </div>
    );
  }

  const items = data?.items ?? [];
  const unresolvedCount = data?.counts.unresolved ?? 0;
  const unresolvedHref = "/library?workflow=unresolved";

  if (items.length === 0) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>
          {workflow === "inbox" ? "Inbox is empty." : `No albums in ${workflow}.`}
        </p>
        {workflow === "inbox" && (
          <>
            {unresolvedCount > 0 && (
              <p style={{ marginTop: 8, fontFamily: "var(--app-font-mono)", fontSize: 11 }}>
                <Link href={unresolvedHref}>{unresolvedCount} unresolved {unresolvedCount === 1 ? "recording" : "recordings"}</Link>
              </p>
            )}
            <button
              type="button"
              onClick={openImport}
              style={{ marginTop: 12, border: 0, borderRadius: 999, padding: "7px 14px", background: "hsl(var(--foreground))", color: "hsl(var(--background))", fontFamily: "var(--app-font-mono)", fontSize: 11, textTransform: "uppercase", cursor: "pointer" }}
            >
              Add music
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 840, margin: "0 auto", padding: "12px 14px", paddingBottom: "max(120px, calc(var(--shell-h, 0px) + 20px))" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {workflow === "inbox" && unresolvedCount > 0 && (
          <Link href={unresolvedHref} style={{ marginRight: "auto", alignSelf: "center", fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))" }}>
            {unresolvedCount} unresolved
          </Link>
        )}
        <button
          type="button"
          onClick={openImport}
          style={{ border: 0, borderRadius: 999, padding: "6px 12px", background: "hsl(var(--secondary) / .65)", color: "hsl(var(--foreground))", fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", cursor: "pointer" }}
        >
          Add music
        </button>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: "24px 16px",
      }}>
        {items.map((item) => {
          if (item.unresolved) {
            return (
              <div key={item.unresolvedId} className="demo-album-card" style={{ display: "flex", flexDirection: "column", gap: 8, opacity: 0.7 }}>
                <div style={{
                  width: "100%",
                  aspectRatio: "1/1",
                  backgroundColor: "hsl(var(--secondary))",
                  borderRadius: 6,
                  overflow: "hidden",
                  border: "1px solid hsl(var(--border) / 0.5)",
                }}>
                  {item.artworkUrl ? (
                    <img
                      src={proxyArtUrl(item.artworkUrl) ?? item.artworkUrl}
                      alt={item.title}
                      loading="lazy"
                      onError={onArtError}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "grayscale(100%)" }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>NO ART</span>
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--app-font-display)",
                    fontSize: 14,
                    fontWeight: 400,
                    color: "hsl(var(--foreground))",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.2,
                    marginBottom: 2,
                  }}>
                    {item.title}
                  </div>
                  <div style={{
                    fontFamily: "var(--app-font-reading)",
                    fontSize: 12,
                    color: "hsl(var(--dim))",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.2,
                    marginBottom: 4,
                  }}>
                    {item.artist}
                  </div>
                  <div style={{
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10,
                    color: "hsl(var(--faint))",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0 6px",
                  }}>
                    <span style={{ color: "hsl(var(--destructive))" }}>Unresolved</span>
                    <span>{item.source}</span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={item.releaseGroupMbid} className="demo-album-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Link
                href={`/album/${item.releaseGroupMbid}?return=${encodeURIComponent(returnContext)}`}
                style={{ display: "block", width: "100%", aspectRatio: "1/1", backgroundColor: "hsl(var(--secondary))", borderRadius: 6, overflow: "hidden", border: "1px solid hsl(var(--border) / 0.5)", position: "relative" }}
              >
                {item.artworkUrl ? (
                  <img
                    src={proxyArtUrl(item.artworkUrl) ?? item.artworkUrl}
                    alt={item.title}
                    loading="lazy"
                    onError={onArtError}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>NO ART</span>
                  </div>
                )}
              </Link>
              <div style={{ minWidth: 0 }}>
                <Link
                  href={`/album/${item.releaseGroupMbid}?return=${encodeURIComponent(returnContext)}`}
                  style={{
                    fontFamily: "var(--app-font-display)",
                    fontSize: 14,
                    fontWeight: 400,
                    color: "hsl(var(--foreground))",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.2,
                    marginBottom: 2,
                    textDecoration: "none",
                    display: "block"
                  }}
                >
                  {item.title}
                </Link>
                <div style={{
                  fontFamily: "var(--app-font-reading)",
                  fontSize: 12,
                  color: "hsl(var(--dim))",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1.2,
                  marginBottom: 4,
                }}>
                  {item.artist}
                </div>
                <div style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  color: "hsl(var(--faint))",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0 6px",
                  marginBottom: 6,
                }}>
                  {item.releaseYear && <span>{item.releaseYear}</span>}
                  {item.sourceCount > 0 && <span>{item.sourceCount}/{item.trackCount} lib</span>}
                </div>

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {item.state === "inbox" && (
                    <>
                      <button
                        title="Move to Rotation"
                        onClick={() => updateState.mutate({ mbid: item.releaseGroupMbid, state: "rotation" })}
                        className="workflow-btn"
                        style={{ border: "1px solid hsl(var(--border))", background: "transparent", color: "hsl(var(--foreground))", borderRadius: 4, padding: "4px 8px", fontSize: 10, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <RotateCcw size={10} /> Rotate
                      </button>
                      <button
                        title="Pass"
                        onClick={() => updateState.mutate({ mbid: item.releaseGroupMbid, state: "passed" })}
                        className="workflow-btn"
                        style={{ border: "1px solid hsl(var(--border))", background: "transparent", color: "hsl(var(--muted-foreground))", borderRadius: 4, padding: "4px 8px", fontSize: 10, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <X size={10} /> Pass
                      </button>
                    </>
                  )}
                  {item.state === "rotation" && (
                    <FilingPopover item={item} />
                  )}
                  {(item.state === "passed" || item.state === "shelf") && (
                    <button
                      title="Restore to Inbox"
                      onClick={() => updateState.mutate({ mbid: item.releaseGroupMbid, state: "inbox" })}
                      className="workflow-btn"
                      style={{ border: "1px solid hsl(var(--border))", background: "transparent", color: "hsl(var(--muted-foreground))", borderRadius: 4, padding: "4px 8px", fontSize: 10, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <RotateCcw size={10} /> Restore
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilingPopover({ item }: { item: LibraryAlbumItem }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(item.note || "");
  const [picks, setPicks] = useState<string[]>(item.picks || []);
  const fileAlbum = useFileLibraryAlbum();
  const updateState = useUpdateLibraryAlbumState();

  const handleFile = () => {
    fileAlbum.mutate({ mbid: item.releaseGroupMbid, note: note.trim() || undefined, picks }, {
      onSuccess: () => {
        toast({ title: "Album filed to shelf." });
        setOpen(false);
      }
    });
  };

  const handlePass = () => {
    updateState.mutate({ mbid: item.releaseGroupMbid, state: "passed" }, {
      onSuccess: () => {
        setOpen(false);
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="workflow-btn"
          style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--library) / 0.15)", color: "hsl(var(--library))", borderRadius: 4, padding: "4px 8px", fontSize: 10, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "center" }}
        >
          <Save size={10} /> File to Shelf
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" style={{ width: 280, padding: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "var(--app-font-display)", fontSize: 14 }}>File {item.title}</div>
          <div>
            <label style={{ display: "block", fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>Note</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What makes this album interesting?"
              style={{ fontSize: 12, minHeight: 60, fontFamily: "var(--app-font-reading)" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>Picks</label>
            {item.activeTrackMbids && item.activeTrackMbids.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {item.activeTrackMbids.map((mbid: string, index: number) => {
                  const isPicked = picks.includes(mbid);
                  return (
                    <button
                      key={mbid}
                      onClick={() => {
                        if (isPicked) setPicks(picks.filter(p => p !== mbid));
                        else setPicks([...picks, mbid]);
                      }}
                      style={{
                        padding: "2px 6px",
                        fontSize: 10,
                        fontFamily: "var(--app-font-mono)",
                        background: isPicked ? "hsl(var(--primary))" : "transparent",
                        color: isPicked ? "hsl(var(--background))" : "hsl(var(--foreground))",
                        border: `1px solid ${isPicked ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      Track {index + 1}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>
                No active tracks to pick from.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={handleFile}
              disabled={fileAlbum.isPending}
              style={{ flex: 1, padding: "6px 0", background: "hsl(var(--foreground))", color: "hsl(var(--background))", border: "none", borderRadius: 4, fontFamily: "var(--app-font-mono)", fontSize: 11, textTransform: "uppercase", cursor: "pointer" }}
            >
              {fileAlbum.isPending ? "..." : "File to Shelf"}
            </button>
            <button
              onClick={handlePass}
              disabled={updateState.isPending}
              style={{ padding: "6px 12px", background: "transparent", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))", borderRadius: 4, fontFamily: "var(--app-font-mono)", fontSize: 11, textTransform: "uppercase", cursor: "pointer" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
