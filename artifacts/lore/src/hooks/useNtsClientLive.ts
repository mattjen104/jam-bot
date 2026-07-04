import { useQuery } from "@tanstack/react-query";

export interface NtsShowInfo {
  showName: string;
  djName?: string;
}

interface NtsLiveBody {
  now?: {
    broadcast_title?: string;
    start_timestamp?: string;
    embeds?: { details?: { name?: string } };
  };
}

async function fetchNtsChannel(channel: 1 | 2): Promise<NtsShowInfo | null> {
  try {
    const res = await fetch(`https://www.nts.live/api/v2/live/${channel}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as NtsLiveBody;
    const now = body.now;
    if (!now) return null;
    if (now.start_timestamp) {
      const startMs = new Date(now.start_timestamp).getTime();
      if (!isNaN(startMs) && startMs > Date.now()) return null;
    }
    const showName = now.broadcast_title?.trim();
    if (!showName) return null;
    const djName = now.embeds?.details?.name?.trim() || undefined;
    return { showName, djName };
  } catch {
    return null;
  }
}

export function useNtsChannel1() {
  return useQuery({
    queryKey: ["nts-client-live", 1] as const,
    queryFn: () => fetchNtsChannel(1),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 90 * 1000,
    retry: false,
    gcTime: 5 * 60 * 1000,
  });
}

export function useNtsChannel2() {
  return useQuery({
    queryKey: ["nts-client-live", 2] as const,
    queryFn: () => fetchNtsChannel(2),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 90 * 1000,
    retry: false,
    gcTime: 5 * 60 * 1000,
  });
}
