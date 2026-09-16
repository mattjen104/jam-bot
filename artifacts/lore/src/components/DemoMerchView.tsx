import { useMemo } from "react";
import { useGetMyMerch } from "@workspace/api-client-react";
import { MerchCollection } from "./MerchCollection";
import { normalizeMerchResponse } from "../lib/merch";

export function DemoMerchView({
  focusedArtist,
  focusedArtistMbid,
}: {
  focusedArtist: string | null;
  focusedArtistMbid?: string | null;
}) {
  const merchQuery = useGetMyMerch(
    focusedArtistMbid ? { artistMbid: focusedArtistMbid } : undefined,
  );
  const merch = useMemo(() => {
    const items = normalizeMerchResponse(merchQuery.data).items;
    // Display-name matching is deliberately not a fallback: names are not
    // canonical identities and can collide across artists.
    if (!focusedArtistMbid) return focusedArtist ? [] : items;
    return items.filter((item) => item.artistMbid === focusedArtistMbid);
  }, [merchQuery.data, focusedArtist, focusedArtistMbid]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-[max(120px,calc(var(--shell-h,0px)+20px))] pt-3">
      <MerchCollection
        items={merch}
        isLoading={merchQuery.isLoading}
        isError={merchQuery.isError}
        emptyMessage={focusedArtist
          ? `No verified merch found for ${focusedArtist}.`
          : "No verified merch found in your library or seeds."}
      />
    </div>
  );
}