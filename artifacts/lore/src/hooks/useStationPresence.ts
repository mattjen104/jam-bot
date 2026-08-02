import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL ?? "/";
const API = `${BASE.replace(/\/$/, "")}/api`;

async function fetchPresence(ids: number[]): Promise<Record<number, number>> {
  if (ids.length === 0) return {};
  const url = `${API}/stations/social/presence?ids=${ids.join(",")}`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) return {};
  const data = (await r.json()) as { presence: Record<string, number> };
  // Convert string keys to numbers
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(data.presence)) {
    out[parseInt(k, 10)] = v;
  }
  return out;
}

/**
 * Polls /api/stations/social/presence every 60 s for active session counts.
 * Returns a Map<stationId, count>.  Only includes stations with count > 0.
 */
export function useStationPresence(
  stationIds: number[],
): Map<number, number> {
  const key = stationIds.slice().sort().join(",");
  const { data } = useQuery({
    queryKey: ["station-presence", key],
    queryFn: () => fetchPresence(stationIds),
    enabled: stationIds.length > 0,
    refetchInterval: 60_000,
    staleTime: 50_000,
  });
  const map = new Map<number, number>();
  if (!data) return map;
  for (const [id, n] of Object.entries(data)) {
    if (n > 0) map.set(Number(id), n);
  }
  return map;
}
