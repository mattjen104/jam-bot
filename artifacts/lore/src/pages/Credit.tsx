import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Music2 } from "lucide-react";
import { appendReturnState, readReturnState } from "../lib/returnState";
import { getDiscoverMyCreditedArtistQueryKey, useDiscoverMyCreditedArtist } from "@workspace/api-client-react";

function useKeptCredit(artistId: string) {
  return useDiscoverMyCreditedArtist(artistId, {
    query: {
      queryKey: getDiscoverMyCreditedArtistQueryKey(artistId),
      enabled: Boolean(artistId),
      staleTime: 60_000,
      retry: false,
    },
  });
}

export default function Credit() {
  const params = useParams();
  const [location] = useLocation();
  const artistId = params.artistId ?? params.id ?? "";
  const returnTo = readReturnState(window.location.search);
  const { data, isLoading, isError } = useKeptCredit(artistId);
  const items = data?.songs ?? [];
  const name = items[0]?.creditedName ?? "Verified credit";
  const backHref = returnTo ?? "/library";

  return (
    <main className="credit-page">
      <Link href={backHref} className="credit-page__back">
        <ArrowLeft aria-hidden="true" /> Back to Library
      </Link>
      <header className="credit-page__header">
        <p className="credit-page__eyebrow">Kept credits</p>
        <h1>{name}</h1>
        <p>Verified roles represented in your Library. This is not a complete discography.</p>
        <Link href={appendReturnState(`/artist/${encodeURIComponent(artistId)}`, location)} className="credit-page__context-link">
          Open artist context →
        </Link>
      </header>
      {isLoading && <p className="credit-page__state">Loading kept work…</p>}
      {isError && <p className="credit-page__state" role="alert">Kept credit results are unavailable right now.</p>}
      {!isLoading && !isError && items.length === 0 && (
        <p className="credit-page__state">No kept Songs or Albums have this verified credit.</p>
      )}
      <ul className="credit-page__items">
        {items.map((item, index) => {
          const href = item.mbid ? appendReturnState(`/song/${encodeURIComponent(item.mbid)}`, location) : null;
          return (
            <li key={`${item.mbid ?? item.title}-${index}`}>
              {href ? (
                <Link href={href} className="credit-page__item">
                  <Music2 aria-hidden="true" />
                  <span>
                    <strong>{item.title ?? "Untitled recording"}</strong>
                    <small>{[item.artist, item.albumTitle, item.role].filter(Boolean).join(" · ")}</small>
                  </span>
                </Link>
              ) : (
                <span className="credit-page__item credit-page__item--text">
                  <Music2 aria-hidden="true" />
                  <span><strong>{item.title ?? "Untitled recording"}</strong><small>{item.role ?? "Kept work"}</small></span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}