/**
 * CompactStack — the bottom band of the SplitHome layout.
 *
 * Shows the 5 newest kept album groups from the listener's combined
 * kept + Spotify-imported library (first page of useMyLibraryInfinite,
 * grouped with buildAlbumGroups). Each collapsed row is a single line —
 * `album title · artist · <relationship credit>` — over a full-bleed
 * cassette-spine strip (blurred/darkened album art). The third segment is
 * the album's MusicBrainz relationship line (samples / covers / remixes),
 * the most crucial piece of liner-note metadata, omitted cleanly when the
 * knowledge layer has none.
 *
 * Tapping a row expands it in place: the album moves to the top slot and
 * its liner-notes metadata (pressing, credits, relationships, claims,
 * books) fills the band as individual card rows, covering the other four
 * rows. A `→ Stack` link jumps to the album in the full Stack. Tapping the
 * expanded header collapses back to the five-row list.
 *
 * Albums imported without artwork fall back to the Cover Art Archive
 * release-group front image derived from the recording's releaseGroupMbid.
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, ExternalLink } from "lucide-react";
import {
  getRecordingKnowledge,
  getGetRecordingKnowledgeQueryKey,
  type TrackKnowledge,
  type TrackClaim,
} from "@workspace/api-client-react";
import { useMyLibraryInfinite } from "../lib/meHooks";
import { buildAlbumGroups, type AlbumGroup } from "../pages/Library";
import { buildLinerGroups, type LinerGroup } from "../lib/linerNotes";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

const COMPACT_STACK_SIZE = 5;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * The inline relationship credit for a collapsed row: the first typed
 * MusicBrainz song relationship, rendered exactly like the liner-notes
 * RELATIONSHIPS row ("samples — Title (Artist)"). Null when the knowledge
 * layer has none — the row then degrades to `album · artist`.
 */
export function relationshipCredit(
  knowledge: TrackKnowledge | null | undefined,
): string | null {
  const rel = knowledge?.relationships?.[0];
  if (!rel) return null;
  return rel.title
    ? `${rel.label} — ${rel.title}${rel.artist ? ` (${rel.artist})` : ""}`
    : rel.label;
}

/**
 * Spine artwork for a group: the group's own artwork when present,
 * otherwise the Cover Art Archive release-group front image derived from
 * the newest item that carries a releaseGroupMbid (imports whose art was
 * never resolved). Null when neither exists.
 */
export function spineArtUrl(group: AlbumGroup): string | null {
  if (group.artworkUrl) return group.artworkUrl;
  for (const item of group.items) {
    const rg = item.recording?.releaseGroupMbid;
    if (rg) return `https://coverartarchive.org/release-group/${rg}/front-500`;
  }
  return null;
}

/** Reorder so the expanded group leads; identity when nothing is expanded. */
export function orderForExpansion(
  groups: AlbumGroup[],
  expandedKey: string | null,
): AlbumGroup[] {
  if (!expandedKey) return groups;
  const idx = groups.findIndex((g) => g.key === expandedKey);
  if (idx <= 0) return groups;
  return [groups[idx], ...groups.slice(0, idx), ...groups.slice(idx + 1)];
}

/** Newest resolved recording MBID in a group, for the collapsed credit. */
export function primaryMbid(group: AlbumGroup): string | null {
  return group.items.find((i) => i.mbid !== null)?.mbid ?? null;
}

/** All distinct resolved MBIDs in a group, for the expanded metadata. */
export function groupMbids(group: AlbumGroup): string[] {
  return [
    ...new Set(
      group.items.map((i) => i.mbid).filter((m): m is string => m !== null),
    ),
  ];
}

/**
 * Merge per-recording knowledge + claims into one set of liner groups for
 * the album: the richest knowledge wins (most relationships + personnel),
 * claims are aggregated across recordings and deduped by text.
 */
export function buildAlbumLinerGroups(
  results: Array<{ knowledge: TrackKnowledge | null; claims: TrackClaim[] }>,
): LinerGroup[] {
  let best: TrackKnowledge | null = null;
  let bestScore = -1;
  for (const r of results) {
    if (!r.knowledge) continue;
    const score =
      (r.knowledge.personnel?.length ?? 0) +
      (r.knowledge.relationships?.length ?? 0) +
      (r.knowledge.pressing ? 1 : 0);
    if (score > bestScore) {
      best = r.knowledge;
      bestScore = score;
    }
  }
  const seen = new Set<string>();
  const claims: TrackClaim[] = [];
  for (const r of results) {
    for (const c of r.claims) {
      if (seen.has(c.text)) continue;
      seen.add(c.text);
      claims.push(c);
    }
  }
  return buildLinerGroups(best, claims);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompactStack() {
  const [, setLocation] = useLocation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { data, isLoading } = useMyLibraryInfinite({}, 100);

  const groups = useMemo<AlbumGroup[]>(() => {
    const items = data?.pages[0]?.items ?? [];
    return buildAlbumGroups(items).slice(0, COMPACT_STACK_SIZE);
  }, [data]);

  const expandedGroup = expandedKey
    ? (groups.find((g) => g.key === expandedKey) ?? null)
    : null;
  const ordered = useMemo(
    () => orderForExpansion(groups, expandedKey),
    [groups, expandedKey],
  );

  // Knowledge for the collapsed inline credit — one query per album (its
  // newest resolved recording). Cached under the same key the liner-notes
  // sheet uses, so no duplicate fetches.
  const creditMbids = useMemo(
    () =>
      groups
        .map((g) => primaryMbid(g))
        .filter((m): m is string => m !== null),
    [groups],
  );
  const creditResults = useQueries({
    queries: creditMbids.map((mbid) => ({
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      queryFn: () => getRecordingKnowledge(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    })),
  });
  const knowledgeByMbid = new Map<string, TrackKnowledge | null>();
  creditMbids.forEach((mbid, i) => {
    knowledgeByMbid.set(mbid, creditResults[i]?.data?.knowledge ?? null);
  });

  // Expanded album: fetch every resolved recording so claims from all kept
  // tracks on the album are aggregated (same pattern as the investigation
  // sheet).
  const expandedMbids = useMemo(
    () => (expandedGroup ? groupMbids(expandedGroup) : []),
    [expandedGroup],
  );
  const expandedResults = useQueries({
    queries: expandedMbids.map((mbid) => ({
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      queryFn: () => getRecordingKnowledge(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    })),
  });
  const expandedLoading = expandedResults.some((r) => r.isLoading);
  const linerGroups = expandedGroup
    ? buildAlbumLinerGroups(
        expandedResults
          .map((r) => r.data)
          .filter((d): d is NonNullable<typeof d> => d != null)
          .map((d) => ({ knowledge: d.knowledge ?? null, claims: d.claims ?? [] })),
      )
    : [];

  const renderSpine = (group: AlbumGroup) => {
    const art = proxyArtUrl(spineArtUrl(group));
    return (
      <>
        {/* Cassette-spine background: blurred/darkened album art.
            An <img> (not background-image) so onArtError retry/fallback
            works; the overlay div keeps the text legible. */}
        {art && (
          <img
            className="compact-stack__spine-art"
            src={art}
            alt=""
            aria-hidden="true"
            loading="lazy"
            onError={onArtError}
          />
        )}
        <div className="compact-stack__overlay" aria-hidden="true" />
      </>
    );
  };

  // ── Expanded: header row + metadata cards covering the other rows ──────
  if (expandedGroup) {
    const stackHref = `/library?openAlbum=${encodeURIComponent(expandedGroup.key)}`;
    return (
      <div className="compact-stack compact-stack--expanded" aria-label="Recent keeps">
        <button
          type="button"
          className="compact-stack__row compact-stack__row--expanded-header"
          aria-expanded="true"
          aria-label={`Collapse ${expandedGroup.albumTitle}`}
          onClick={() => setExpandedKey(null)}
        >
          {renderSpine(expandedGroup)}
          <span className="compact-stack__text">
            <span className="compact-stack__album">{expandedGroup.albumTitle}</span>
            {expandedGroup.artist && (
              <>
                <span className="compact-stack__sep" aria-hidden="true">·</span>
                <span className="compact-stack__artist">{expandedGroup.artist}</span>
              </>
            )}
          </span>
        </button>
        <div className="compact-stack__cards" role="region" aria-label={`${expandedGroup.albumTitle} liner notes`}>
          {expandedLoading ? (
            <div className="compact-stack__card compact-stack__card--muted">
              Reading the liner notes…
            </div>
          ) : linerGroups.length > 0 ? (
            linerGroups.map((group) =>
              group.rows.map((row) => (
                <div key={`${group.label}-${row.id}`} className="compact-stack__card">
                  <span className="compact-stack__card-kind">{group.label}</span>
                  <span className="compact-stack__card-text">
                    {row.label && (
                      <span className="compact-stack__card-label">{row.label} </span>
                    )}
                    {row.text}
                  </span>
                  {row.sourceLabel && (
                    <span className="compact-stack__card-source">{row.sourceLabel}</span>
                  )}
                  {row.sourceUrl && (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="compact-stack__card-link"
                      aria-label={`Open source for ${row.text.slice(0, 40)}`}
                    >
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                </div>
              )),
            )
          ) : (
            <div className="compact-stack__card compact-stack__card--muted">
              No liner notes available for this album yet.
            </div>
          )}
          <button
            type="button"
            className="compact-stack__card compact-stack__card--stack-link"
            onClick={() => setLocation(stackHref)}
          >
            <ArrowRight aria-hidden="true" />
            <span>Stack</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Collapsed: five single-line rows ────────────────────────────────────
  return (
    <div className="compact-stack" aria-label="Recent keeps">
      {ordered.map((group) => {
        const mbid = primaryMbid(group);
        const credit = mbid ? relationshipCredit(knowledgeByMbid.get(mbid)) : null;
        const label = group.artist
          ? `${group.albumTitle} · ${group.artist}`
          : group.albumTitle;
        return (
          <button
            key={group.key}
            type="button"
            className="compact-stack__row"
            aria-expanded="false"
            aria-label={`Expand ${label}`}
            onClick={() => setExpandedKey(group.key)}
          >
            {renderSpine(group)}
            <span className="compact-stack__text">
              <span className="compact-stack__album">{group.albumTitle}</span>
              {group.artist && (
                <>
                  <span className="compact-stack__sep" aria-hidden="true">·</span>
                  <span className="compact-stack__artist">{group.artist}</span>
                </>
              )}
              {credit && (
                <>
                  <span className="compact-stack__sep" aria-hidden="true">·</span>
                  <span className="compact-stack__credit">{credit}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
      {!isLoading && groups.length === 0 && (
        <button
          type="button"
          className="compact-stack__empty"
          onClick={() => setLocation("/library")}
        >
          Nothing kept yet — your Stack starts with the first track you keep.
        </button>
      )}
    </div>
  );
}
