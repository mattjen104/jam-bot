import { config } from "./config.js";
import { logger } from "./logger.js";

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

/** One entry in a public Discogs list — a collector's catalogued item. */
export interface DiscogsListItem {
  /** Discogs item id (release/master), used for idempotent dedup. */
  id: string;
  /** "Artist - Title" as Discogs renders it; parsed downstream. */
  displayTitle: string;
  /** Public Discogs URL for the item (the link-out we store). */
  url?: string;
  /** The collector's own note on the item, when present. */
  comment?: string;
}

export interface DiscogsList {
  name?: string;
  items: DiscogsListItem[];
}

/** Pure: flatten a Discogs `/lists/{id}` body into a DiscogsList. */
export function parseDiscogsList(body: unknown): DiscogsList {
  const b = body as {
    name?: string;
    items?: Array<{
      id?: string | number;
      display_title?: string;
      uri?: string;
      resource_url?: string;
      comment?: string;
    }>;
  };
  const items: DiscogsListItem[] = [];
  for (const it of b?.items ?? []) {
    const id = it?.id != null ? String(it.id) : undefined;
    const displayTitle = it?.display_title?.trim();
    if (!id || !displayTitle) continue;
    items.push({
      id,
      displayTitle,
      ...(it.uri?.trim() ? { url: it.uri.trim() } : {}),
      ...(it.comment?.trim() ? { comment: it.comment.trim() } : {}),
    });
  }
  return { name: b?.name?.trim() || undefined, items };
}

/** Fetch a public Discogs list's items. Best-effort — never throws. */
export async function fetchDiscogsList(
  listId: string,
): Promise<DiscogsList | null> {
  if (!discogsEnabled() || !listId.trim()) return null;
  try {
    const body = await discogsFetch(`/lists/${encodeURIComponent(listId.trim())}`);
    return parseDiscogsList(body);
  } catch (err) {
    logger.warn("Discogs list lookup failed", { listId, error: String(err) });
    return null;
  }
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
