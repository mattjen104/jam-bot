import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpotifyStatus,
  spotifyLogout,
  getSpotifyDevices,
  type SpotifyDevice,
} from "@workspace/api-client-react";

export type { SpotifyDevice };

/**
 * Spotify Connect state for this browser session. The server holds the OAuth
 * tokens (httpOnly cookie identity); this hook only mirrors status and drives
 * the connect/disconnect navigation. Nothing here touches audio — Spotify
 * plays on the listener's own device.
 */
export interface SpotifyConnectApi {
  /** Server has app credentials; when false the feature is honestly absent. */
  configured: boolean;
  connected: boolean;
  /** Full-track remote playback needs Premium. */
  premium: boolean;
  displayName: string | null;
  product: string | null;
  /** One-shot message from the OAuth return redirect (?spotify=...). */
  notice: string | null;
  clearNotice: () => void;
  connect: () => void;
  disconnect: () => void;
  refresh: () => void;

  /** The device the listener has pinned for one-at-a-time queuing. Session-only. */
  pinnedDevice: SpotifyDevice | null;
  /** Fetch available Spotify Connect devices (call on picker open). */
  fetchDevices: () => Promise<SpotifyDevice[]>;
  /** Pin a device — subsequent tracks will be sent to it automatically. */
  pinDevice: (device: SpotifyDevice) => void;
  /** Unpin the current device, returning to the active-device default. */
  unpinDevice: () => void;
}

const NOTICES: Record<string, string> = {
  connected: "Spotify connected — rides now play full tracks on your Spotify.",
  denied: "Spotify connection declined — rides keep playing 30s previews.",
  error: "Spotify connection failed — rides keep playing 30s previews.",
};

export function useSpotifyConnect(): SpotifyConnectApi {
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinnedDevice, setPinnedDevice] = useState<SpotifyDevice | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(() => {
    void getSpotifyStatus()
      .then((s) => {
        if (!aliveRef.current) return;
        setConfigured(s.configured);
        setConnected(s.connected);
        setDisplayName(s.displayName ?? null);
        setProduct(s.product ?? null);
        // If connection dropped, clear the pinned device so we don't silently
        // keep sending commands to a device for a disconnected session.
        if (!s.connected) setPinnedDevice(null);
      })
      .catch(() => {
        // Status is best-effort; failure just means "no Spotify layer".
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;

    // Handle the OAuth return redirect: surface a one-shot notice and strip
    // the query param so refreshes don't repeat it.
    try {
      const url = new URL(window.location.href);
      const flag = url.searchParams.get("spotify");
      if (flag) {
        setNotice(NOTICES[flag] ?? null);
        url.searchParams.delete("spotify");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      // URL parsing is cosmetic only.
    }

    refresh();

    // When the user returns from the OAuth new tab, re-check status so the
    // connected state updates without requiring a manual page reload.
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      aliveRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const connect = useCallback(() => {
    // Open in a new tab so Spotify's X-Frame-Options doesn't block it when
    // the app is running inside an iframe (e.g. Replit canvas preview).
    window.open("/api/spotify/login", "_blank", "noopener");
  }, []);

  const disconnect = useCallback(() => {
    void spotifyLogout()
      .catch(() => {})
      .finally(() => {
        if (!aliveRef.current) return;
        setConnected(false);
        setDisplayName(null);
        setProduct(null);
        setPinnedDevice(null);
      });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const fetchDevices = useCallback(async (): Promise<SpotifyDevice[]> => {
    try {
      const result = await getSpotifyDevices();
      return result.devices;
    } catch {
      return [];
    }
  }, []);

  const pinDevice = useCallback((device: SpotifyDevice) => {
    setPinnedDevice(device);
  }, []);

  const unpinDevice = useCallback(() => {
    setPinnedDevice(null);
  }, []);

  return {
    configured,
    connected,
    premium: product === "premium",
    displayName,
    product,
    notice,
    clearNotice,
    connect,
    disconnect,
    refresh,
    pinnedDevice,
    fetchDevices,
    pinDevice,
    unpinDevice,
  };
}
