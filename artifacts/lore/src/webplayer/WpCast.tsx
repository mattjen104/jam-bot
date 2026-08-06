import { useCallback, useEffect, useRef, useState } from "react";
import { Cast, Loader2, RotateCw, X } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import type { SpotifyDevice } from "../player/useSpotifyConnect";
import type {
  RadioCastFallbackReason,
  RadioCastStatus,
} from "../player/PlayerProvider";

/** Honest one-line description of the current cast state. */
export function castStatusLine(
  casting: RadioCastStatus,
  reason: RadioCastFallbackReason | null,
  paused: boolean,
  deviceName: string,
): string | null {
  if (casting === "casting") {
    return paused ? `Paused on ${deviceName}` : `Casting to ${deviceName}`;
  }
  if (casting === "connecting") {
    return "Waiting for a track to resolve to Spotify…";
  }
  if (casting === "fallback") {
    return reason === "rate_limited"
      ? "Spotify is rate-limited right now · playing the broadcast"
      : reason === "spotify_error"
        ? "Spotify unavailable · playing the broadcast"
        : "Not on Spotify · playing the broadcast";
  }
  return null;
}

/**
 * Spotify cast control for the webplayer's now-playing card. Renders the
 * connect prompt when Spotify isn't linked, a premium note when the tier
 * can't cast, and otherwise a cast toggle + device list. Pinning a device is
 * what turns casting on — the PlayerProvider's live-cast loop watches the
 * pinned device and the station's now-playing and does the rest (including
 * pausing the browser stream and falling back honestly on errors).
 */
export function WpCast() {
  const { radio, spotify } = usePlayer();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { pinnedDevice, fetchDevices, pinDevice, unpinDevice } = spotify;

  const openPicker = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setFetchError(false);
    try {
      setDevices(await fetchDevices());
    } catch {
      setDevices(null);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchDevices]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Feature honestly absent when the server has no Spotify credentials.
  if (!spotify.configured) return null;

  if (!spotify.connected) {
    return (
      <button
        type="button"
        onClick={spotify.connect}
        className="wp-pill"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          border: "1px solid var(--wp-border)",
          background: "transparent",
          color: "var(--wp-text-secondary)",
          cursor: "pointer",
        }}
        title="Connect Spotify to cast this station to your devices"
        data-testid="wp-cast-connect"
      >
        <Cast size={13} aria-hidden="true" /> Connect Spotify to cast
      </button>
    );
  }

  if (!spotify.premium) {
    return (
      <span
        className="wp-pill"
        style={{ color: "var(--wp-text-muted)" }}
        title="Spotify Premium is required to cast to your devices"
        data-testid="wp-cast-premium-note"
      >
        Casting needs Spotify Premium
      </span>
    );
  }

  const statusLine = castStatusLine(
    radio.casting,
    radio.castFallbackReason,
    radio.castPaused,
    pinnedDevice?.name ?? "your Spotify",
  );
  const isPinned = !!pinnedDevice;

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={open ? () => setOpen(false) : () => void openPicker()}
        aria-label={
          pinnedDevice
            ? `Casting to ${pinnedDevice.name} — change device`
            : "Cast to a Spotify Connect device"
        }
        className="wp-pill"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          border: "1px solid",
          ...(isPinned
            ? {
                borderColor: "transparent",
                background: "var(--wp-bg-accent)",
                color: "var(--wp-text-accent)",
              }
            : {
                borderColor: "var(--wp-border)",
                background: "transparent",
                color: "var(--wp-text-secondary)",
              }),
        }}
        title={pinnedDevice ? `Casting to ${pinnedDevice.name}` : "Cast to Spotify"}
        data-testid="wp-cast-button"
      >
        <Cast size={13} aria-hidden="true" />
        {pinnedDevice ? (
          <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pinnedDevice.name}
          </span>
        ) : (
          "Cast"
        )}
      </button>

      {statusLine && (
        <span
          className="wp-mono"
          style={{
            fontSize: 13,
            color:
              radio.casting === "fallback"
                ? "var(--wp-text-muted)"
                : "var(--wp-text-accent)",
          }}
          data-testid="wp-cast-status"
        >
          {statusLine}
        </span>
      )}

      {radio.casting === "fallback" &&
        radio.castFallbackReason !== "not_on_spotify" && (
          <button
            type="button"
            onClick={radio.castRetry}
            className="wp-pill"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              border: "1px solid var(--wp-border)",
              background: "transparent",
              color: "var(--wp-text-secondary)",
              cursor: "pointer",
              fontSize: 13,
            }}
            title="Try Spotify again for this track"
            data-testid="wp-cast-retry"
          >
            <RotateCw size={11} aria-hidden="true" /> Retry
          </button>
        )}

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Spotify Connect device picker"
          className="wp-card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 50,
            width: 260,
            padding: 0,
            boxShadow: "0 10px 30px rgba(0, 0, 0,0.35)",
          }}
          data-testid="wp-cast-panel"
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 14px",
              borderBottom: "0.5px solid var(--wp-border)",
            }}
          >
            <span className="wp-mono" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--wp-text-muted)" }}>
              Cast to device
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close device picker"
              style={{ background: "none", border: "none", padding: 2, color: "var(--wp-text-muted)", cursor: "pointer", display: "inline-flex" }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto", padding: "4px 0" }}>
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
                <Loader2 size={18} className="animate-spin" style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
              </div>
            ) : fetchError ? (
              <p className="wp-mono" style={{ margin: 0, padding: "14px 14px", fontSize: 13, color: "var(--wp-text-muted)" }} data-testid="wp-cast-devices-error">
                Couldn't reach Spotify — try again in a moment.
              </p>
            ) : (devices ?? []).length === 0 ? (
              <p className="wp-mono" style={{ margin: 0, padding: "14px 14px", fontSize: 13, color: "var(--wp-text-muted)" }} data-testid="wp-cast-devices-empty">
                No Spotify devices found. Open Spotify on a device and try again.
              </p>
            ) : (
              (devices ?? []).map((device) => {
                const isSelected = pinnedDevice?.id === device.id;
                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => {
                      pinDevice(device);
                      setOpen(false);
                    }}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 14px",
                      background: isSelected ? "var(--wp-bg-accent)" : "none",
                      border: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      color: isSelected ? "var(--wp-text-accent)" : "inherit",
                    }}
                    data-testid={`wp-cast-device-${device.id}`}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {device.name}
                      </p>
                      <p className="wp-mono" style={{ margin: 0, fontSize: 12, color: "var(--wp-text-muted)" }}>
                        {device.type}
                        {device.isActive ? " · playing" : ""}
                      </p>
                    </div>
                    {isSelected && (
                      <span className="wp-mono" style={{ fontSize: 12, color: "var(--wp-text-accent)", flexShrink: 0 }}>
                        casting
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {isPinned && (
            <div style={{ borderTop: "0.5px solid var(--wp-border)", padding: "6px 14px 8px" }}>
              <button
                type="button"
                onClick={() => {
                  // Unpinning ends the cast; the provider's cleanup pauses the
                  // listener's Spotify and hands audio back to the broadcast.
                  unpinDevice();
                  setOpen(false);
                }}
                className="wp-mono"
                style={{ width: "100%", background: "none", border: "none", padding: "5px 0", fontSize: 13, color: "var(--wp-text-muted)", cursor: "pointer" }}
                data-testid="wp-cast-stop"
              >
                Stop casting · back to the stream
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
