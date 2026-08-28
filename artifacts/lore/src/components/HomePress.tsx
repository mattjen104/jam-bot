import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import { Bookmark } from "lucide-react";
import { 
  useMyPressInfinite, 
  useMySavedPressInfinite, 
  useSavePressArticleAction, 
  useUnsavePressArticleAction 
} from "../lib/meHooks";
import type { PressArticle } from "@workspace/api-client-react";

function normalizePressText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function safePressImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Matched artist/work is useful when the headline does not identify the
 * listener's match. RSS headlines often do, though, so don't print the same
 * artist and work immediately above the title a second time.
 */
export function shouldShowPressMatch(article: Pick<PressArticle, "title" | "matchedArtist" | "matchedWork">): boolean {
  if (!article.matchedArtist) return false;

  const title = normalizePressText(article.title);
  const artist = normalizePressText(article.matchedArtist);
  if (!artist || !title.includes(artist)) return true;

  if (!article.matchedWork) return false;
  const work = normalizePressText(article.matchedWork);
  return !work || !title.includes(work);
}

export function PressArticleRow({
  article,
  onBookmark,
  onUnbookmark,
}: {
  article: PressArticle;
  onBookmark: (id: number) => Promise<unknown>;
  onUnbookmark: (id: number) => Promise<unknown>;
}) {
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const isSaved = optimisticSaved ?? article.saved;
  const imageUrl = safePressImageUrl(article.imageUrl);
  const showImage = imageUrl != null && imageUrl !== failedImageUrl;
  const publicationInitial = article.publication.trim().charAt(0).toUpperCase() || "L";

  const handleBookmark = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSaved) {
      setOptimisticSaved(false);
      try {
        await onUnbookmark(article.id);
      } catch {
        setOptimisticSaved(null);
      }
    } else {
      setOptimisticSaved(true);
      try {
        await onBookmark(article.id);
      } catch {
        setOptimisticSaved(null);
      }
    }
  }, [isSaved, article.id, onBookmark, onUnbookmark]);

  return (
    <div className="home-press__row" data-testid={`press-row-${article.id}`}>
      <div className="home-press__media" aria-hidden="true">
        {showImage ? (
          <img
            src={imageUrl}
            alt=""
            className="home-press__image"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedImageUrl(imageUrl)}
            data-testid={`press-image-${article.id}`}
          />
        ) : (
          <span
            className="home-press__image-fallback"
            data-testid={`press-image-fallback-${article.id}`}
          >
            {publicationInitial}
          </span>
        )}
      </div>
      <div className="home-press__content">
        {shouldShowPressMatch(article) && article.matchedArtist && (
          <span className="home-press__matched-artist">
            {article.matchedArtist} {article.matchedWork ? `· ${article.matchedWork}` : ""}
          </span>
        )}
        <a 
          href={article.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="home-press__title-link"
          data-testid={`press-link-${article.id}`}
        >
          <span className="home-press__title">{article.title}</span>
        </a>
        <div className="home-press__meta">
          {article.author && (
            <>
              <span className="home-press__author">By {article.author}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <Link href={`/archive/selectors/${article.handle}`} className="home-press__pub-link">
            {article.publication}
          </Link>
          {article.publishedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span className="home-press__date">
                {new Date(article.publishedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric"
                })}
              </span>
            </>
          )}
        </div>
        {article.excerpt && (
          <p className="home-press__excerpt">{article.excerpt}</p>
        )}
      </div>
      <button
        type="button"
        className={`home-press__bookmark${isSaved ? " home-press__bookmark--saved" : ""}`}
        onClick={handleBookmark}
        aria-label={isSaved ? "Remove bookmark" : "Bookmark article"}
        data-testid={`press-bookmark-${article.id}`}
      >
        <Bookmark aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

export function HomePress() {
  const pressQuery = useMyPressInfinite();
  const savedQuery = useMySavedPressInfinite();
  const saveMutation = useSavePressArticleAction();
  const unsaveMutation = useUnsavePressArticleAction();

  const handleBookmark = useCallback((id: number) => {
    return saveMutation.mutateAsync(id);
  }, [saveMutation]);

  const handleUnbookmark = useCallback((id: number) => {
    return unsaveMutation.mutateAsync(id);
  }, [unsaveMutation]);

  const allArticles = useMemo(
    () => pressQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [pressQuery.data]
  );
  
  const savedArticles = useMemo(
    () => savedQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [savedQuery.data]
  );

  const overlapArticles = useMemo(
    () => allArticles.filter(a => a.overlap),
    [allArticles]
  );
  
  const recentArticles = useMemo(
    () => allArticles.filter(a => !a.overlap),
    [allArticles]
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const savedSentinelRef = useRef<HTMLDivElement | null>(null);
  const hasObserver = typeof IntersectionObserver !== "undefined";

  useEffect(() => {
    if (!hasObserver) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (pressQuery.hasNextPage && !pressQuery.isFetchingNextPage) {
          void pressQuery.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, pressQuery]);

  useEffect(() => {
    if (!hasObserver) return;
    const el = savedSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (savedQuery.hasNextPage && !savedQuery.isFetchingNextPage) {
          void savedQuery.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, savedQuery]);

  if (pressQuery.isError) {
    return (
      <div className="home-press">
        <p className="home-discovery__empty">Couldn't load press articles right now.</p>
      </div>
    );
  }

  if (pressQuery.isLoading) {
    return (
      <div className="home-press">
        <p className="home-discovery__empty">Checking for articles…</p>
      </div>
    );
  }

  if (allArticles.length === 0) {
    return (
      <div className="home-press">
        <p className="home-discovery__empty">No press articles found yet.</p>
      </div>
    );
  }

  return (
    <div className="home-press">
      {overlapArticles.length > 0 && (
        <section className="home-discovery__section" aria-label="In your library">
          <div className="home-press__list">
            {overlapArticles.map((article) => (
              <PressArticleRow 
                key={article.id} 
                article={article} 
                onBookmark={handleBookmark}
                onUnbookmark={handleUnbookmark}
              />
            ))}
          </div>
        </section>
      )}

      {recentArticles.length > 0 && (
        <section className="home-discovery__section" aria-label="Recent press">
          <h2 className="home-discovery__heading">Recent press</h2>
          <div className="home-press__list">
            {recentArticles.map((article) => (
              <PressArticleRow 
                key={article.id} 
                article={article} 
                onBookmark={handleBookmark}
                onUnbookmark={handleUnbookmark}
              />
            ))}
          </div>
          
        </section>
      )}

      {pressQuery.hasNextPage && (
        <div
          ref={sentinelRef}
          className="dial-feed-sentinel"
          data-testid="press-pagination-sentinel"
          aria-hidden="true"
        />
      )}
      {!hasObserver && pressQuery.hasNextPage && (
        <button
          type="button"
          className="dial-filter-bar__btn"
          onClick={() => void pressQuery.fetchNextPage()}
          disabled={pressQuery.isFetchingNextPage}
          data-testid="press-load-more"
        >
          {pressQuery.isFetchingNextPage ? "Loading…" : "More press"}
        </button>
      )}

      <section className="home-discovery__section" aria-label="Saved links">
          <h2 className="home-discovery__heading">Saved links</h2>
          {savedQuery.isLoading ? (
            <p className="home-discovery__empty">Loading saved links…</p>
          ) : savedQuery.isError ? (
            <p className="home-discovery__empty">Couldn't load saved links.</p>
          ) : savedArticles.length === 0 ? (
            <p className="home-discovery__empty">No saved links yet.</p>
          ) : (
          <div className="home-press__saved-rail">
            {savedArticles.map((article) => (
              <a 
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="home-press__saved-card"
                data-testid={`press-saved-link-${article.id}`}
              >
                <div className="home-press__saved-title">{article.title}</div>
                <div className="home-press__saved-pub">{article.publication}</div>
              </a>
            ))}
          </div>
          )}
          {savedQuery.hasNextPage && (
            <div
              ref={savedSentinelRef}
              className="dial-feed-sentinel"
              data-testid="saved-press-pagination-sentinel"
              aria-hidden="true"
            />
          )}
          {!hasObserver && savedQuery.hasNextPage && (
            <button
              type="button"
              className="dial-filter-bar__btn"
              onClick={() => void savedQuery.fetchNextPage()}
              disabled={savedQuery.isFetchingNextPage}
              data-testid="saved-press-load-more"
            >
              {savedQuery.isFetchingNextPage ? "Loading…" : "More saved links"}
            </button>
          )}
        </section>
    </div>
  );
}
