/**
 * PressFeedLane — the Dial's Press lens feed.
 *
 * Renders retained publisher-owned RSS articles through the same row anatomy
 * as the home Press lens. Every article stays source-directed and bookmarkable.
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
import { useRef, useEffect, useState, useCallback } from "react";
import type { PressArticle } from "@workspace/api-client-react";
import { PressArticleRow } from "../HomePress";
import { useSavePressArticleAction, useUnsavePressArticleAction } from "../../lib/meHooks";

export interface PressFeedLaneProps {
  items: PressArticle[];
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
  hasTaste: _hasTaste,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onArtistClick: _onArtistClick,
}: PressFeedLaneProps) {
  const [visible, setVisible] = useState(PRESS_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const shown = hasObserver ? items.slice(0, visible) : items;
  const exhaustedLocal = visible >= items.length;

  const saveMutation = useSavePressArticleAction();
  const unsaveMutation = useUnsavePressArticleAction();

  const handleBookmark = useCallback((id: number) => {
    return saveMutation.mutateAsync(id);
  }, [saveMutation]);

  const handleUnbookmark = useCallback((id: number) => {
    return unsaveMutation.mutateAsync(id);
  }, [unsaveMutation]);

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
  if (isFailed && items.length === 0) {
    return (
      <div className="z1-placeholder z1-placeholder--cross-error">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            We couldn't check the press right now. We'll keep trying — check back in a moment.
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
            Checking the press…
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
            No press articles have arrived yet. Check back as the feeds fill in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div id="press-feed-rows" className="home-press__list">
      {shown.map((m) => (
        <PressArticleRow
          key={m.id}
          article={m}
          onBookmark={handleBookmark}
          onUnbookmark={handleUnbookmark}
        />
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
          data-testid="press-load-more"
        >
          More
        </button>
      )}
    </div>
  );
}
