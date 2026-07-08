import { useState, useEffect } from "react";

export interface IcecastNowPlaying {
  rawArtist: string;
  rawTitle: string;
}

interface IcecastSource {
  "display-title"?: string;
  title?: string;
  listenurl?: string;
}

interface IcecastStats {
  icestats?: {
    source?: IcecastSource | IcecastSource[];
  };
}

function deriveStatusUrl(
  streamUrl: string,
): { statusUrl: string; mountPath: string } | null {
  try {
    const u = new URL(streamUrl);
    if (!u.hostname) return null;
    return {
      statusUrl: `${u.protocol}//${u.host}/status-json.xsl`,
      mountPath: u.pathname,
    };
  } catch {
    return null;
  }
}

function parseDisplayTitle(raw: string): IcecastNowPlaying {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf(" - ");
  if (sep > 0) {
    return {
      rawArtist: trimmed.slice(0, sep).trim(),
      rawTitle: trimmed.slice(sep + 3).trim(),
    };
  }
  return { rawArtist: "", rawTitle: trimmed };
}

/**
 * Browser-side Icecast status-JSON fallback.
 *
 * When a station is playing but the server has no polled now-playing data
 * (common for RadioBrowser longtail stations), this hook polls
 * `{streamDomain}/status-json.xsl` every 30 s to discover the current
 * track from the Icecast relay. Zero stream-bandwidth overhead — the
 * status endpoint is a tiny ~2–5 KB JSON blob with CORS open on most
 * Icecast deployments.
 *
 * The mount path from the stream URL (e.g. `/datawave.mp3`) is matched
 * against each source's `listenurl` in the status JSON so multi-channel
 * relays return the right channel.
 *
 * Returns null when:
 * - `enabled` is false / streamUrl is absent
 * - The domain has no Icecast status endpoint (CORS block or 404)
 * - No source matches the mount path
 * - The station is between tracks (empty display-title)
 */
export function useIcecastFallback(
  streamUrl: string | null | undefined,
  enabled: boolean,
): IcecastNowPlaying | null {
  const [nowPlaying, setNowPlaying] = useState<IcecastNowPlaying | null>(null);

  useEffect(() => {
    if (!enabled || !streamUrl) {
      setNowPlaying(null);
      return;
    }

    const derived = deriveStatusUrl(streamUrl);
    if (!derived) return;

    const { statusUrl, mountPath } = derived;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(statusUrl, {
          signal: AbortSignal.timeout(6_000),
          headers: { Accept: "application/json" },
        });
        if (!res.ok || cancelled) return;

        const json = (await res.json()) as IcecastStats;
        if (cancelled) return;

        const stats = json?.icestats;
        if (!stats) {
          setNowPlaying(null);
          return;
        }

        const sources: IcecastSource[] = Array.isArray(stats.source)
          ? stats.source
          : stats.source
          ? [stats.source]
          : [];

        const match = sources.find((s) => {
          if (!s.listenurl) return false;
          try {
            return new URL(s.listenurl).pathname === mountPath;
          } catch {
            return s.listenurl.endsWith(mountPath);
          }
        });

        const displayTitle = match?.["display-title"] ?? match?.title ?? "";
        if (!displayTitle) {
          setNowPlaying(null);
          return;
        }

        setNowPlaying(parseDisplayTitle(displayTitle));
      } catch {
        // Network error or CORS block — leave previous value intact
      }
    }

    void poll();
    const id = setInterval(() => {
      void poll();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [streamUrl, enabled]);

  return nowPlaying;
}
