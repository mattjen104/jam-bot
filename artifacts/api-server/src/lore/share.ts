import { readFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import {
  db,
  recordingsTable,
  stationsTable,
  spinsTable,
  showsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import { eq, and, isNull, sql, gt, desc } from "drizzle-orm";
import type { RecordingLink } from "@workspace/db";
import { spinsForRecording } from "./segue.js";

/**
 * Share layer: server-rendered Open Graph pages + dynamic preview cards for
 * Lore's canonical entities (song, station, station run, picker run).
 *
 * Unfurl bots can't run the SPA, so each share URL serves a tiny HTML document
 * whose only jobs are (1) carry correct OG/Twitter meta and (2) bounce human
 * visitors straight to the SPA route. The og:image is rendered server-side so
 * every share is a purpose-built postcard, not a generic logo.
 */

// ---- SPA target ----------------------------------------------------------

/** Base path where the Lore SPA is mounted (no trailing slash). */
export function loreBasePath(): string {
  const raw = process.env.LORE_BASE_PATH ?? "/lore";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

// ---- Share payloads ------------------------------------------------------

export interface SharePayload {
  /** OG page title. */
  title: string;
  /** OG description. */
  description: string;
  /** SPA path (absolute, starts with /) humans are redirected to. */
  redirectPath: string;
  /** Card contents. */
  card: ShareCard;
}

/** Extra data only present on song share pages. */
export interface SongShareExtras {
  links: RecordingLink[];
  /**
   * Set when the song is playing on any station right now (within 5 min).
   * When present, this is the ONLY Lore option shown — live always trumps
   * the ghost-radio fallback.
   */
  liveStation: { name: string; slug: string } | null;
  /**
   * The most recent archived broadcast run containing this song.
   * Only shown when `liveStation` is null.
   */
  ghostRun: { stationName: string; runId: number; playedAt: string } | null;
}

export type SongSharePayload = SharePayload & { song: SongShareExtras };

export interface ShareCard {
  /** Small mono kicker above the title (e.g. "STATION RUN — KEXP 90.3 FM"). */
  kicker: string;
  /** Big serif line. */
  title: string;
  /** Mono line under the title. */
  subtitle: string;
  /** Bottom-right mono line (counts / date). */
  footer: string;
  /** Best-effort square artwork; card renders fine without it. */
  artworkUrl?: string | null;
}

const dayExpr = sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/** How recent a spin must be to count as "playing live right now". */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

export async function getSongShare(mbid: string): Promise<SongSharePayload | null> {
  const [rec] = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  if (!rec) return null;

  // 1. Is it playing anywhere right now?
  const [liveRow] = await db
    .select({ name: stationsTable.name, slug: stationsTable.slug })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .where(
      and(
        eq(spinsTable.mbid, mbid),
        gt(spinsTable.playedAt, new Date(Date.now() - LIVE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);

  const liveStation = liveRow ?? null;

  // 2. If not live, find the most recent archived run containing this song.
  let ghostRun: SongShareExtras["ghostRun"] = null;
  if (!liveStation) {
    const recentSpins = await spinsForRecording(mbid, 1);
    const top = recentSpins[0];
    if (top?.runId != null) {
      ghostRun = {
        stationName: top.station.name,
        runId: top.runId,
        playedAt: top.playedAt.toISOString(),
      };
    }
  }

  const links = (rec.links as RecordingLink[] | null) ?? [];

  return {
    title: `${rec.title} — ${rec.artist} · Lore`,
    description:
      "Who made it, who played it, and where it can carry you next. Every song tells itself on Lore.",
    redirectPath: `${loreBasePath()}/song/${encodeURIComponent(mbid)}`,
    card: {
      kicker: "One song, told in full",
      title: rec.title,
      subtitle: rec.artist,
      footer: "lore · free radio, tracked to the source",
      artworkUrl: rec.artworkUrl,
    },
    song: { links, liveStation, ghostRun },
  };
}

/**
 * Song-specific share landing. Keeps full OG meta for bot unfurls but renders
 * a real service-chooser page for human visitors instead of a JS redirect.
 * Live station is always shown when present; ghost radio only appears when the
 * song is not currently on air anywhere.
 */
export function renderSongShareHtml(
  payload: SongSharePayload,
  origin: string,
  sharePath: string,
  cardPath: string,
): string {
  const { song } = payload;
  const title = escapeHtml(payload.title);
  const desc = escapeHtml(payload.description);
  const url = escapeHtml(`${origin}${sharePath}`);
  const image = escapeHtml(`${origin}${cardPath}`);
  const loreUrl = escapeHtml(`${origin}${payload.redirectPath}`);

  // Prefer exact links; always show at least search fallbacks.
  const exact = song.links.filter((l) => l.kind === "exact");
  const serviceLinks = exact.length > 0 ? exact : song.links;

  const artworkHtml = payload.card.artworkUrl
    ? `<img src="${escapeHtml(payload.card.artworkUrl)}" alt="" class="artwork">`
    : `<div class="artwork artwork-placeholder"></div>`;

  // Service buttons — each opens the user's chosen platform directly.
  const serviceBtns = serviceLinks
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-service">${escapeHtml(l.name)}</a>`,
    )
    .join("\n");

  // Lore button — live trumps ghost, only one is shown.
  let loreBtnHtml = "";
  if (song.liveStation) {
    const stationUrl = escapeHtml(
      `${origin}${loreBasePath()}/archive/stations/${encodeURIComponent(song.liveStation.slug)}`,
    );
    loreBtnHtml = `<a href="${stationUrl}" class="btn btn-live">
      <span class="live-dot"></span>Live on ${escapeHtml(song.liveStation.name)} right now
    </a>`;
  } else if (song.ghostRun) {
    const runUrl = escapeHtml(
      `${origin}${loreBasePath()}/archive/station-runs/${song.ghostRun.runId}?play=1&from=${encodeURIComponent(payload.redirectPath.split("/").pop() ?? "")}`,
    );
    const date = song.ghostRun.playedAt.slice(0, 10);
    loreBtnHtml = `<a href="${runUrl}" class="btn btn-ghost">
      Last played on ${escapeHtml(song.ghostRun.stationName)} · ${escapeHtml(date)} — listen to that broadcast
    </a>`;
  }

  const loreFullHtml = `<a href="${loreUrl}" class="btn btn-lore">View full story on Lore →</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lore">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#14110d;color:#f2ead9;font-family:ui-monospace,'IBM Plex Mono',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;width:100%}
.song-row{display:flex;gap:20px;align-items:flex-start;margin-bottom:28px}
.artwork{width:88px;height:88px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#2a2520}
.artwork-placeholder{width:88px;height:88px;border-radius:10px;background:#2a2520;flex-shrink:0}
.song-info{flex:1;min-width:0}
.song-title{font-family:Georgia,'PT Serif',serif;font-size:clamp(18px,4vw,26px);font-weight:700;line-height:1.15;color:#f2ead9;margin-bottom:6px;word-break:break-word}
.song-artist{font-size:13px;letter-spacing:.04em;color:#c8b895;text-transform:uppercase}
.section-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6b5f4e;margin-bottom:10px}
.services{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:9999px;font-family:inherit;font-size:12px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;font-weight:500;transition:opacity .15s;cursor:pointer;border:none;white-space:nowrap}
.btn:hover{opacity:.8}
.btn-service{background:#2a2520;color:#f2ead9;border:1px solid #3a332a}
.btn-live{background:#1a3a1a;color:#7eda7e;border:1px solid #2d5a2d;width:100%;justify-content:flex-start}
.btn-ghost{background:#1a1a2e;color:#9b9bda;border:1px solid #2d2d4a;width:100%}
.btn-lore{background:#1e1913;color:#c8b895;border:1px solid #3a332a;font-size:11px;margin-top:8px}
.live-dot{width:8px;height:8px;border-radius:50%;background:#7eda7e;animation:pulse 1.4s ease-in-out infinite;flex-shrink:0}
.lore-section{border-top:1px solid #3a332a;padding-top:20px;display:flex;flex-direction:column;gap:0}
.wordmark{font-size:10px;letter-spacing:.1em;color:#6b5f4e;text-transform:uppercase;margin-bottom:16px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div class="card">
  <div class="wordmark">Lore · free radio, tracked to the source</div>
  <div class="song-row">
    ${artworkHtml}
    <div class="song-info">
      <div class="song-title">${escapeHtml(payload.card.title)}</div>
      <div class="song-artist">${escapeHtml(payload.card.subtitle)}</div>
    </div>
  </div>
  ${serviceBtns ? `<div class="section-label">Listen on</div><div class="services">${serviceBtns}</div>` : ""}
  <div class="lore-section">
    ${loreBtnHtml}
    ${loreFullHtml}
  </div>
</div>
</body>
</html>`;
}

export async function getStationShare(
  slug: string,
): Promise<SharePayload | null> {
  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.slug, slug))
    .limit(1);
  if (!station) return null;
  const quality = station.streamQuality ? ` · ${station.streamQuality}` : "";
  return {
    title: `${station.name} · Lore`,
    description: `Listen live and see every track identified as it plays${quality}. Free, unmodified stream — straight from ${station.org}.`,
    redirectPath: `${loreBasePath()}/archive/stations/${encodeURIComponent(slug)}`,
    card: {
      kicker: "Live station",
      title: station.name,
      subtitle: `${station.org}${quality}`,
      footer: "every track identified as it plays",
      artworkUrl: station.logoUrl,
    },
  };
}

export async function getStationRunShare(
  runId: number,
): Promise<SharePayload | null> {
  const [anchor] = await db
    .select({
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      day: dayExpr,
    })
    .from(spinsTable)
    .where(eq(spinsTable.id, runId))
    .limit(1);
  if (!anchor) return null;

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, anchor.stationId))
    .limit(1);
  if (!station) return null;

  let showLine = "";
  if (anchor.showId != null) {
    const [show] = await db
      .select()
      .from(showsTable)
      .where(eq(showsTable.id, anchor.showId))
      .limit(1);
    if (show) {
      showLine = show.djName ? `${show.name} · ${show.djName}` : show.name;
    }
  }

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      resolved: sql<number>`count(${spinsTable.mbid})::int`,
    })
    .from(spinsTable)
    .where(
      and(
        eq(spinsTable.stationId, anchor.stationId),
        sql`${dayExpr} = ${anchor.day}`,
        anchor.showId == null
          ? isNull(spinsTable.showId)
          : eq(spinsTable.showId, anchor.showId),
      ),
    );
  const total = counts?.total ?? 0;
  const resolved = counts?.resolved ?? 0;

  return {
    title: `${showLine || station.name} — ${anchor.day} · Lore`,
    description: `Replay this documented broadcast: ${total} tracks as they aired on ${station.name}, ${resolved} identified to the source.`,
    redirectPath: `${loreBasePath()}/archive/station-runs/${runId}`,
    card: {
      kicker: `Documented broadcast — ${station.name}`,
      title: showLine || `${station.name}, as it aired`,
      subtitle: anchor.day,
      footer: `${total} tracks · ${resolved} identified`,
      artworkUrl: station.logoUrl,
    },
  };
}

export async function getPickerShare(
  handle: string,
): Promise<SharePayload | null> {
  const [picker] = await db
    .select()
    .from(pickersTable)
    .where(eq(pickersTable.handle, handle))
    .limit(1);
  if (!picker) return null;
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      resolved: sql<number>`count(${picksTable.mbid})::int`,
    })
    .from(picksTable)
    .where(eq(picksTable.pickerId, picker.id));
  const total = counts?.total ?? 0;
  const resolved = counts?.resolved ?? 0;
  return {
    title: `${picker.name} · Lore`,
    description: `Borrow ${picker.name}'s taste: ${total} picks logged, ${resolved} resolved to the source. A real ${picker.pickerType}'s choices — never an algorithm.`,
    redirectPath: `${loreBasePath()}/archive/selectors/${encodeURIComponent(handle)}`,
    card: {
      kicker: "A human selector",
      title: picker.name,
      subtitle: picker.pickerType,
      footer: `${total} picks · ${resolved} resolved`,
    },
  };
}

export async function getPickerRunShare(
  runId: number,
): Promise<SharePayload | null> {
  const [anchor] = await db
    .select({
      pickerId: picksTable.pickerId,
      sourceUrl: picksTable.sourceUrl,
      context: picksTable.context,
      pickedAt: picksTable.pickedAt,
    })
    .from(picksTable)
    .where(eq(picksTable.id, runId))
    .limit(1);
  if (!anchor || !anchor.sourceUrl) return null;

  const [picker] = await db
    .select()
    .from(pickersTable)
    .where(eq(pickersTable.id, anchor.pickerId))
    .limit(1);
  if (!picker) return null;

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      resolved: sql<number>`count(${picksTable.mbid})::int`,
    })
    .from(picksTable)
    .where(
      and(
        eq(picksTable.pickerId, anchor.pickerId),
        eq(picksTable.sourceUrl, anchor.sourceUrl),
      ),
    );
  const total = counts?.total ?? 0;
  const resolved = counts?.resolved ?? 0;
  const runTitle = anchor.context ?? `Picked by ${picker.name}`;
  const day = anchor.pickedAt
    ? anchor.pickedAt.toISOString().slice(0, 10)
    : null;

  return {
    title: `${runTitle} — ${picker.name} · Lore`,
    description: `Ride ${picker.name}'s taste: ${total} picks in sequence, ${resolved} resolved to the source. A real human chose these — not an algorithm.`,
    redirectPath: `${loreBasePath()}/archive/selector-runs/${runId}`,
    card: {
      kicker: `Picked by ${picker.name}`,
      title: runTitle,
      subtitle: day ? `${picker.pickerType} · ${day}` : picker.pickerType,
      footer: `${total} picks · ${resolved} resolved`,
    },
  };
}

// ---- OG HTML -------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the unfurl document. `origin` must be the public origin
 * (proto://host) because OG consumers require absolute og:url/og:image.
 * `sharePath`/`cardPath` are the absolute paths of this share page and its
 * card image on the API.
 */
export function renderShareHtml(
  payload: SharePayload,
  origin: string,
  sharePath: string,
  cardPath: string,
): string {
  const title = escapeHtml(payload.title);
  const desc = escapeHtml(payload.description);
  const url = escapeHtml(`${origin}${sharePath}`);
  const image = escapeHtml(`${origin}${cardPath}`);
  const target = escapeHtml(payload.redirectPath);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lore">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0;url=${target}">
</head>
<body>
<script>location.replace(${JSON.stringify(payload.redirectPath)});</script>
<noscript><a href="${target}">Continue to Lore</a></noscript>
</body>
</html>`;
}

export function renderNotFoundHtml(): string {
  const base = escapeHtml(loreBasePath() + "/");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found · Lore</title></head>
<body style="font-family:serif;background:#12100d;color:#f5efe6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><p style="font-size:22px">This one isn't in the archive.</p>
<a style="color:#c8b895" href="${base}">Go to Lore</a></div>
</body>
</html>`;
}

// ---- Card rendering (satori → resvg) --------------------------------------

let fontsPromise: Promise<{ serif: Buffer; mono: Buffer }> | null = null;

async function loadFonts(): Promise<{ serif: Buffer; mono: Buffer }> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [
        path.resolve(here, "../../assets/fonts"),
        path.resolve(process.cwd(), "assets/fonts"),
      ];
      let lastErr: unknown;
      for (const dir of candidates) {
        try {
          const [serif, mono] = await Promise.all([
            readFile(path.join(dir, "PTSerif-Bold.ttf")),
            readFile(path.join(dir, "IBMPlexMono-Medium.ttf")),
          ]);
          return { serif, mono };
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    })();
    // A failed load must not poison future attempts (e.g. transient FS issue).
    fontsPromise.catch(() => {
      fontsPromise = null;
    });
  }
  return fontsPromise;
}

/**
 * SSRF guard for artwork URLs. Artwork URLs come from external metadata feeds
 * (i.e. attacker-influenceable), and the card endpoint fetches them
 * server-side on demand — so only public https hosts are allowed, and every
 * redirect hop is re-validated.
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts as [number, number, number, number];
    return (
      a === 0 || // "this network"
      a === 10 ||
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // ULA
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb"))
    return true; // link-local
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIp(mapped[1]);
  return false;
}

/** True when the URL is https to a public host (IP literals checked directly, hostnames via DNS). */
export async function isSafeArtworkUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dnsLookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * Best-effort fetch of artwork into a data URI satori can embed. Follows up
 * to 3 redirects (Cover Art Archive 307s to archive.org), validating every
 * hop against the SSRF guard.
 */
async function fetchArtworkDataUri(url: string): Promise<string | null> {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      if (!(await isSafeArtworkUrl(current))) return null;
      const res = await fetch(current, {
        signal: AbortSignal.timeout(4000),
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      if (!type.startsWith("image/")) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > 4_000_000) return null;
      return `data:${type};base64,${buf.toString("base64")}`;
    }
    return null;
  } catch {
    return null;
  }
}

type Node = { type: string; props: Record<string, unknown> };

function el(
  type: string,
  style: Record<string, unknown>,
  children?: Node[] | string,
  extra: Record<string, unknown> = {},
): Node {
  return { type, props: { style, children, ...extra } };
}

const INK = "#f2ead9";
const MUTED = "#c8b895";
const BG = "#14110d";
const RULE = "#3a332a";

function titleFontSize(title: string): number {
  if (title.length > 70) return 44;
  if (title.length > 40) return 56;
  return 72;
}

/** Render a 1200x630 share card PNG. */
export async function renderShareCardPng(card: ShareCard): Promise<Buffer> {
  const { serif, mono } = await loadFonts();
  const artwork = card.artworkUrl
    ? await fetchArtworkDataUri(card.artworkUrl)
    : null;

  const middleChildren: Node[] = [];
  if (artwork) {
    middleChildren.push(
      el(
        "img",
        {
          width: 220,
          height: 220,
          borderRadius: 12,
          objectFit: "cover",
          marginRight: 48,
        },
        undefined,
        { src: artwork, width: 220, height: 220 },
      ),
    );
  }
  middleChildren.push(
    el(
      "div",
      { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
      [
        el(
          "div",
          {
            fontFamily: "PT Serif",
            fontSize: titleFontSize(card.title),
            lineHeight: 1.1,
            color: INK,
            maxHeight: 240,
            overflow: "hidden",
          },
          card.title,
        ),
        el(
          "div",
          {
            fontFamily: "IBM Plex Mono",
            fontSize: 28,
            color: MUTED,
            marginTop: 24,
          },
          card.subtitle,
        ),
      ],
    ),
  );

  const root = el(
    "div",
    {
      width: 1200,
      height: 630,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: BG,
      backgroundImage:
        "radial-gradient(circle at 20% 0%, #1e1913 0%, #14110d 60%)",
      padding: 64,
      fontFamily: "PT Serif",
    },
    [
      el(
        "div",
        {
          fontFamily: "IBM Plex Mono",
          fontSize: 22,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: MUTED,
        },
        card.kicker,
      ),
      el(
        "div",
        { display: "flex", flexDirection: "row", alignItems: "center" },
        middleChildren,
      ),
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderTop: `2px solid ${RULE}`,
          paddingTop: 28,
        },
        [
          el("div", { fontFamily: "PT Serif", fontSize: 40, color: INK }, "Lore"),
          el(
            "div",
            { fontFamily: "IBM Plex Mono", fontSize: 22, color: MUTED },
            card.footer,
          ),
        ],
      ),
    ],
  );

  const svg = await satori(root as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "PT Serif", data: serif, weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: mono, weight: 500, style: "normal" },
    ],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  return Buffer.from(resvg.render().asPng());
}
