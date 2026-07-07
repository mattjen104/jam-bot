import { db, pickersTable, showsTable, stationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * KEXP shows harvester.
 *
 * Fetches every show from the KEXP v2 API, upserts them into the `shows`
 * table, and creates/updates a `picker` (type "dj") for each unique
 * host/selector. Runs once at boot (after the DB settles) then refreshes
 * daily so newly added shows and host changes are picked up automatically.
 *
 * No schema migration required: the existing `pickers` table absorbs KEXP
 * selectors exactly like NTS curators. Each picker's `sourceRef` carries
 * `kexpDjName`, `kexpShowIds`, and `stationSlug` so downstream workers can
 * re-sync or cross-reference without re-fetching the full show list.
 */

const KEXP_STATION_SLUG = "kexp";
const KEXP_SHOWS_BASE = "https://api.kexp.org/v2/shows/?format=json&limit=100";
const UA = `LoreBot/1.0 (+${process.env["MUSICBRAINZ_CONTACT"] ?? "https://tune-tribe.replit.app"})`;

interface KexpApiShow {
  id: number;
  program_name: string;
  host_names: string[];
  program_description?: string;
  thumbnail_uri?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Paginate the KEXP /shows/ endpoint and return all show records. */
async function fetchAllKexpShows(): Promise<KexpApiShow[]> {
  const out: KexpApiShow[] = [];
  let url: string | null = KEXP_SHOWS_BASE;

  while (url) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`KEXP shows API ${res.status}: ${url}`);

    const body = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
      next?: string | null;
    };

    for (const row of body.results ?? []) {
      const id = typeof row["id"] === "number" ? row["id"] : Number(row["id"]);
      const name =
        typeof row["program_name"] === "string"
          ? row["program_name"].trim()
          : "";
      if (!id || !name) continue;

      const hostNames = Array.isArray(row["host_names"])
        ? (row["host_names"] as unknown[])
            .map((h) => (typeof h === "string" ? h.trim() : ""))
            .filter(Boolean)
        : [];

      out.push({
        id,
        program_name: name,
        host_names: hostNames,
        program_description:
          typeof row["program_description"] === "string"
            ? row["program_description"].trim()
            : undefined,
        thumbnail_uri:
          typeof row["thumbnail_uri"] === "string"
            ? row["thumbnail_uri"].trim()
            : undefined,
      });
    }

    url = typeof body.next === "string" ? body.next : null;
  }

  return out;
}

/**
 * Upsert a show row for the KEXP station. Mirrors the logic in resolve.ts
 * `upsertShow` but doesn't return an id — we only need DB presence here.
 */
async function upsertKexpShowRow(
  stationId: number,
  name: string,
  djName: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: showsTable.id, djName: showsTable.djName })
    .from(showsTable)
    .where(
      and(eq(showsTable.stationId, stationId), eq(showsTable.name, name)),
    )
    .limit(1);

  if (existing) {
    if (djName && existing.djName !== djName) {
      await db
        .update(showsTable)
        .set({ djName })
        .where(eq(showsTable.id, existing.id));
    }
    return;
  }

  await db
    .insert(showsTable)
    .values({ stationId, name, djName })
    .onConflictDoNothing();
}

/**
 * Upsert a picker of type "dj" for a single KEXP selector. The `handle` is
 * `kexp-<slug>` so it can never collide with labels or blogs. Returns the
 * picker id (new or existing).
 */
async function upsertKexpSelectorPicker(
  hostName: string,
  kexpShowIds: number[],
): Promise<number | null> {
  const slug = slugify(hostName);
  if (!slug) return null;

  const handle = `kexp-${slug}`;
  const sourceRef = {
    kexpDjName: hostName,
    kexpShowIds,
    stationSlug: KEXP_STATION_SLUG,
  };

  const [existing] = await db
    .select({ id: pickersTable.id })
    .from(pickersTable)
    .where(eq(pickersTable.handle, handle))
    .limit(1);

  if (existing) {
    await db
      .update(pickersTable)
      .set({ sourceRef, updatedAt: new Date() })
      .where(eq(pickersTable.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db
    .insert(pickersTable)
    .values({
      pickerType: "dj",
      name: hostName,
      handle,
      homeUrl: `https://www.kexp.org/dj/${slug}/`,
      sourceRef,
      trustTier: 2,
      active: true,
    })
    .returning({ id: pickersTable.id });

  return inserted?.id ?? null;
}

/**
 * Full sync: fetch all KEXP shows, upsert show rows, create/update a picker
 * for every unique selector. Idempotent — safe to call repeatedly.
 */
export async function syncKexpShows(): Promise<void> {
  const [station] = await db
    .select({ id: stationsTable.id })
    .from(stationsTable)
    .where(eq(stationsTable.slug, KEXP_STATION_SLUG))
    .limit(1);

  if (!station) {
    console.warn("[kexp-shows] KEXP station not found; skipping sync");
    return;
  }

  let shows: KexpApiShow[];
  try {
    shows = await fetchAllKexpShows();
  } catch (err) {
    console.error("[kexp-shows] failed to fetch shows from KEXP API", err);
    return;
  }

  console.info(`[kexp-shows] fetched ${shows.length} shows from KEXP API`);

  // Upsert show rows (mirrors the live poller's attribution path).
  for (const show of shows) {
    const djName = show.host_names.length
      ? show.host_names.join(", ")
      : null;
    await upsertKexpShowRow(station.id, show.program_name, djName).catch(
      (err) =>
        console.error("[kexp-shows] show upsert failed", show.program_name, err),
    );
  }

  // Build host → show-id mapping, then upsert one picker per unique selector.
  const hostToShowIds = new Map<string, number[]>();
  for (const show of shows) {
    for (const host of show.host_names) {
      const ids = hostToShowIds.get(host) ?? [];
      ids.push(show.id);
      hostToShowIds.set(host, ids);
    }
  }

  // Upsert one picker per unique selector, collect host → picker_id mapping.
  const hostToPickerId = new Map<string, number>();
  for (const [host, showIds] of hostToShowIds) {
    const id = await upsertKexpSelectorPicker(host, showIds).catch((err) => {
      console.error("[kexp-shows] picker upsert failed", host, err);
      return null;
    });
    if (id) hostToPickerId.set(host, id);
  }

  // Link single-host shows to their picker via shows.picker_id.
  // Multi-host shows are skipped — no single picker owns them.
  let linkedShows = 0;
  for (const show of shows) {
    if (show.host_names.length !== 1) continue;
    const host = show.host_names[0];
    if (!host) continue;
    const pickerId = hostToPickerId.get(host);
    if (!pickerId) continue;

    const [existing] = await db
      .select({ id: showsTable.id, pickerId: showsTable.pickerId })
      .from(showsTable)
      .where(
        and(
          eq(showsTable.stationId, station.id),
          eq(showsTable.name, show.program_name),
        ),
      )
      .limit(1);

    if (!existing) continue;
    if (existing.pickerId === pickerId) continue; // already linked

    await db
      .update(showsTable)
      .set({ pickerId })
      .where(eq(showsTable.id, existing.id))
      .catch((err) =>
        console.error("[kexp-shows] show picker_id update failed", show.program_name, err),
      );
    linkedShows++;
  }

  console.info(
    `[kexp-shows] synced: ${shows.length} shows, ${hostToPickerId.size} selectors, ${linkedShows} show-picker links`,
  );
}

// ---- Scheduler ----------------------------------------------------------

let _timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;

const WARMUP_MS = 2 * 60 * 1000; // 2 min — let DB settle at boot
const REFRESH_MS = 24 * 60 * 60 * 1000; // daily refresh

/** Start the harvester. Idempotent — safe to call once at boot. */
export function startKexpShowsHarvester(): void {
  if (_timer) return;
  _timer = setTimeout(async () => {
    await syncKexpShows().catch((err) =>
      console.error("[kexp-shows] initial sync failed", err),
    );
    _timer = setInterval(
      () =>
        void syncKexpShows().catch((err) =>
          console.error("[kexp-shows] refresh sync failed", err),
        ),
      REFRESH_MS,
    );
  }, WARMUP_MS);
}

/** Stop the harvester (tests / graceful shutdown). */
export function stopKexpShowsHarvester(): void {
  if (_timer) {
    clearTimeout(_timer as ReturnType<typeof setTimeout>);
    clearInterval(_timer as ReturnType<typeof setInterval>);
    _timer = null;
  }
}
