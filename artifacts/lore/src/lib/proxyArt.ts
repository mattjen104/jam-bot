/**
 * Convert an external artwork URL (e.g. i.scdn.co) to the local art-proxy
 * path so the browser caches it after the first hit.
 *
 * The proxy endpoint (GET /api/art?src=…) fetches the image on the first
 * request, stores it in Object Storage, and responds with:
 *   Cache-Control: public, max-age=86400, stale-while-revalidate=604800
 *
 * The browser caches the cover for 1 day, then revalidates in the background
 * for up to 7 more days. When a recording's artwork changes the new cover
 * appears within one cache cycle without requiring a hard refresh.
 *
 * On a cache miss the proxy redirects to the original src, so nothing
 * breaks if Object Storage is unreachable.
 *
 * Rules:
 *   - null/undefined → null (no image)
 *   - already a local path ("/…") or data URI → pass through unchanged
 *   - external URL → /api/art?src=<encoded>
 */
export function proxyArtUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Local paths and data/blob URIs are served directly — no proxy needed.
  if (
    url.startsWith("/") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }
  return `/api/art?src=${encodeURIComponent(url)}`;
}
