import { safeHttpUrl } from "./utils";

/**
 * Use the station homepage's domain favicon as a lightweight identity fallback
 * when a station has no curated or Radio Browser logo. The returned URL still
 * goes through /api/art in StationMark, so the browser and server cache it.
 */
export function stationFaviconUrl(homepageUrl: string | null | undefined): string | null {
  const safe = safeHttpUrl(homepageUrl);
  if (!safe) return null;

  try {
    const homepage = new URL(safe);
    const domain = `${homepage.protocol}//${homepage.host}`;
    return `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(domain)}`;
  } catch {
    return null;
  }
}