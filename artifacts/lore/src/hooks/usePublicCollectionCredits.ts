import {
  getGetPublicCollectionCreditsQueryKey,
  useGetPublicCollectionCredits,
} from "@workspace/api-client-react";
import { normalizeCreditPayload } from "../lib/creditPayload";

export function usePublicCollectionCredits(slug: string, enabled: boolean) {
  const query = useGetPublicCollectionCredits(slug, {
    query: {
      queryKey: getGetPublicCollectionCreditsQueryKey(slug),
      enabled: enabled && Boolean(slug),
      staleTime: 10 * 60_000,
      retry: false,
    },
  });
  return {
    ...query,
    data: query.data ? normalizeCreditPayload(query.data) : undefined,
  };
}