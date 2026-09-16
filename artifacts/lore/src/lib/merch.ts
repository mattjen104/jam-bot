import { useQuery } from "@tanstack/react-query";
import type { MerchProduct } from "../components/MerchCollection";

export type MerchResponse = {
  items: MerchProduct[];
  total: number;
};

export const merchQueryKey = (artistMbid?: string | null) =>
  ["me", "merch", artistMbid ?? null] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Normalize the evolving merch response at the UI boundary. The generated
 * client currently describes imageUrl as required; the verified merch
 * contract permits null for image-less products.
 */
export function normalizeMerchResponse(value: unknown): MerchResponse {
  const sourceItems = isRecord(value) && Array.isArray(value.items) ? value.items : [];
  const items = sourceItems.flatMap((raw): MerchProduct[] => {
    if (!isRecord(raw)) return [];
    const title = typeof raw.title === "string" ? raw.title : "";
    const artist = typeof raw.artist === "string" ? raw.artist : "";
    const destinationUrl = typeof raw.destinationUrl === "string" ? raw.destinationUrl : "";
    if (!title || !artist || !destinationUrl) return [];
    return [{
      title,
      artist,
      artistMbid: typeof raw.artistMbid === "string" ? raw.artistMbid : null,
      imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
      destinationUrl,
      source: typeof raw.source === "string" ? raw.source : "verified",
      provider: typeof raw.provider === "string" ? raw.provider : null,
      kind: typeof raw.kind === "string" ? raw.kind : "artist_direct",
    }];
  });
  return {
    items,
    total: typeof value === "object" && value !== null && typeof (value as { total?: unknown }).total === "number"
      ? (value as { total: number }).total
      : items.length,
  };
}

/**
 * Artist-scoped merch request. The generated client has not received the
 * optional artistMbid query parameter yet, so this deliberately uses the
 * same relative endpoint with the pending contract encoded in the URL.
 */
export function useArtistMerch(artistMbid: string | null | undefined) {
  return useQuery({
    queryKey: merchQueryKey(artistMbid),
    enabled: Boolean(artistMbid),
    queryFn: async ({ signal }): Promise<MerchResponse> => {
      const params = new URLSearchParams();
      if (artistMbid) params.set("artistMbid", artistMbid);
      const response = await fetch(`/api/me/merch?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Merch request failed (${response.status})`);
      }
      return normalizeMerchResponse(await response.json());
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}