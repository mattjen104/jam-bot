import { db, pickersTable, picksTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { persistPick } from "./picks.js";

/**
 * NTS Radio archive adapter — the first top-tier non-radio-station archive
 * source. NTS publishes every show's full episode archive (dated, ordered
 * tracklists) through its own public JSON API; a resident's show becomes a
 * `curator` picker (sourceRef.ntsShowAlias) and each archived episode becomes
 * a dated, ordered run of picks:
 *
 *   pickedAt   = the episode's broadcast date
 *   ordinal    = position in the tracklist (rideable segues)
 *   sourceUrl  = the episode's own NTS page (runs group by this)
 *   externalId = nts:{episodeAlias}:{ordinal} (idempotent re-ingest)
 *
 * Ingest is budgeted and resumable: each sync walks episodes newest-first,
 * skips episodes already ingested (probe on the ordinal-0 externalId), and
 * ingests at most a handful of NEW episodes per tick. Re-running deepens the
 * archive over time without ever re-resolving what's already on the spine.
 * Tracklists come as plain artist/title text (no MBIDs), so resolution rides
 * the shared cached text path. Only NTS's own published metadata is read —
 * never the audio.
 */

const FETCH_TIMEOUT_MS = 10_000;
const EPISODES_PAGE = 12;
/** Max NEW episodes ingested per sync — the MusicBrainz budget lever. */
const MAX_NEW_EPISODES_PER_SYNC = 3;
/** How many episode pages to walk looking for un-ingested episodes. */
const MAX_PAGES_PER_SYNC = 6;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** One episode as listed by the NTS shows API. */
export interface NtsEpisode {
  episodeAlias: string;
  name: string;
  broadcast: Date | null;
}

/** One tracklist entry from an NTS episode detail. */
export interface NtsTrack {
  artist: string;
  title: string;
  uid?: string;
}

/** Pure: NTS `/shows/{alias}/episodes` body → episode list (newest-first). */
export function parseNtsEpisodes(body: unknown): NtsEpisode[] {
  const b = body as { results?: Array<Record<string, unknown>> };
  const out: NtsEpisode[] = [];
  for (const ep of b.results ?? []) {
    if (ep.status && ep.status !== "published") continue;
    const episodeAlias = str(ep.episode_alias);
    const name = str(ep.name);
    if (!episodeAlias || !name) continue;
    const broadcastRaw = str(ep.broadcast);
    const broadcast = broadcastRaw ? new Date(broadcastRaw) : null;
    out.push({
      episodeAlias,
      name,
      broadcast:
        broadcast && !Number.isNaN(broadcast.getTime()) ? broadcast : null,
    });
  }
  return out;
}

/** Pure: NTS episode detail body → ordered tracklist. */
export function parseNtsTracklist(body: unknown): NtsTrack[] {
  const b = body as {
    embeds?: { tracklist?: { results?: Array<Record<string, unknown>> } };
  };
  const out: NtsTrack[] = [];
  for (const t of b.embeds?.tracklist?.results ?? []) {
    const artist = str(t.artist);
    const title = str(t.title);
    if (!artist || !title) continue;
    const track: NtsTrack = { artist, title };
    const uid = str(t.uid);
    if (uid) track.uid = uid;
    out.push(track);
  }
  return out;
}

/** Stable pick externalId for one slot of one episode. */
export function ntsExternalId(episodeAlias: string, ordinal: number): string {
  return `nts:${episodeAlias}:${ordinal}`;
}

/** Public URL of an NTS episode page (the run's sourceUrl / citation). */
export function ntsEpisodeUrl(showAlias: string, episodeAlias: string): string {
  return `https://www.nts.live/shows/${showAlias}/episodes/${episodeAlias}`;
}

/** Whether this episode's tracklist has already been ingested for a picker. */
async function episodeIngested(
  pickerId: number,
  episodeAlias: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: picksTable.id })
    .from(picksTable)
    .where(
      and(
        eq(picksTable.pickerId, pickerId),
        like(picksTable.externalId, `nts:${episodeAlias}:%`),
      ),
    )
    .limit(1);
  return !!row;
}

export interface NtsSyncResult {
  episodesSeen: number;
  episodesIngested: number;
  tracks: number;
  logged: number;
  resolved: number;
}

/**
 * Sync one NTS show's archive into its picker, newest-first, bounded by the
 * per-sync episode budget. Idempotent and resumable — already-ingested
 * episodes are skipped, so repeated syncs walk ever deeper into the archive.
 * Throws only on a completely failed episodes fetch (caller logs).
 */
export async function syncNtsShow(args: {
  pickerId: number;
  showAlias: string;
}): Promise<NtsSyncResult> {
  const { pickerId, showAlias } = args;
  const result: NtsSyncResult = {
    episodesSeen: 0,
    episodesIngested: 0,
    tracks: 0,
    logged: 0,
    resolved: 0,
  };

  for (
    let page = 0;
    page < MAX_PAGES_PER_SYNC &&
    result.episodesIngested < MAX_NEW_EPISODES_PER_SYNC;
    page++
  ) {
    const body = await getJson(
      `https://www.nts.live/api/v2/shows/${encodeURIComponent(showAlias)}/episodes?limit=${EPISODES_PAGE}&offset=${page * EPISODES_PAGE}`,
    );
    const episodes = parseNtsEpisodes(body);
    if (!episodes.length) break;
    result.episodesSeen += episodes.length;

    for (const ep of episodes) {
      if (result.episodesIngested >= MAX_NEW_EPISODES_PER_SYNC) break;
      try {
        if (await episodeIngested(pickerId, ep.episodeAlias)) continue;
        const detail = await getJson(
          `https://www.nts.live/api/v2/shows/${encodeURIComponent(showAlias)}/episodes/${encodeURIComponent(ep.episodeAlias)}`,
        );
        const tracks = parseNtsTracklist(detail);
        if (!tracks.length) continue; // no tracklist published — nothing to log
        const sourceUrl = ntsEpisodeUrl(showAlias, ep.episodeAlias);
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i]!;
          const { logged, resolution } = await persistPick({
            pickerId,
            source: "curator_list",
            rawArtist: t.artist,
            rawTitle: t.title,
            sourceUrl,
            context: ep.name,
            ordinal: i,
            externalId: ntsExternalId(ep.episodeAlias, i),
            ...(ep.broadcast ? { pickedAt: ep.broadcast } : {}),
          });
          result.tracks++;
          if (logged) result.logged++;
          if (resolution.mbid) result.resolved++;
        }
        result.episodesIngested++;
      } catch (err) {
        // One bad episode never aborts the sync — skip and keep walking.
        console.error("[lore] nts episode failed", showAlias, ep.episodeAlias, err);
      }
    }

    if (episodes.length < EPISODES_PAGE) break; // archive exhausted
  }

  return result;
}

// ---- Poller (slow, in-process — the NTS analogue of the blog poller) ----

// Each tick deepens every NTS picker by up to the per-sync episode budget.
const NTS_POLL_MS = 20 * 60 * 1000;
const STAGGER_MS = 30_000;
const WARMUP_MS = 120_000;

let started = false;
const timers: NodeJS.Timeout[] = [];

interface NtsPickerRef {
  pickerId: number;
  name: string;
  showAlias: string;
}

/** Active curator pickers that carry an NTS show alias in their sourceRef. */
async function loadNtsPickers(): Promise<NtsPickerRef[]> {
  const rows = await db
    .select({
      id: pickersTable.id,
      name: pickersTable.name,
      sourceRef: pickersTable.sourceRef,
    })
    .from(pickersTable)
    .where(eq(pickersTable.active, true));

  const out: NtsPickerRef[] = [];
  for (const r of rows) {
    const alias = (r.sourceRef as Record<string, unknown> | null)?.[
      "ntsShowAlias"
    ];
    if (typeof alias === "string" && alias.trim()) {
      out.push({ pickerId: r.id, name: r.name, showAlias: alias.trim() });
    }
  }
  return out;
}

async function pollNtsPicker(p: NtsPickerRef): Promise<void> {
  try {
    const r = await syncNtsShow({ pickerId: p.pickerId, showAlias: p.showAlias });
    if (r.logged > 0) {
      console.info(
        `[lore] nts ${p.name}: +${r.logged} pick(s) across ${r.episodesIngested} episode(s)`,
      );
    }
  } catch (err) {
    console.error("[lore] nts sync failed", p.showAlias, err);
  }
}

/**
 * Start the NTS archive poller. Idempotent — safe to call once at boot. Each
 * tick ingests a bounded number of new episodes per show, so a deep archive
 * fills in gradually and resumably without ever bursting MusicBrainz.
 */
export async function startNtsPoller(): Promise<void> {
  if (started) return;
  started = true;

  let pickers: NtsPickerRef[];
  try {
    pickers = await loadNtsPickers();
  } catch (err) {
    console.error("[lore] nts poller could not load pickers; not started", err);
    started = false;
    return;
  }

  console.info(`[lore] starting nts poller for ${pickers.length} show(s)`);

  pickers.forEach((p, i) => {
    const kickoff = setTimeout(
      () => {
        void pollNtsPicker(p);
        const interval = setInterval(() => void pollNtsPicker(p), NTS_POLL_MS);
        timers.push(interval);
      },
      WARMUP_MS + i * STAGGER_MS,
    );
    timers.push(kickoff);
  });
}

/** Stop the NTS poller (tests / graceful shutdown). */
export function stopNtsPoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
