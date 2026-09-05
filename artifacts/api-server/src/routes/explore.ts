/**
 * Bounded, listener-facing broadcast discovery read model.  This intentionally
 * stays plain JSON: it composes persisted station facts and schedule evidence,
 * rather than becoming another generated CRUD resource.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { h } from "../middlewares/asyncHandler.js";
import { getUserForListenerRead } from "../lore/userSession.js";
import { distanceMiles, isNearbyRadius, resolveUsZip, usableCoordinates } from "../lore/station-location.js";

const router: IRouter = Router();
const MAX_LIMIT = 30;
const MODES = new Set(["location", "station", "artist", "genre", "newness", "library-crossing"]);
export type ExploreMode = "location" | "station" | "artist" | "genre" | "newness" | "library-crossing";
type ExploreDbRow = Record<string, unknown> & {
  slug: string; name: string; city: string | null; region: string | null;
  latitude: number | null; longitude: number | null; discovery_score: number | null;
  artist_count: number; crossing_count: number; recent_profile: ExploreCandidate["recentProfile"];
  freshness_signal: ExploreCandidate["freshness"]; live: boolean;
  show_name: string | null; dj_name: string | null; start_time: string | null; end_time: string | null;
  upcoming_show_name: string | null; upcoming_dj_name: string | null;
  upcoming_starts_at: Date | string | null; upcoming_ends_at: Date | string | null;
  known_show_name: string | null; known_dj_name: string | null; known_last_aired_at: Date | string | null;
};

export interface ExploreCandidate {
  station: { slug: string; name: string; city: string | null; region: string | null; latitude: number | null; longitude: number | null };
  show: { name: string; djName: string | null; startsAt: string | null; endsAt: string | null; live: boolean } | null;
  recentProfile: { readinessTier?: string; top?: Array<{ genre: string; count: number }> } | null;
  freshness: { hasRecentUsableSpin?: boolean } | null;
  discoveryScore: number | null;
  artistCount: number;
  crossingCount: number;
  exactGenre: boolean;
  adjacentGenre: boolean;
  upcoming?: { name: string; djName: string | null; startsAt: string; endsAt: string } | null;
  knownShow?: { name: string; djName: string | null; lastAiredAt: string } | null;
}

/** Pure, deliberately legible ordering shared by route tests. */
export function composeExplore(
  candidates: ExploreCandidate[],
  mode: ExploreMode,
  limit: number,
  origin?: ReturnType<typeof resolveUsZip> | null,
) {
  const reason = (c: ExploreCandidate) => {
    if (mode === "artist") return c.artistCount > 0 ? { kind: "artist_exact", text: "Recent resolved plays match this artist." } : { kind: "artist_unavailable", text: "No recent exact artist evidence." };
    if (mode === "genre") return c.exactGenre ? { kind: "genre_exact", text: "Recent profile contains this genre." } : { kind: "genre_adjacent", text: "Recent profile has an adjacent genre." };
    if (mode === "library-crossing") return { kind: "library_crossing", text: "A saved track played here in the last 24 hours." };
    if (mode === "newness") return { kind: "recent_rotation", text: "Recent station profile is available." };
    if (mode === "location") return { kind: "nearby_station", text: "Station base is near the supplied ZIP." };
    return { kind: "station_match", text: "Matches the requested station." };
  };
  return candidates
    .map((c) => {
      const distance = origin && usableCoordinates(c.station.latitude, c.station.longitude)
        ? Math.round(distanceMiles(origin, { latitude: c.station.latitude, longitude: c.station.longitude as number }) * 10) / 10 : null;
      const readiness = c.recentProfile?.readinessTier ?? "insufficient";
      return {
        station: { ...c.station, approximateDistanceMiles: distance },
        show: c.show,
        primaryReason: reason(c),
        evidence: { artistRecentPlays: c.artistCount, libraryCrossings24h: c.crossingCount, genreMatch: c.exactGenre ? "exact" : c.adjacentGenre ? "adjacent" : "aggregate", profileGenres: c.recentProfile?.top?.slice(0, 3) ?? [] },
        readiness,
        confidence: c.show?.live ? (c.show.name ? "schedule_attributed" : "station_only") : readiness === "ready" ? "high" : "limited",
        timing: c.show ? { startsAt: c.show.startsAt, endsAt: c.show.endsAt, isLive: c.show.live } : null,
      };
    })
    .sort((a, b) => {
      const ca = candidates.find((c) => c.station.slug === a.station.slug)!;
      const cb = candidates.find((c) => c.station.slug === b.station.slug)!;
      const score =
        mode === "artist" ? cb.artistCount - ca.artistCount :
        mode === "library-crossing" ? cb.crossingCount - ca.crossingCount :
        mode === "genre" ? Number(cb.exactGenre) - Number(ca.exactGenre) :
        mode === "newness" ? (cb.discoveryScore ?? -1) - (ca.discoveryScore ?? -1) :
        mode === "location" ? (a.station.approximateDistanceMiles ?? Infinity) - (b.station.approximateDistanceMiles ?? Infinity) :
        0;
      return score || Number(Boolean(cb.show?.live)) - Number(Boolean(ca.show?.live)) || a.station.name.localeCompare(b.station.name);
    })
    .slice(0, limit);
}

router.get("/explore", h(async (req, res) => {
  const toIso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  const mode = typeof req.query.mode === "string" ? req.query.mode : "";
  if (!MODES.has(mode)) return res.status(400).json({ code: "invalid_mode", error: "mode must be location, station, artist, genre, newness, or library-crossing." });
  const typedMode = mode as ExploreMode;
  const limitInput = typeof req.query.limit === "string" ? Number(req.query.limit) : 12;
  if (!Number.isInteger(limitInput) || limitInput < 1 || limitInput > MAX_LIMIT) return res.status(400).json({ code: "invalid_limit", error: `limit must be an integer from 1 to ${MAX_LIMIT}.` });
  const station = typeof req.query.station === "string" ? req.query.station.trim() : "";
  const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (station.length > 100 || term.length > 100 || ((typedMode === "artist" || typedMode === "genre") && !term)) return res.status(400).json({ code: "invalid_constraint", error: "A bounded q is required for artist and genre modes." });
  if (typedMode === "station" && !station) return res.status(400).json({ code: "invalid_station", error: "station mode requires a station slug." });
  const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const origin = zip ? resolveUsZip(zip) : null;
  if (typedMode === "location" && !origin) return res.status(400).json({ code: "invalid_zip", error: "location mode requires a known 5-digit US ZIP." });
  const radiusInput = typeof req.query.radiusMiles === "string" ? Number(req.query.radiusMiles) : 50;
  if (typedMode === "location" && !isNearbyRadius(radiusInput)) return res.status(400).json({ code: "invalid_radius", error: "radiusMiles must be 25, 50, 100, or 250." });
  const user = typedMode === "library-crossing" ? await getUserForListenerRead(req) : null;

  // The CTE selects at most one current schedule slot and one genuinely future
  // slot per station.  A live slot can therefore never leak into comingUp.
  const artistPredicate = typedMode === "artist" ? sql`
    (SELECT count(*)::int FROM spins sp JOIN recordings r ON r.mbid=sp.mbid
     WHERE sp.station_id=s.id AND sp.played_at >= now()-interval '90 days'
       AND (lower(r.artist)=lower(${term}) OR r.artist_mbid=${term}))` : sql`0`;
  const crossingPredicate = user ? sql`
    (SELECT count(*)::int FROM spins sp JOIN library_items li ON li.mbid=sp.mbid
     WHERE sp.station_id=s.id AND li.user_id=${user.id} AND li.removed_at IS NULL
       AND sp.played_at >= now()-interval '24 hours')` : sql`0`;
  const rows = await db.execute<ExploreDbRow>(sql`
    WITH base AS (
      SELECT s.*, ${artistPredicate} AS artist_count, ${crossingPredicate} AS crossing_count,
        live_slot.show_name, live_slot.dj_name, live_slot.start_time, live_slot.end_time,
        future_slot.show_name AS upcoming_show_name, future_slot.dj_name AS upcoming_dj_name,
        future_slot.starts_at AS upcoming_starts_at, future_slot.ends_at AS upcoming_ends_at,
        known_slot.show_name AS known_show_name, known_slot.dj_name AS known_dj_name,
        known_slot.last_aired_at AS known_last_aired_at,
        live_slot.show_name IS NOT NULL AS live
      FROM stations s
      LEFT JOIN LATERAL (
        SELECT show_name, dj_name, start_time, end_time FROM scraped_shows
        WHERE station_id=s.id AND voided_at IS NULL
          AND (
            (day_of_week=to_char(now() at time zone s.iana_timezone, 'Dy') AND (
              (end_time > start_time AND start_time <= to_char(now() at time zone s.iana_timezone, 'HH24:MI') AND end_time > to_char(now() at time zone s.iana_timezone, 'HH24:MI'))
              OR (end_time < start_time AND start_time <= to_char(now() at time zone s.iana_timezone, 'HH24:MI'))
            ))
            OR (end_time < start_time
              AND day_of_week=to_char((now()-interval '1 day') at time zone s.iana_timezone, 'Dy')
              AND end_time > to_char(now() at time zone s.iana_timezone, 'HH24:MI'))
          )
        ORDER BY start_time DESC LIMIT 1
      ) live_slot ON true
      LEFT JOIN LATERAL (
        SELECT next_slot.show_name, next_slot.dj_name, next_slot.starts_at,
          next_slot.starts_at + CASE
            WHEN next_slot.end_time > next_slot.start_time
              THEN next_slot.end_time::time - next_slot.start_time::time
            ELSE interval '1 day' + next_slot.end_time::time - next_slot.start_time::time
          END AS ends_at
        FROM (
          SELECT ss.show_name, ss.dj_name, ss.start_time, ss.end_time,
            (
              date_trunc('day', now() at time zone s.iana_timezone)
              + (
                (
                  CASE ss.day_of_week
                    WHEN 'Sun' THEN 0 WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2
                    WHEN 'Wed' THEN 3 WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5
                    WHEN 'Sat' THEN 6
                  END
                  - extract(dow from now() at time zone s.iana_timezone)::int + 7
                ) % 7
                + CASE
                    WHEN ss.day_of_week=to_char(now() at time zone s.iana_timezone, 'Dy')
                      AND ss.start_time <= to_char(now() at time zone s.iana_timezone, 'HH24:MI')
                    THEN 7 ELSE 0
                  END
              ) * interval '1 day'
              + ss.start_time::time
            ) at time zone s.iana_timezone AS starts_at
          FROM scraped_shows ss
          WHERE ss.station_id=s.id AND ss.voided_at IS NULL AND ss.end_time <> ss.start_time
        ) next_slot
        ORDER BY next_slot.starts_at ASC LIMIT 1
      ) future_slot ON true
      LEFT JOIN LATERAL (
        SELECT sp.show_id
        FROM spins sp
        WHERE sp.station_id=s.id
          AND sp.show_id IS NOT NULL
          AND live_slot.show_name IS NOT NULL
          AND sp.played_at >= (
            date_trunc('day', now() at time zone s.iana_timezone)
            + live_slot.start_time::time
            - CASE
                WHEN live_slot.end_time < live_slot.start_time
                  AND to_char(now() at time zone s.iana_timezone, 'HH24:MI') < live_slot.end_time
                THEN interval '1 day'
                ELSE interval '0'
              END
          ) at time zone s.iana_timezone
          AND sp.played_at <= now()
        ORDER BY sp.played_at DESC, sp.id DESC
        LIMIT 1
      ) active_show ON true
      LEFT JOIN LATERAL (
        SELECT sh.name AS show_name, sh.dj_name, max(sp.played_at) AS last_aired_at
        FROM shows sh
        JOIN spins sp ON sp.show_id=sh.id
        WHERE sh.station_id=s.id
          AND sh.id IS DISTINCT FROM active_show.show_id
        GROUP BY sh.id, sh.name, sh.dj_name
        ORDER BY max(sp.played_at) DESC LIMIT 1
      ) known_slot ON true
      WHERE s.active=true AND s.hidden=false ${station ? sql`AND s.slug=${station}` : sql``}
    ), ranked AS (
      SELECT *, row_number() over (partition by id order by live desc nulls last, start_time asc nulls last) rn FROM base
    )
    SELECT * FROM ranked WHERE rn=1 ORDER BY id
  `);
  const candidates: ExploreCandidate[] = rows.rows.map((r) => {
    const top = r.recent_profile?.top ?? [];
    const query = term.toLowerCase();
    const exactGenre = typedMode === "genre" && top.some((g) => g.genre.toLowerCase() === query);
    const adjacentGenre = typedMode === "genre" && !exactGenre && top.some((g) => g.genre.toLowerCase().includes(query) || query.includes(g.genre.toLowerCase()));
    return { station: { slug: r.slug, name: r.name, city: r.city, region: r.region, latitude: r.latitude, longitude: r.longitude }, show: r.live && r.show_name ? { name: r.show_name, djName: r.dj_name, startsAt: r.start_time, endsAt: r.end_time, live: true } : null, upcoming: r.upcoming_show_name && r.upcoming_starts_at && r.upcoming_ends_at ? { name: r.upcoming_show_name, djName: r.upcoming_dj_name, startsAt: toIso(r.upcoming_starts_at), endsAt: toIso(r.upcoming_ends_at) } : null, knownShow: r.known_show_name && r.known_last_aired_at ? { name: r.known_show_name, djName: r.known_dj_name, lastAiredAt: toIso(r.known_last_aired_at) } : null, recentProfile: r.recent_profile ?? null, freshness: r.freshness_signal ?? null, discoveryScore: r.discovery_score == null ? null : Number(r.discovery_score), artistCount: Number(r.artist_count), crossingCount: Number(r.crossing_count), exactGenre, adjacentGenre };
  });
  const filtered = typedMode === "genre" ? candidates.filter((c) => c.exactGenre || c.adjacentGenre)
    : typedMode === "artist" ? candidates.filter((c) => c.artistCount > 0)
      : typedMode === "library-crossing" ? candidates.filter((c) => c.crossingCount > 0)
        : typedMode === "newness" ? candidates.filter((c) => c.freshness?.hasRecentUsableSpin === true)
        : typedMode === "location" && origin ? candidates.filter((c) =>
          usableCoordinates(c.station.latitude, c.station.longitude) &&
          distanceMiles(origin, { latitude: c.station.latitude, longitude: c.station.longitude as number }) <= radiusInput
        ) : candidates;
  const items = composeExplore(filtered, typedMode, limitInput, origin);
  const onAirNow = items.filter((i) => i.timing?.isLive);
  // Current live occurrence is excluded; schedule future entries are unavailable
  // when schedule evidence was not returned, and that absence is explicit.
  const comingUp = filtered
    .flatMap((candidate) => {
      if (!candidate.upcoming) return [];
      // Recompose with an explicitly future occurrence, preserving the live
      // card only in onAirNow rather than duplicating its current slot.
      return composeExplore([{ ...candidate, show: { ...candidate.upcoming, live: false } }], typedMode, 1, origin);
    })
    .sort((a, b) => {
      const at = a.timing?.startsAt ?? "";
      const bt = b.timing?.startsAt ?? "";
      return at.localeCompare(bt) || a.station.name.localeCompare(b.station.name);
    })
    .slice(0, limitInput);
  const showsToKnow = filtered
    .flatMap((candidate) => {
      if (!candidate.knownShow) return [];
      return composeExplore([{
        ...candidate,
        show: {
          name: candidate.knownShow.name,
          djName: candidate.knownShow.djName,
          startsAt: candidate.knownShow.lastAiredAt,
          endsAt: null,
          live: false,
        },
      }], typedMode, 1, origin);
    })
    .sort((a, b) => (b.timing?.startsAt ?? "").localeCompare(a.timing?.startsAt ?? ""))
    .slice(0, limitInput);
  return res.json({ onAirNow, comingUp, showsToKnow, stations: items, metadata: { mode: typedMode, radiusMiles: typedMode === "location" ? radiusInput : null, partial: { schedules: candidates.some((c) => !c.show), genreEnrichment: candidates.some((c) => !c.recentProfile), coordinates: origin ? candidates.some((c) => c.station.latitude == null || c.station.longitude == null) : false, personalCrossings: typedMode === "library-crossing" && !user }, locality: origin ? { city: origin.city, region: origin.region, country: origin.country } : null } });
}));

export default router;