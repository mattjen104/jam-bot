import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Music2 } from "lucide-react";
import { appendReturnState, readReturnState } from "../lib/returnState";
import {
  getDiscoverMyCreditedArtistQueryKey,
  getGetArtistQueryKey,
  useDiscoverMyCreditedArtist,
  useGetArtist,
} from "@workspace/api-client-react";

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
  const publicArtist = useGetArtist(artistId, {
    query: {
      queryKey: getGetArtistQueryKey(artistId),
      enabled: Boolean(artistId),
      staleTime: 60_000,
      retry: false,
    },
  });
  const publicData = publicArtist.data as (typeof publicArtist.data & {
    creditedAlbums?: Array<{
      releaseGroupMbid: string;
      title: string | null;
      releaseYear: number | null;
      href: string;
    }>;
    creditBacklinks?: Array<{
      recordingMbid: string;
      trackTitle: string;
      role: string;
      roleGroup: string;
      albumTitle: string | null;
      albumYear: number | null;
      albumHref: string;
    }>;
  }) | undefined;
  const items = data?.songs ?? [];
  const name = publicData?.name ?? items[0]?.creditedName ?? "Verified credit";
  const creditedAlbums = publicData?.creditedAlbums ?? [];
  const publicBacklinks = publicData?.creditBacklinks ?? [];
  const backHref = returnTo ?? "/library";

  return (
    <main className="credit-page">
      <Link href={backHref} className="credit-page__back">
        <ArrowLeft aria-hidden="true" /> Back to Library
      </Link>
      <header className="credit-page__header">
        <p className="credit-page__eyebrow">Kept credits</p>
        <h1>{name}</h1>
        <p>Verified album and track roles known to Lore. This is not a complete discography.</p>
        <Link href={appendReturnState(`/artist/${encodeURIComponent(artistId)}`, location)} className="credit-page__context-link">
          Open artist context →
        </Link>
      </header>
      {isLoading && <p className="credit-page__state">Loading kept work…</p>}
      {isError && <p className="credit-page__state" role="alert">Kept credit results are unavailable right now.</p>}
      {!isLoading && items.length === 0 && publicBacklinks.length === 0 && !publicArtist.isLoading && (
        <p className="credit-page__state">Lore has an identity for this person, but no linked album or track credits yet.</p>
      )}
      {creditedAlbums.length > 0 && (
        <section aria-labelledby="credited-albums-heading">
          <h2 id="credited-albums-heading" className="credit-page__eyebrow">Albums containing credited tracks</h2>
          <ul className="credit-page__items">
            {creditedAlbums.map((album) => (
              <li key={album.releaseGroupMbid}>
                <Link
                  href={appendReturnState(album.href, location)}
                  className="credit-page__item"
                  data-testid={`link-credit-album-${album.releaseGroupMbid}`}
                >
                  <Music2 aria-hidden="true" />
                  <span>
                    <strong>{album.title ?? "Untitled album"}</strong>
                    <small>{album.releaseYear ?? "Release year unknown"}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {publicBacklinks.length > 0 && (
        <section aria-labelledby="credited-tracks-heading">
          <h2 id="credited-tracks-heading" className="credit-page__eyebrow">Track credits</h2>
          <ul className="credit-page__items">
            {publicBacklinks.map((item, index) => (
              <li key={`${item.recordingMbid}-${item.role}-${index}`}>
                <Link
                  href={appendReturnState(`/song/${encodeURIComponent(item.recordingMbid)}`, location)}
                  className="credit-page__item"
                  data-testid={`link-credit-track-${item.recordingMbid}-${index}`}
                >
                  <Music2 aria-hidden="true" />
                  <span>
                    <strong>{item.trackTitle}</strong>
                    <small>{[item.albumTitle, item.albumYear, item.role].filter(Boolean).join(" · ")}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {items.length > 0 && <h2 className="credit-page__eyebrow">In your Library</h2>}
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