/**
 * CRI Discovery Script
 *
 * Scrapes all stations from community-radio-index.com, cross-references
 * them against Radio Browser for stream URLs, tests ICY now-playing headers,
 * and writes results to the cri_candidates table.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/lore/cri-discovery.ts
 *
 * Results land in the `cri_candidates` table. Query candidates:
 *   SELECT name, city, country, genres, stream_url, icy_status
 *   FROM cri_candidates
 *   WHERE already_in_lore = false AND icy_status = 'yes'
 *   ORDER BY name;
 */

import { db, criCandidatesTable, stationsTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";

const CRI_BASE = "https://www.community-radio-index.com";
const RB_API = "https://de1.api.radio-browser.info/json";

const CONCURRENCY = 4;
const SITEMAP_TIMEOUT_MS = 15_000;
const PAGE_TIMEOUT_MS = 10_000;
const STREAM_TIMEOUT_MS = 8_000;

// ────────────────────────────────────────────────────────────
// Sitemap fetch — returns all CRI station slugs
// ────────────────────────────────────────────────────────────
async function getCriSlugs(): Promise<string[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SITEMAP_TIMEOUT_MS);
  try {
    const res = await fetch(`${CRI_BASE}/sitemap.xml`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`);
    const xml = await res.text();
    const matches = [...xml.matchAll(/\/stations\/([^<\s]+)/g)];
    return matches.map((m) => m[1]!);
  } finally {
    clearTimeout(t);
  }
}

// ────────────────────────────────────────────────────────────
// CRI station page scraper
// ────────────────────────────────────────────────────────────
interface CriStationMeta {
  name: string;
  city: string | null;
  country: string | null;
  genres: string[];
  websiteUrl: string | null;
}

async function scrapeCriStation(slug: string): Promise<CriStationMeta | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${CRI_BASE}/stations/${slug}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Lore-Radio-Discovery/1.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Name — <h1>NTS RADIO</h1> style, title-cased
    const nameMatch = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i);
    const name = nameMatch?.[1]?.trim() ?? slug;

    // Location — "London, <a href="/stations?country=UK">UK</a>"
    // CRI renders city as plain text before a comma, country in a link
    const locationMatch = html.match(/([A-Za-z\s\-\.]+),\s*<a[^>]*>([^<]+)<\/a>/);
    const city = locationMatch?.[1]?.trim() ?? null;
    const country = locationMatch?.[2]?.trim() ?? null;

    // Genres — uppercased, slash-separated, e.g. "EXPERIMENTAL / JAZZ / CLUB"
    const genreMatch = html.match(/([A-Z][A-Z\s]+(?:\s*\/\s*[A-Z][A-Z\s]+)+)/);
    const genres =
      genreMatch?.[1]
        ?.split("/")
        .map((g) => g.trim().toLowerCase())
        .filter((g) => g.length > 1 && g.length < 40) ?? [];

    // Website link — the "WEBSITE" anchor
    const websiteMatch = html.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*(?:WEBSITE|Website)/i);
    const websiteUrl = websiteMatch?.[1] ?? null;

    return { name, city, country, genres, websiteUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ────────────────────────────────────────────────────────────
// Radio Browser stream lookup
// ────────────────────────────────────────────────────────────
interface RbStation {
  url_resolved?: string;
  url?: string;
  votes?: number;
  lastcheckok?: number;
  bitrate?: number;
}

async function findStreamUrl(name: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      name,
      limit: "5",
      hidebroken: "true",
      order: "votes",
    });
    const res = await fetch(`${RB_API}/stations/search?${params}`, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Lore-Radio-Discovery/1.0",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const stations = (await res.json()) as RbStation[];
    if (!Array.isArray(stations) || stations.length === 0) return null;
    // Prefer stations with a good bitrate and lastcheckok
    const best = stations.find((s) => s.lastcheckok === 1 && (s.bitrate ?? 0) >= 128)
      ?? stations[0];
    return best?.url_resolved ?? best?.url ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ────────────────────────────────────────────────────────────
// ICY metadata probe
// ────────────────────────────────────────────────────────────
async function testIcyStream(url: string): Promise<"yes" | "no" | "unknown"> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), STREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Icy-MetaData": "1" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    // Check for ICY headers — if present the stream pushes now-playing metadata
    const hasIcy =
      res.headers.has("icy-metaint") ||
      res.headers.has("icy-name") ||
      res.headers.has("icy-title");
    return hasIcy ? "yes" : "no";
  } catch {
    clearTimeout(t);
    return "unknown";
  }
}

// ────────────────────────────────────────────────────────────
// Lore DB cross-reference
// ────────────────────────────────────────────────────────────
async function isAlreadyInLore(name: string): Promise<boolean> {
  const rows = await db
    .select({ id: stationsTable.id })
    .from(stationsTable)
    .where(ilike(stationsTable.name, `%${name.replace(/%/g, "").trim()}%`))
    .limit(1);
  return rows.length > 0;
}

// ────────────────────────────────────────────────────────────
// Concurrency helper — runs tasks CONCURRENCY at a time
// ────────────────────────────────────────────────────────────
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]!();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Fetching CRI sitemap…");
  const slugs = await getCriSlugs();
  console.log(`   Found ${slugs.length} station slugs\n`);

  let done = 0;
  let skipped = 0;
  let errors = 0;

  const tasks = slugs.map((slug) => async () => {
    try {
      // 1. Scrape CRI page
      const meta = await scrapeCriStation(slug);
      if (!meta) {
        errors++;
        console.log(`  ✗ ${slug} — page not found`);
        return;
      }

      // 2. Radio Browser lookup
      const streamUrl = await findStreamUrl(meta.name);

      // 3. ICY probe
      let icyStatus: "yes" | "no" | "unknown" = "unknown";
      if (streamUrl) {
        icyStatus = await testIcyStream(streamUrl);
      }

      // 4. Lore cross-reference
      const alreadyInLore = await isAlreadyInLore(meta.name);
      if (alreadyInLore) skipped++;

      // 5. Upsert into cri_candidates
      await db
        .insert(criCandidatesTable)
        .values({
          criSlug: slug,
          name: meta.name,
          city: meta.city,
          country: meta.country,
          genres: meta.genres.length ? meta.genres : null,
          websiteUrl: meta.websiteUrl,
          streamUrl,
          icyStatus,
          alreadyInLore,
          checkedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: criCandidatesTable.criSlug,
          set: {
            name: meta.name,
            city: meta.city,
            country: meta.country,
            genres: meta.genres.length ? meta.genres : null,
            websiteUrl: meta.websiteUrl,
            streamUrl,
            icyStatus,
            alreadyInLore,
            checkedAt: new Date(),
          },
        });

      const status =
        alreadyInLore
          ? "already in Lore"
          : icyStatus === "yes"
            ? "✅ ICY ready"
            : icyStatus === "no"
              ? "stream found (no ICY)"
              : streamUrl
                ? "stream found (ICY unknown)"
                : "no stream found";

      console.log(`  ${done + 1}/${slugs.length} ${meta.name} [${meta.city ?? "?"}${meta.country ? ", " + meta.country : ""}] — ${status}`);
      done++;
    } catch (err) {
      errors++;
      console.log(`  ✗ ${slug} — ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await runWithConcurrency(tasks, CONCURRENCY);

  // ── Summary ──────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Done. ${done} processed, ${errors} errors.\n`);

  const results = await db
    .select({
      icyStatus: criCandidatesTable.icyStatus,
      alreadyInLore: criCandidatesTable.alreadyInLore,
      streamUrl: criCandidatesTable.streamUrl,
    })
    .from(criCandidatesTable);

  const icyReady = results.filter((r) => r.icyStatus === "yes" && !r.alreadyInLore).length;
  const streamOnly = results.filter((r) => r.icyStatus === "no" && !r.alreadyInLore).length;
  const noStream = results.filter((r) => r.streamUrl === null && !r.alreadyInLore).length;
  const alreadyIn = results.filter((r) => r.alreadyInLore).length;

  console.log("Results:");
  console.log(`  ✅ ICY-ready new stations : ${icyReady}`);
  console.log(`  〰  Stream found (no ICY)  : ${streamOnly}`);
  console.log(`  ✗  No stream found        : ${noStream}`);
  console.log(`  ↩  Already in Lore        : ${alreadyIn}`);
  console.log(`\nQuery new ICY-ready candidates:`);
  console.log(
    `  SELECT name, city, country, genres, stream_url FROM cri_candidates WHERE already_in_lore = false AND icy_status = 'yes' ORDER BY name;`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
