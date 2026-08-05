/**
 * Convert an external artwork URL (e.g. i.scdn.co) to the local art-proxy
 * path so the browser caches it permanently after the first hit.
 *
 * The proxy endpoint (GET /api/art?src=…) fetches the image on the first
 * request, stores it in Object Storage, and responds with:
 *   Cache-Control: public, max-age=31536000, immutable
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
