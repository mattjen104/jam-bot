import { useState, useRef, useEffect } from "react";
import { Headphones } from "lucide-react";
import { BottleIcon } from "./icons/BottleIcon";
import { AvatarPicker } from "./AvatarPicker";
import { useSongBottles, type SongBottle } from "../hooks/useSongBottles";
import { useSocialMode, getStoredAvatar, storeAvatar } from "../lib/social";
import { emojiSvgUrl } from "../lib/twemoji";

// ---------------------------------------------------------------------------
// Note display
// ---------------------------------------------------------------------------

function playsAgoLabel(playsRemaining: number): string {
  const ago = 3 - playsRemaining;
  if (ago <= 0) return "just delivered";
  if (ago === 1) return "1 play ago";
  return `${ago} plays ago`;
}

interface NoteRowProps {
  bottle: SongBottle;
  stationName?: string;
}

function NoteRow({ bottle, stationName }: NoteRowProps) {
  if (!bottle.body) return null;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "8px 0",
        borderBottom: "0.5px solid var(--border, rgba(255,255,255,0.08))",
      }}
    >
      <img
        src={emojiSvgUrl(bottle.avatar)}
        width={24}
        height={24}
        alt={bottle.avatar}
        style={{ flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--muted-foreground, #888)",
            marginBottom: 3,
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 500 }}>{bottle.handle}</span>
          {stationName && (
            <span style={{ opacity: 0.6 }}>on {stationName}</span>
          )}
          <span style={{ opacity: 0.5 }}>· {playsAgoLabel(bottle.playsRemaining)}</span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontStyle: "italic",
            color: "var(--muted-foreground, #999)",
            lineHeight: 1.6,
            wordBreak: "break-word",
          }}
        >
          {bottle.body}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface BottlePanelProps {
  mbid: string | null;
  stationId: number | null;
  stationName?: string;
  trackTitle?: string;
  progressMs?: number;
}

export function BottlePanel({
  mbid,
  stationId,
  stationName,
  trackTitle,
  progressMs,
}: BottlePanelProps) {
  const { enabled: socialEnabled, toggle: toggleSocial } = useSocialMode();
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [avatar, setAvatarState] = useState<string | null>(() => getStoredAvatar());
  const [sending, setSending] = useState(false);
  const [sentConfirm, setSentConfirm] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { bottles, archivedCount, hasUnread, markRead, send } = useSongBottles(
    mbid,
    stationId,
  );

  // Mark as read when panel opens
  useEffect(() => {
    if (open) markRead();
  }, [open, markRead]);

  // Reset panel state when MBID changes
  useEffect(() => {
    setOpen(false);
    setNoteText("");
    setSentConfirm(false);
  }, [mbid]);

  // Cleanup confirmation timer
  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  // Hidden entirely when no MBID is resolved (nothing to anchor to)
  if (!mbid) return null;

  // When solo mode is on: show only the headphones re-enable affordance.
  // The bottle content is hidden but the toggle is always reachable.
  if (!socialEnabled) {
    return (
      <div data-testid="bottle-panel" style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
          <button
            type="button"
            onClick={toggleSocial}
            title="Solo mode on — click to show bottle notes"
            aria-label="Re-enable bottle notes (solo mode is on)"
            data-testid="bottle-solo-toggle"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "var(--picker, #e67e3a)",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Headphones size={14} />
            <span style={{ fontSize: 10, color: "var(--muted-foreground, #888)", opacity: 0.6 }}>
              solo
            </span>
          </button>
        </div>
      </div>
    );
  }

  const handleSend = async () => {
    if (!avatar) return;
    if (!noteText.trim() || !stationId) return;
    setSending(true);
    try {
      await send({
        body: noteText.trim(),
        avatar,
        stationId,
        progressMs,
      });
      setNoteText("");
      setSentConfirm(true);
      confirmTimer.current = setTimeout(() => setSentConfirm(false), 2000);
    } catch {
      // Send failure — leave input intact so user can retry
    } finally {
      setSending(false);
    }
  };

  const handleSelectAvatar = (emoji: string) => {
    setAvatarState(emoji);
    storeAvatar(emoji);
  };

  const triggerLabel = bottles.length > 0 ? `${bottles.length} note${bottles.length === 1 ? "" : "s"}` : null;

  return (
    <div
      data-testid="bottle-panel"
      style={{ width: "100%" }}
    >
      {/* Trigger row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 0",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close bottle notes" : "Open bottle notes"}
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: 6,
            color: hasUnread
              ? "var(--picker, #e67e3a)"
              : "var(--muted-foreground, #888)",
            transition: "color 0.15s",
          }}
          data-testid="bottle-trigger"
        >
          <BottleIcon
            size={18}
            style={{
              filter: hasUnread
                ? "drop-shadow(0 0 4px var(--picker, #e67e3a))"
                : undefined,
            }}
          />
          {triggerLabel && (
            <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              {triggerLabel}
            </span>
          )}
        </button>

        {/* Solo mode toggle */}
        <button
          type="button"
          onClick={toggleSocial}
          title="Solo mode — hide bottles and stop publishing notes"
          aria-label="Toggle solo mode"
          data-testid="bottle-solo-toggle"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: socialEnabled
              ? "var(--muted-foreground, #888)"
              : "var(--picker, #e67e3a)",
            opacity: socialEnabled ? 0.4 : 1,
            transition: "color 0.15s, opacity 0.15s",
          }}
        >
          <Headphones size={14} />
        </button>
      </div>

      {/* Expanded panel */}
      {open && (
        <div
          data-testid="bottle-panel-expanded"
          style={{
            marginTop: 4,
            borderRadius: 12,
            border: "0.5px solid var(--border, rgba(255,255,255,0.1))",
            background: "var(--background, #111)",
            backdropFilter: "blur(12px)",
            padding: "10px 14px",
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--muted-foreground, #888)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "70%",
              }}
            >
              {trackTitle ?? "this song"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                color: "var(--muted-foreground, #888)",
                padding: 2,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Notes list */}
          {bottles.length === 0 ? (
            <p
              style={{
                margin: "12px 0",
                fontSize: 13,
                fontStyle: "italic",
                color: "var(--muted-foreground, #888)",
                opacity: 0.6,
                textAlign: "center",
              }}
            >
              no notes yet — be the first to write.
            </p>
          ) : (
            <div>
              {bottles.map((b) => (
                <NoteRow key={b.id} bottle={b} stationName={stationName} />
              ))}
            </div>
          )}

          {/* Archived resonance count */}
          {archivedCount > 0 && (
            <p
              style={{
                margin: "8px 0 4px",
                fontSize: 11,
                color: "var(--muted-foreground, #888)",
                opacity: 0.5,
                textAlign: "center",
              }}
            >
              {archivedCount} {archivedCount === 1 ? "person has" : "people have"} left notes on this song.
            </p>
          )}

          {/* Input area */}
          <div style={{ marginTop: 10, borderTop: "0.5px solid var(--border, rgba(255,255,255,0.08))", paddingTop: 10 }}>
            {!avatar ? (
              <>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 12,
                    color: "var(--muted-foreground, #888)",
                  }}
                >
                  choose your avatar to write
                </p>
                <AvatarPicker selected={null} onSelect={handleSelectAvatar} />
              </>
            ) : sentConfirm ? (
              <p
                style={{
                  fontSize: 12,
                  fontStyle: "italic",
                  color: "var(--picker, #e67e3a)",
                  textAlign: "center",
                  padding: "8px 0",
                }}
                data-testid="bottle-sent-confirm"
              >
                sealed · travels with the song
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <img
                    src={emojiSvgUrl(avatar)}
                    width={20}
                    height={20}
                    alt={avatar}
                    style={{ flexShrink: 0, cursor: "pointer" }}
                    onClick={() => setAvatarState(null)}
                    title="Change avatar"
                  />
                  <textarea
                    rows={2}
                    maxLength={280}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="write to the next listener…"
                    data-testid="bottle-input"
                    style={{
                      flex: 1,
                      resize: "none",
                      background: "var(--surface-2, rgba(255,255,255,0.04))",
                      border: "0.5px solid var(--border, rgba(255,255,255,0.12))",
                      borderRadius: 8,
                      padding: "6px 8px",
                      fontSize: 13,
                      color: "var(--foreground, #fff)",
                      fontFamily: "inherit",
                      lineHeight: 1.5,
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground, #888)", opacity: 0.5 }}>
                    {noteText.length}/280
                  </span>
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !noteText.trim()}
                    data-testid="bottle-send"
                    style={{
                      padding: "5px 14px",
                      borderRadius: 20,
                      border: "none",
                      background: noteText.trim()
                        ? "var(--picker, #e67e3a)"
                        : "var(--surface-2, rgba(255,255,255,0.08))",
                      color: noteText.trim() ? "#fff" : "var(--muted-foreground, #888)",
                      fontSize: 12,
                      cursor: noteText.trim() ? "pointer" : "default",
                      transition: "background 0.15s",
                    }}
                  >
                    {sending ? "sealing…" : "seal & send"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
