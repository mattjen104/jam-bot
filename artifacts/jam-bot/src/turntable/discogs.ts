import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Minimal Discogs client for pressing/label detail in the liner-notes card.
 *
 * MusicBrainz owns canonical credits; Discogs is the better source for the
 * *physical pressing* a vinyl audience cares about — label, release year,
 * country, and format. We do a single search by artist + track and take the
 * top release. This is approximate by nature (Discogs has no ISRC search), so
 * the result is always labeled as pressing-level context, not recording-exact.
 *
 * Token-gated (a personal access token from discogs.com/settings/developers)
 * and rate-limited behind a spacing gate. Discogs also requires a descriptive
 * User-Agent. Pure parser is exported for tests.
 */

const DISCOGS_BASE = "https://api.discogs.com";
const DISCOGS_MIN_INTERVAL_MS = 1100;
const DISCOGS_TIMEOUT_MS = 10_000;
const DISCOGS_UA = "JamBot/1.0 (+https://github.com/jam-bot)";

export interface DiscogsPressing {
  label?: string;
  year?: number;
  country?: string;
  format?: string;
}

/** Whether Discogs lookups are configured (a personal token is required). */
export function discogsEnabled(): boolean {
  return !!config.DISCOGS_TOKEN?.trim();
}

let discogsChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function discogsFetch(pathWithQuery: string): Promise<unknown> {
  const token = config.DISCOGS_TOKEN?.trim();
  if (!token) throw new Error("Discogs not configured");
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = `${DISCOGS_BASE}${pathWithQuery}${sep}token=${encodeURIComponent(token)}`;
  const run = discogsChain.then(async () => {
    await sleep(DISCOGS_MIN_INTERVAL_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": DISCOGS_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(DISCOGS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Discogs ${res.status} for ${pathWithQuery}`);
    return res.json();
  });
  discogsChain = run.catch(() => undefined);
  return run;
}

/** Pure: top release's pressing detail from a Discogs search body, or null. */
export function parseDiscogsSearch(body: unknown): DiscogsPressing | null {
  const b = body as {
    results?: Array<{
      year?: string | number;
      country?: string;
      label?: string[];
      format?: string[];
    }>;
  };
  const top = b?.results?.[0];
  if (!top) return null;
  const yearNum =
    typeof top.year === "number"
      ? top.year
      : top.year
        ? Number.parseInt(String(top.year), 10)
        : undefined;
  const pressing: DiscogsPressing = {
    label: top.label?.find((l) => !!l?.trim())?.trim(),
    year: Number.isFinite(yearNum) ? yearNum : undefined,
    country: top.country?.trim() || undefined,
    format: top.format?.filter((f) => !!f?.trim()).join(", ") || undefined,
  };
  // Nothing useful resolved — treat as a miss.
  if (
    !pressing.label &&
    pressing.year == null &&
    !pressing.country &&
    !pressing.format
  ) {
    return null;
  }
  return pressing;
}

/** Best-effort Discogs pressing lookup by artist + track. Never throws. */
export async function fetchDiscogsPressing(
  title: string,
  artist: string,
): Promise<DiscogsPressing | null> {
  if (!discogsEnabled()) return null;
  const t = title.trim();
  const a = artist.trim();
  if (!t && !a) return null;
  try {
    const q =
      `/database/search?type=release` +
      `&artist=${encodeURIComponent(a)}` +
      `&track=${encodeURIComponent(t)}`;
    const body = await discogsFetch(q);
    return parseDiscogsSearch(body);
  } catch (err) {
    logger.warn("Discogs lookup failed", {
      title,
      artist,
      error: String(err),
    });
    return null;
  }
}
