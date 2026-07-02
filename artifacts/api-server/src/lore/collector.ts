import { fetchDiscogsList } from "@workspace/song-enrichment";
import { upsertPicker, persistPick } from "./picks.js";
import { extractArtistTrack } from "./blog.js";

/**
 * Collector sources. Two flavours, per the source policy:
 *   - Discogs: API-only. We read a public list via the Discogs API and log a
 *     pick per catalogued item (source='discogs_list', trust_tier=3), resolving
 *     "Artist - Title" to the spine where we can and logging it unresolved
 *     otherwise (a collector's catalogue is signal even before it resolves).
 *   - RYM (RateYourMusic): link-out ONLY. RYM forbids scraping, so we never
 *     ingest items — we only register the picker with a link out to the list,
 *     so the entry flow can point a listener at it without touching their site.
 */

/** Public Discogs list URL for a given list id. */
export function discogsListUrl(listId: string): string {
  return `https://www.discogs.com/lists/${listId}`;
}

export interface CollectorIngestResult {
  pickerId: number;
  handle: string;
  name: string;
  items: number;
  logged: number;
}

/**
 * Ingest a public Discogs list. Each item's `display_title` ("Artist - Album")
 * is parsed and resolved best-effort; unmatched items are still logged
 * unresolved with their Discogs link so the catalogue is never silently
 * dropped. Never throws.
 */
export async function ingestDiscogsList(args: {
  listId: string;
  /** Display name for the collector; falls back to the list's own name. */
  name?: string;
}): Promise<CollectorIngestResult> {
  const listId = args.listId.trim();
  if (!listId) throw new Error("listId is required");

  const list = await fetchDiscogsList(listId);
  const name = args.name?.trim() || list?.name || `Discogs list ${listId}`;

  const picker = await upsertPicker({
    pickerType: "collector",
    name,
    homeUrl: discogsListUrl(listId),
    sourceRef: { discogsListId: listId },
    trustTier: 3,
    description: `Catalogued picks from ${name}.`,
  });

  const items = list?.items ?? [];
  let logged = 0;
  let ordinal = 0;
  for (const item of items) {
    const guess = extractArtistTrack(item.displayTitle);
    // Even an unparsed item is logged (unresolved) — the catalogue is signal.
    const rawArtist = guess?.artist ?? item.displayTitle;
    const rawTitle = guess?.title ?? item.displayTitle;
    const { logged: wrote } = await persistPick({
      pickerId: picker.id,
      source: "discogs_list",
      rawArtist,
      rawTitle,
      sourceUrl: item.url ?? discogsListUrl(listId),
      context: item.comment ?? item.displayTitle,
      ordinal: ordinal++,
      externalId: `discogs:${listId}:${item.id}`,
    });
    if (wrote) logged++;
  }

  if (logged > 0) {
    console.info(
      `[lore] discogs list ${name} logged ${logged}/${items.length} pick(s)`,
    );
  }

  return {
    pickerId: picker.id,
    handle: picker.handle,
    name,
    items: items.length,
    logged,
  };
}

/**
 * Register a RateYourMusic picker as a pure link-out. RYM disallows scraping, so
 * this creates the picker (and its home link) WITHOUT ingesting any items — the
 * entry flow can surface "browse this list on RYM" without ever touching RYM.
 */
export async function addRymPicker(args: {
  name: string;
  url: string;
}): Promise<{ pickerId: number; handle: string; name: string }> {
  const url = args.url.trim();
  if (!/^https?:\/\/rateyourmusic\.com\//i.test(url)) {
    throw new Error("url must be a rateyourmusic.com link");
  }
  const picker = await upsertPicker({
    pickerType: "collector",
    name: args.name,
    homeUrl: url,
    sourceRef: { rymUrl: url, linkOnly: true },
    trustTier: 3,
    description: `RateYourMusic list (link-out only): ${args.name}.`,
  });
  return { pickerId: picker.id, handle: picker.handle, name: args.name };
}
