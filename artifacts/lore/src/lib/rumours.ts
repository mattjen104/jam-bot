/**
 * Rumours by Fleetwood Mac — universal album art placeholder.
 * Used as both the initial fallback (when artworkUrl is null) and the
 * onError recovery (when an external CDN URL fails to load).
 *
 * Cover Art Archive: release-group 3e0b2fe7-c6d3-41a5-843a-73ffe5c6c57f
 */
export const RUMOURS =
  "https://coverartarchive.org/release-group/3e0b2fe7-c6d3-41a5-843a-73ffe5c6c57f/front-500";

/**
 * Maximum number of back-off retries before permanently locking in RUMOURS.
 * Retry 1: 2 s, Retry 2: 4 s.
 */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2_000;

/**
 * Substring that identifies an art-proxy URL (/api/art?src=…).
 * Retries are only scheduled for proxy URLs; direct CDN, data: and local
 * paths receive immediate RUMOURS with no retry.
 */
const PROXY_MARKER = "/api/art?src=";

/**
 * Strip the cache-busting _r=N parameter we append on retries, yielding the
 * canonical source URL.  The parameter is always appended last, so it is
 * either "?_r=N" (only param) or "&_r=N" (additional param).
 */
function stripRetryParam(src: string): string {
  return src.replace(/[?&]_r=\d+$/, "");
}

/**
 * Drop-in onError handler for album art images.
 *
 * Behaviour
 * ---------
 * 1. Shows the RUMOURS placeholder immediately so the listener always sees
 *    something (existing fall-back, relied upon by existing tests).
 * 2. For art-proxy URLs (/api/art?src=…), schedules up to MAX_RETRIES
 *    exponential back-off re-attempts.  When a retry succeeds the real cover
 *    replaces RUMOURS silently — no page reload required.
 * 3. Retry state is keyed to the canonical source URL stored in
 *    data-art-original-src.  If the same DOM element is reused with a
 *    different artwork source (common with React reconciliation), the stored
 *    URL is updated and the retry budget is reset to zero so the new cover
 *    gets its own independent retry window.
 * 4. Retries are skipped entirely for non-proxy sources (direct CDN, data:,
 *    local paths) — they receive immediate RUMOURS and no further attempts.
 * 5. Once all retries are exhausted, or if RUMOURS itself fails, the handler
 *    is a no-op so there is no infinite error loop.
 *
 * Back-off delays: 2 s → 4 s (jitter-free; suitable for proxy hiccups).
 */
export function onArtError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;

  // Guard: if we're already showing RUMOURS, bail — retrying would risk an
  // infinite error loop if RUMOURS itself is unreachable.
  if (img.src === RUMOURS) return;

  // Derive the canonical URL by stripping any _r=N retry param we added.
  const canonicalSrc = stripRetryParam(img.src);

  // If the canonical src has changed since the last error (same DOM element,
  // new artwork — common in React list updates), reset the retry budget so
  // the new cover gets an independent window of attempts.
  if (img.dataset.artOriginalSrc !== canonicalSrc) {
    img.dataset.artOriginalSrc = canonicalSrc;
    img.dataset.artRetries = "0";
  }

  // Show the placeholder immediately — existing behaviour preserved.
  img.src = RUMOURS;

  // Only schedule retries for art-proxy URLs.  Direct CDN links, data URIs,
  // and local paths get immediate RUMOURS without further attempts.
  if (!canonicalSrc.includes(PROXY_MARKER)) return;

  const retries = Number(img.dataset.artRetries ?? 0);
  if (retries >= MAX_RETRIES) return; // exhausted; stay on RUMOURS

  img.dataset.artRetries = String(retries + 1);

  // Exponential back-off: 2 s for retry 1, 4 s for retry 2.
  // The _r=N param ensures the browser re-fetches rather than serving the
  // cached error response.
  const delay = RETRY_BASE_MS * Math.pow(2, retries);
  // Capture the canonical URL in the closure so stale retries (from a
  // previously shown artwork on the same element) can self-discard.
  const retryForSrc = canonicalSrc;
  setTimeout(() => {
    // Skip if the src is no longer RUMOURS (navigated away, cover restored).
    if (img.src !== RUMOURS) return;
    // Skip if the element has since moved to a different artwork source —
    // that source's own retry will handle recovery.
    if (img.dataset.artOriginalSrc !== retryForSrc) return;
    const sep = retryForSrc.includes("?") ? "&" : "?";
    img.src = `${retryForSrc}${sep}_r=${retries + 1}`;
  }, delay);
}
