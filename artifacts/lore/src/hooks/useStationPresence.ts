import { useQuery } from "@tanstack/react-query";

const API = "/api";

export interface StationPresence {
  count: number;
  avatars: Array<{ artworkUrl: string; albumTitle: string; artist: string }>;
}

async function fetchPresence(ids: number[]): Promise<Record<number, StationPresence>> {
  if (ids.length === 0) return {};
  const url = `${API}/stations/social/presence?ids=${ids.join(",")}`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) return {};
  const data = (await r.json()) as {
    presence: Record<string, number>;
    avatars?: Record<string, StationPresence["avatars"]>;
  };
  // Convert string keys to numbers
  const out: Record<number, StationPresence> = {};
  for (const [k, v] of Object.entries(data.presence)) {
    out[parseInt(k, 10)] = { count: v, avatars: data.avatars?.[k] ?? [] };
  }
  return out;
}

/**
 * Polls /api/stations/social/presence every 60 s for active session counts.
 * Returns a Map<stationId, anonymous presence>. Covers are only included by
 * the server below its privacy threshold; the client never receives IDs.
 */
export function useStationPresence(
  stationIds: number[],
): Map<number, StationPresence> {
  const key = stationIds.slice().sort().join(",");
  const { data } = useQuery({
    queryKey: ["station-presence", key],
    queryFn: () => fetchPresence(stationIds),
    enabled: stationIds.length > 0,
    refetchInterval: 60_000,
    staleTime: 50_000,
  });
  const map = new Map<number, StationPresence>();
  if (!data) return map;
  for (const [id, presence] of Object.entries(data)) {
    if (presence.count > 0) map.set(Number(id), presence);
  }
  return map;
}
