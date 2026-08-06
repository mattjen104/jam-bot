import { useState } from "react";
import {
  useMyAlbumAvatar,
  useSetAlbumAvatar,
  type AlbumAvatarCandidate,
} from "../lib/meHooks";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

function sourceLabel(source: AlbumAvatarCandidate["source"]): string {
  if (source === "matt-starter") return "Matt’s starter library";
  if (source === "lore-catalogue") return "Lore catalogue";
  return "your library";
}

/**
 * A deliberately small, music-grounded identity choice. Nothing is selected
 * until the listener taps a cover and confirms it.
 */
export function AlbumAvatarPicker({
  compact = false,
  showCurrent = false,
}: {
  compact?: boolean;
  /** In the Library, surface the selected cover without turning rows noisy. */
  showCurrent?: boolean;
}) {
  const { data, isLoading } = useMyAlbumAvatar();
  const setAvatar = useSetAlbumAvatar();
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading || !data || data.candidates.length === 0) return null;
  if (!data.needsChoice && !(showCurrent && data.current)) return null;

  const chosen = data.candidates.find((candidate) => candidate.recordingMbid === selected) ?? null;
  return (
    <section
      aria-labelledby="album-avatar-title"
      data-testid="album-avatar-picker"
      style={{
        margin: compact ? "8px 0" : "14px 0",
        padding: compact ? 10 : 14,
        border: "1px solid hsl(var(--border) / 0.8)",
        borderRadius: 8,
        background: "hsl(var(--card) / 0.65)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div>
          <div id="album-avatar-title" style={{ fontFamily: "var(--app-font-display)", fontSize: 14, fontWeight: 400 }}>
            {data.needsChoice ? "Choose an album cover for your listener identity" : "Your anonymous listener cover"}
          </div>
          <div style={{ marginTop: 3, color: "hsl(var(--dim))", fontSize: 13 }}>
            {data.needsChoice
              ? "Anonymous, music-grounded, and only shown as “listening here.”"
              : `${data.current!.albumTitle} · ${data.current!.artist} — choose another from your library below.`}
          </div>
        </div>
        <span style={{ color: "hsl(var(--faint))", fontSize: 12, whiteSpace: "nowrap" }}>
          {sourceLabel(data.candidates[0].source)}
        </span>
      </div>
      {data.needsChoice && <div
        role="radiogroup"
        aria-label="Choose an album cover"
        style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 0 4px" }}
      >
        {data.candidates.slice(0, compact ? 5 : 8).map((candidate) => {
          const isSelected = candidate.recordingMbid === selected;
          return (
            <button
              key={candidate.recordingMbid}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${candidate.albumTitle} by ${candidate.artist}`}
              onClick={() => setSelected(candidate.recordingMbid)}
              style={{
                flex: "0 0 92px",
                padding: 4,
                borderRadius: 6,
                border: isSelected ? "2px solid hsl(var(--library))" : "1px solid hsl(var(--border))",
                background: "transparent",
                color: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <img src={proxyArtUrl(candidate.artworkUrl) ?? undefined} alt="" width={82} height={82} style={{ display: "block", width: "100%", objectFit: "cover", borderRadius: 3 }} onError={onArtError} />
              <span style={{ display: "block", marginTop: 5, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {candidate.albumTitle}
              </span>
              <span style={{ display: "block", color: "hsl(var(--dim))", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {candidate.artist}
              </span>
            </button>
          );
        })}
      </div>}
      {data.needsChoice && <button
        type="button"
        disabled={!chosen || setAvatar.isPending}
        onClick={() => chosen && setAvatar.mutate(chosen.recordingMbid)}
        data-testid="album-avatar-confirm"
        style={{
          border: "none",
          borderRadius: 5,
          padding: "6px 10px",
          background: chosen ? "hsl(var(--library))" : "hsl(var(--secondary))",
          color: chosen ? "hsl(var(--library-foreground))" : "hsl(var(--faint))",
          cursor: chosen ? "pointer" : "default",
          fontSize: 12,
        }}
      >
        {setAvatar.isPending ? "saving…" : "Use this cover"}
      </button>}
    </section>
  );
}