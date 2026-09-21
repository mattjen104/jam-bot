import { Link, useParams, useSearch } from "wouter";
import { ArrowLeft, Disc3, Music2 } from "lucide-react";
import {
  getDiscoverCreditsQueryKey,
  getGetArtistQueryKey,
  useDiscoverCredits,
  useGetArtist,
} from "@workspace/api-client-react";
import { appendReturnState, readReturnState } from "../lib/returnState";
import { creditDiscoveryHref } from "../lib/creditPayload";

interface DiscoveryItem {
  creditKey: string;
  creditedName: string;
  role: string;
  roleGroup: string;
  recording: {
    mbid: string;
    title: string;
    primaryArtistMbid: string | null;
    primaryArtistName: string;
  };
  releaseGroups: Array<{
    mbid: string;
    title: string | null;
    year: number | null;
    isPrimary: boolean;
  }>;
  work: { mbid: string; title: string | null } | null;
  completeness: string;
}

type DiscoveryReleaseGroup = DiscoveryItem["releaseGroups"][number];
type ExpandedDiscoveryItem = DiscoveryItem & { releaseGroup: DiscoveryReleaseGroup | null };

function labelFor(filters: URLSearchParams, artistName?: string | null): string {
  const role = filters.get("role");
  const group = filters.get("roleGroup");
  const work = filters.get("workMbid");
  if (artistName && role) return `${artistName} · ${role}`;
  if (artistName && group) return `${artistName} · ${group}`;
  if (artistName) return artistName;
  if (role) return `${role} credits`;
  if (group) return `${group} credits`;
  if (work) return "Credits for this work";
  return "Verified credits";
}

export default function Credit() {
  const params = useParams();
  const search = useSearch();
  const query = new URLSearchParams(search);
  const pathArtistMbid = params.artistId ?? params.id ?? "";
  const artistMbid = pathArtistMbid || query.get("artistMbid") || undefined;
  const role = query.get("role") || undefined;
  const roleGroup = query.get("roleGroup") || undefined;
  const workMbid = query.get("workMbid") || undefined;
  const recordingMbid = query.get("recordingMbid") || undefined;
  const releaseGroupMbid = query.get("releaseGroupMbid") || undefined;
  const labelMbid = query.get("labelMbid") || undefined;
  const cursor = query.get("cursor") || undefined;
  const otherArtists = query.get("otherArtists") === "true" || undefined;
  const returnTo = readReturnState(window.location.search);
  const filters = {
    artistMbid,
    role,
    roleGroup,
    workMbid,
    recordingMbid,
    releaseGroupMbid,
    labelMbid,
    otherArtists,
    cursor,
    limit: 30,
  };
  const hasFilter = Boolean(
    artistMbid || role || roleGroup || workMbid || recordingMbid || releaseGroupMbid || labelMbid,
  );
  const discovery = useDiscoverCredits(filters, {
    query: {
      queryKey: getDiscoverCreditsQueryKey(filters),
      enabled: hasFilter,
      staleTime: 60_000,
      retry: false,
    },
  });
  const artist = useGetArtist(artistMbid ?? "", {
    query: {
      queryKey: getGetArtistQueryKey(artistMbid ?? ""),
      enabled: Boolean(artistMbid),
      staleTime: 60_000,
      retry: false,
    },
  });
  const data = discovery.data;
  const items = (data?.items ?? []) as unknown as DiscoveryItem[];
  const artistName = artist.data?.name ?? (artistMbid ? items[0]?.creditedName : null);
  const title = labelFor(query, artistName);
  const backHref = returnTo ?? "/library";
  const discoveryReturnHref = `${window.location.pathname}${window.location.search}`;
  const expandedItems = items.flatMap<ExpandedDiscoveryItem>((item) =>
    item.releaseGroups.length
      ? item.releaseGroups.map((releaseGroup) => ({ ...item, releaseGroup }))
      : [{ ...item, releaseGroup: null }],
  );
  const grouped = [...expandedItems.reduce<Map<string, {
    releaseGroup: DiscoveryReleaseGroup | null;
    items: ExpandedDiscoveryItem[];
  }>>((albums, item) => {
    const key = item.releaseGroup?.mbid ?? `recording:${item.recording.mbid}`;
    const existing = albums.get(key);
    if (existing) existing.items.push(item);
    else albums.set(key, { releaseGroup: item.releaseGroup, items: [item] });
    return albums;
  }, new Map()).values()];

  const currentFilters = {
    artistMbid,
    role,
    roleGroup,
    workMbid,
    recordingMbid,
    releaseGroupMbid,
    labelMbid,
    otherArtists,
  };
  const filterHref = (overrides: {
    artistMbid?: string | null;
    role?: string | null;
    roleGroup?: string | null;
    workMbid?: string | null;
    recordingMbid?: string | null;
    releaseGroupMbid?: string | null;
    labelMbid?: string | null;
    otherArtists?: boolean;
  }) => appendReturnState(creditDiscoveryHref({ ...currentFilters, ...overrides }), returnTo);

  return (
    <main className="credit-page">
      <Link href={backHref} className="credit-page__back">
        <ArrowLeft aria-hidden="true" /> Back
      </Link>
      <header className="credit-page__header">
        <p className="credit-page__eyebrow">Lore credit paths</p>
        <h1>{title}</h1>
        <p>{data?.coverage.copy ?? "Verified relationships already indexed by Lore."}</p>
        {artistMbid && (
          <div className="credit-page__filters" aria-label="Credit filters">
            <Link href={filterHref({ role: null, roleGroup: null })} className="credit-page__filter">All roles</Link>
            {otherArtists ? (
              <Link href={filterHref({ otherArtists: false })} className="credit-page__filter">
                Include primary-artist recordings
              </Link>
            ) : (
              <Link
                href={filterHref({ otherArtists: true })}
                className="credit-page__filter"
              >
                Other artists only
              </Link>
            )}
            <Link
              href={appendReturnState(`/artist/${encodeURIComponent(artistMbid)}`, discoveryReturnHref)}
              className="credit-page__filter"
            >
              Artist context
            </Link>
          </div>
        )}
      </header>

      {!hasFilter && (
        <p className="credit-page__state">
          Follow a verified person, role, category, work, label, recording, or album credit to begin.
        </p>
      )}
      {discovery.isLoading && <p className="credit-page__state">Loading verified credits…</p>}
      {discovery.isError && (
        <p className="credit-page__state" role="alert">Credit results are unavailable right now.</p>
      )}
      {!discovery.isLoading && hasFilter && items.length === 0 && (
        <p className="credit-page__state">
          Lore has no matching verified relationships in its indexed corpus yet.
        </p>
      )}

      {grouped.map((group) => (
        <section
          key={group.releaseGroup?.mbid ?? group.items[0].recording.mbid}
          className="credit-page__album"
          aria-labelledby={`credit-album-${group.releaseGroup?.mbid ?? group.items[0].recording.mbid}`}
        >
          <h2 id={`credit-album-${group.releaseGroup?.mbid ?? group.items[0].recording.mbid}`}>
            {group.releaseGroup ? (
              <Link
                href={appendReturnState(
                  `/album/${encodeURIComponent(group.releaseGroup.mbid)}?track=${encodeURIComponent(group.items[0].recording.mbid)}`,
                   discoveryReturnHref,
                )}
              >
                {group.releaseGroup.title ?? "Untitled album"}
              </Link>
            ) : "Recordings without a canonical album"}
          </h2>
          {group.releaseGroup?.year != null && <p>{group.releaseGroup.year}</p>}
          <ul className="credit-page__items">
            {group.items.map((item) => (
              <li key={item.creditKey}>
                <div className="credit-page__item">
                  {group.releaseGroup ? <Disc3 aria-hidden="true" /> : <Music2 aria-hidden="true" />}
                  <span>
                    <strong>
                      <Link
                        href={appendReturnState(
                          group.releaseGroup
                            ? `/album/${encodeURIComponent(group.releaseGroup.mbid)}?track=${encodeURIComponent(item.recording.mbid)}`
                            : `/song/${encodeURIComponent(item.recording.mbid)}`,
                           discoveryReturnHref,
                        )}
                      >
                        {item.recording.title}
                      </Link>
                    </strong>
                    <small>
                      {item.recording.primaryArtistMbid ? (
                        <Link
                          href={appendReturnState(
                            `/artist/${encodeURIComponent(item.recording.primaryArtistMbid)}`,
                             discoveryReturnHref,
                          )}
                        >
                          {item.recording.primaryArtistName}
                        </Link>
                      ) : item.recording.primaryArtistName}
                       {" · "}
                       {[item.creditedName, item.role, item.work?.title].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                </div>
                <div className="credit-page__facets">
                  <Link
                    href={filterHref({ role: item.role, roleGroup: null })}
                    aria-label={`Explore ${item.role} credits`}
                  >
                    {item.role}
                  </Link>
                  <Link
                    href={filterHref({ role: null, roleGroup: item.roleGroup })}
                    aria-label={`Explore ${item.roleGroup} credits`}
                  >
                    {item.roleGroup}
                  </Link>
                  {item.work?.mbid && (
                    <Link href={filterHref({ workMbid: item.work.mbid })}>
                      {item.work.title ?? "Associated work"}
                    </Link>
                  )}
                  {item.completeness !== "complete" && <span>Partial coverage</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data?.nextCursor && (
        <Link
          className="credit-page__more"
          href={appendReturnState(
            `${creditDiscoveryHref({ artistMbid, role, roleGroup, workMbid, recordingMbid, releaseGroupMbid, labelMbid, otherArtists })}&cursor=${encodeURIComponent(data.nextCursor)}`,
            returnTo,
          )}
        >
          Next verified results
        </Link>
      )}
    </main>
  );
}