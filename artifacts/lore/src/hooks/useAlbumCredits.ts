import { getGetMyAlbumCreditsQueryKey, useGetMyAlbumCredits } from "@workspace/api-client-react";
import { normalizeCreditPayload } from "../lib/creditPayload";

/**
 * Album credits are deliberately one read. The album endpoint returns the
 * album summary and an optional track-keyed map; callers must not fan this out
 * into one request per visible row.
 */
export function useAlbumCredits(releaseGroupMbid: string, enabled = true) {
  const query = useGetMyAlbumCredits(releaseGroupMbid, {
    query: {
      queryKey: getGetMyAlbumCreditsQueryKey(releaseGroupMbid),
      enabled: enabled && Boolean(releaseGroupMbid),
      staleTime: 10 * 60_000,
      retry: false,
    },
  });
  return { ...query, data: query.data ? normalizeCreditPayload(query.data) : undefined };
}