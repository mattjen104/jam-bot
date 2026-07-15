import { useCallback, useEffect, useRef, useState } from "react";
import { Cast, Computer, Loader2, Smartphone, Speaker, Tv2, X } from "lucide-react";
import { spotifyPause } from "@workspace/api-client-react";
import type { SpotifyConnectApi, SpotifyDevice } from "../player/useSpotifyConnect";

/** Map Spotify device type strings to an icon. */
function DeviceIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const lower = type.toLowerCase();
  if (lower === "computer") return <Computer className={className} />;
  if (lower === "smartphone") return <Smartphone className={className} />;
  if (lower === "speaker" || lower === "castaudio" || lower === "castvideo") {
    return <Speaker className={className} />;
  }
  if (lower === "tv" || lower === "avr" || lower === "stb") {
    return <Tv2 className={className} />;
  }
  return <Cast className={className} />;
}

interface DevicePickerProps {
  spotify: SpotifyConnectApi;
}

/**
 * Cast-style device picker for Spotify Connect. Shows a button that opens a
 * popover with all available devices. Selecting one pins it so subsequent
 * tracks are sent to that device automatically.
 */
export function DevicePicker({ spotify }: DevicePickerProps) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { pinnedDevice, fetchDevices, pinDevice, unpinDevice } = spotify;

  const openPicker = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    try {
      const list = await fetchDevices();
      setDevices(list);
    } finally {
      setLoading(false);
    }
  }, [fetchDevices]);

  const handleSelect = useCallback(
    (device: SpotifyDevice) => {
      pinDevice(device);
      setOpen(false);
    },
    [pinDevice],
  );

  const handleDisconnect = useCallback(() => {
    // Pause Spotify best-effort so the device stops playing before we clear the
    // pin; this returns Lore to its normal audio path (broadcast / preview).
    void spotifyPause().catch(() => {});
    unpinDevice();
    setOpen(false);
  }, [unpinDevice]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const isPinned = !!pinnedDevice;

  return (
    <div className="relative shrink-0">
      {/* Cast button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={open ? () => setOpen(false) : openPicker}
        aria-label={
          pinnedDevice
            ? `Playing on ${pinnedDevice.name} — change device`
            : "Choose a Spotify Connect device"
        }
        data-testid="device-picker-button"
        className={[
          "hover-elevate flex h-9 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-colors",
          isPinned
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground",
        ].join(" ")}
        title={
          pinnedDevice
            ? `Playing on ${pinnedDevice.name}`
            : "Cast to a Spotify Connect device"
        }
      >
        <Cast className="h-3.5 w-3.5 shrink-0" />
        {pinnedDevice ? (
          <span className="hidden max-w-[120px] truncate sm:inline">
            {pinnedDevice.name}
          </span>
        ) : null}
      </button>

      {/* Popover */}
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Spotify Connect device picker"
          data-testid="device-picker-panel"
          className="absolute bottom-full mb-2 right-0 z-50 w-64 rounded-xl border border-border bg-secondary/98 shadow-xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Play on device
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close device picker"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : devices.length === 0 ? (
              <p className="px-4 py-4 font-mono text-[11px] text-muted-foreground">
                No Spotify devices found. Open Spotify on a device and try again.
              </p>
            ) : (
              devices.map((device) => {
                const isSelected = pinnedDevice?.id === device.id;
                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => handleSelect(device)}
                    data-testid={`device-option-${device.id}`}
                    className={[
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary/10",
                      isSelected ? "bg-primary/10 text-primary" : "text-foreground",
                    ].join(" ")}
                  >
                    <DeviceIcon
                      type={device.type}
                      className={[
                        "h-4 w-4 shrink-0",
                        isSelected && device.isActive
                          ? "text-primary"
                          : "text-muted-foreground",
                      ].join(" ")}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12px]">
                        {device.name}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {device.type}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {device.isActive ? (
                        <span
                          data-testid={`device-playing-badge-${device.id}`}
                          className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-500"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Playing
                        </span>
                      ) : null}
                      {isSelected ? (
                        <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                          Pinned
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Disconnect option when a device is pinned */}
          {isPinned ? (
            <div className="border-t border-border/60 px-4 py-2">
              <button
                type="button"
                onClick={handleDisconnect}
                data-testid="device-picker-disconnect"
                className="w-full rounded-lg py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors text-center"
              >
                Stop sending to this device
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
