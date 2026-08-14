/**
 * PressFeedLane — the Dial's Press lens feed.
 *
 * Renders scraped-metadata mentions of the listener's taste set (blog picks,
 * year-end / best-of list entries, published track claims), newest-first,
 * through the same row anatomy as the live feed: primary sentence leads at
 * full weight (`fdrow__t1`), the source byline sits underneath (`fdrow__t3`),
 * dotted links navigate.
 *
 * Honest empty states:
 *   - No taste (empty Stack, no seeds)     → nudge to seed taste (from caller)
 *   - Taste but no mentions, settled       → "no press yet"
 *   - Still computing / failed             → in-progress / error copy
 *
 * Pagination mirrors the live feed: infinite scroll via IntersectionObserver
 * sentinel over already-fetched pages, plus fetchNextPage when the server has
 * a next cursor. jsdom (no IntersectionObserver) renders everything.
 */
import { useRef, useEffect, useState } from "react";
import { type PressMentionItem } from "../../lib/meHooks";
import { pressSentence } from "../dialViewHelpers";

export interface PressFeedLaneProps {
  items: PressMentionItem[];
  /** True while the first page is still loading or the server reports computing. */
  isLoading: boolean;
  /** True when the server compute crashed — show "couldn't check" copy. */
  isFailed: boolean;
  /** False when the listener has no taste sources at all — caller shows nudge. */
  hasTaste: boolean;
  /** True when a further page exists server-side. */
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Navigate to the artist page/tab — same affordance as other crossing rows. */
  onArtistClick: (artistName: string) => void;
}

/** Rows revealed per scroll step (matches the live feed's initial page). */
const PRESS_PAGE = 12;

export function PressFeedLane({
  items,
  isLoading,
  isFailed,
  hasTaste,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onArtistClick,
}: PressFeedLaneProps) {
  const [visible, setVisible] = useState(PRESS_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const shown = hasObserver ? items.slice(0, visible) : items;
  const exhaustedLocal = visible >= items.length;

  useEffect(() => {
    if (!hasObserver) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisible((v) => v + PRESS_PAGE);
        // When local pages run out and the server has more, pull the next page.
        if (exhaustedLocal && hasNextPage && !isFetchingNextPage) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, exhaustedLocal, hasNextPage, isFetchingNextPage, onLoadMore]);

  // ── Empty / degraded states — settled-gated by the caller's flags ────────
  if (!hasTaste) return null; // caller renders the taste nudge

  if (isFailed && items.length === 0) {
    return (
      <div className="z1-placeholder z1-placeholder--cross-error">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            We couldn't check the press for your artists right now. We'll keep trying — check back in a moment.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div className="z1-placeholder z1-placeholder--computing">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            Checking the press for your artists…
          </p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    // Genuinely settled and empty — only reachable when not loading/failed.
    return (
      <div className="z1-placeholder z1-placeholder--no-cross z1-placeholder--compact">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            No press for your artists yet — no list entries, blog picks, or liner
            claims match your Stack so far. Check back as the shelves fill in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div id="press-feed-rows">
      {shown.map((m) => (
        <PressRow key={m.id} mention={m} onArtistClick={onArtistClick} />
      ))}
      {(!exhaustedLocal || hasNextPage) && (
        <div ref={sentinelRef} className="dial-feed-sentinel" aria-hidden="true" />
      )}
      {!hasObserver && hasNextPage && (
        <button
          type="button"
          className="dial-filter-bar__btn"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
        >
          More
        </button>
      )}
    </div>
  );
}

function PressRow({
  mention,
  onArtistClick,
}: {
  mention: PressMentionItem;
  onArtistClick: (artistName: string) => void;
}) {
  const sentence = pressSentence(mention);
  if (sentence == null) return null;
  const artist = mention.artistName;
  return (
    <div className="fdrow fdrow--z1" data-press-kind={mention.kind}>
      <div className="fdrow__c">
        {/* Tier 1: the Press sentence — artist leads, source is the verb object */}
        <div className="fdrow__t1 w3">
          {artist ? (
            <button
              type="button"
              className="fdrow__artist-link"
              onClick={() => onArtistClick(artist)}
              aria-label={`Open ${artist}`}
            >
              {sentence}
            </button>
          ) : (
            sentence
          )}
        </div>
        {/* Tier 3: source byline — the external link lives here, dotted = navigates */}
        <div className="fdrow__t3">
          {mention.sourceUrl ? (
            <a
              href={mention.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="fdrow__source-link"
              onClick={(e) => e.stopPropagation()}
            >
              {mention.sourceLabel} ↗
            </a>
          ) : (
            mention.sourceLabel
          )}
        </div>
      </div>
    </div>
  );
}
