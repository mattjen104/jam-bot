import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Disc3 } from "lucide-react";
import { appendReturnState, readReturnState } from "../lib/returnState";
import { getDiscoverMyLabelReleasesQueryKey, useDiscoverMyLabelReleases } from "@workspace/api-client-react";

export default function Label() {
  const params = useParams();
  const [location] = useLocation();
  const labelId = params.labelId ?? params.id ?? "";
  const returnTo = readReturnState(window.location.search);
  const query = useDiscoverMyLabelReleases(labelId, {
    query: {
      queryKey: getDiscoverMyLabelReleasesQueryKey(labelId),
      enabled: Boolean(labelId),
      staleTime: 60_000,
      retry: false,
    },
  });
  const name = query.data?.labelName ?? "Verified label";
  return (
    <main className="credit-page">
      <Link href={returnTo ?? "/library"} className="credit-page__back">
        <ArrowLeft aria-hidden="true" /> Back to Library
      </Link>
      <header className="credit-page__header">
        <p className="credit-page__eyebrow">Kept label</p>
        <h1>{name}</h1>
        <p>Releases represented in your Library. Lore does not imply a complete label catalogue.</p>
      </header>
      {query.isLoading && <p className="credit-page__state">Loading kept releases…</p>}
      {query.isError && <p className="credit-page__state" role="alert">Kept label results are unavailable right now.</p>}
      {!query.isLoading && !query.isError && !(query.data?.releases?.length) && (
        <p className="credit-page__state">No kept releases have this verified label.</p>
      )}
      <ul className="credit-page__items">
        {(query.data?.releases ?? []).map((release, index) => {
          const href = release.releaseGroupMbid
            ? appendReturnState(`/album/${encodeURIComponent(release.releaseGroupMbid)}`, location)
            : null;
          const content = (
            <>
              <Disc3 aria-hidden="true" />
              <span>
                <strong>{release.title ?? "Untitled release"}</strong>
                    <small>{[release.releaseDate, release.catalogNumber].filter(Boolean).join(" · ")}</small>
              </span>
            </>
          );
          return <li key={`${release.releaseGroupMbid ?? release.title}-${index}`}>{href ? <Link href={href} className="credit-page__item">{content}</Link> : <span className="credit-page__item credit-page__item--text">{content}</span>}</li>;
        })}
      </ul>
    </main>
  );
}