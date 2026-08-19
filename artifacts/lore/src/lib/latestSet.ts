/**
 * Latest-set read models — plain-JSON fetches against the /api/player read
 * model (no orval). Backs the "Last set" affordance on dial rows and the
 * set scanner sheet.
 */

export interface LastSetSummary {
  runId: number;
  /** UTC broadcast day, YYYY-MM-DD. */
  date: string;
  show: { name: string; djName: string | null } | null;
  spinCount: number;
  resolvedCount: number;
  startedAt: string;
  endedAt: string;
}

export interface LastSetTrack {
  /** Spin DB id — feeds the pending-keep flow for unresolved tracks. */
  spinId: number;
  position: number;
  playedAt: string;
  artist: string;
  title: string;
  mbid: string | null;
  artworkUrl: string | null;
}

export interface LatestSet {
  station: { slug: string; name: string };
  run: LastSetSummary;
  tracks: LastSetTrack[];
}

/**
 * Latest-completed-set summaries for a batch of station slugs (one dial
 * page). A slug maps to null when the station has no completed set; a slug
 * ABSENT from the map means the fetch failed — callers treat that as
 * "unknown", never as "no set".
 */
export async function fetchLatestSetSummaries(
  slugs: string[],
): Promise<Record<string, LastSetSummary | null>> {
  if (slugs.length === 0) return {};
  // Best-effort: summaries only enrich the affordance label, so any failure
  // (offline, test env without a base URL) degrades to a plain "Last set".
  try {
    const res = await fetch(
      `/api/player/latest-sets?slugs=${encodeURIComponent(slugs.join(","))}`,
    );
    if (!res.ok) return {};
    const body = (await res.json()) as { items?: Record<string, LastSetSummary | null> };
    return body.items ?? {};
  } catch {
    return {};
  }
}

/**
 * The full latest-set tracklist for the scanner. Null when the station has
 * no completed set (404). Throws on other failures so the scanner can show
 * an honest error rather than an empty set.
 */
export async function fetchLatestSet(
  slug: string,
  signal?: AbortSignal,
): Promise<LatestSet | null> {
  const res = await fetch(
    `/api/player/stations/${encodeURIComponent(slug)}/latest-set`,
    { signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`latest-set ${res.status}`);
  return (await res.json()) as LatestSet;
}

/**
 * Compact hour range for the affordance label: "3–5pm", "11pm–1am".
 * Listener-local time. Empty string when either timestamp is unusable.
 */
export function formatSetHours(startedAt: string, endedAt: string): string {
  const s = new Date(startedAt);
  const e = new Date(endedAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  const sH = s.getHours();
  const eH = e.getHours();
  const sAp = sH < 12 ? "am" : "pm";
  const eAp = eH < 12 ? "am" : "pm";
  const s12 = sH % 12 || 12;
  const e12 = eH % 12 || 12;
  return sAp === eAp ? `${s12}–${e12}${eAp}` : `${s12}${sAp}–${e12}${eAp}`;
}
