import { useCallback, useEffect, useRef, useState } from "react";
import { getSpotifyStatus, spotifyLogout } from "@workspace/api-client-react";

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
  const aliveRef = useRef(true);

  const refresh = useCallback(() => {
    void getSpotifyStatus()
      .then((s) => {
        if (!aliveRef.current) return;
        setConfigured(s.configured);
        setConnected(s.connected);
        setDisplayName(s.displayName ?? null);
        setProduct(s.product ?? null);
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
      });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

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
  };
}
