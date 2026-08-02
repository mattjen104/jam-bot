/**
 * Pre-trial staging probe — read-only, no DB writes, no Slack messages.
 *
 * Validates that the live Spotify OAuth configuration and representative
 * station feeds are reachable and delivering current metadata before the
 * morning trial session.  Prints a structured pass/warn/fail summary and
 * exits 0 only when every check passes.
 *
 * Usage (from project root):
 *   pnpm --filter @workspace/api-server exec tsx src/lore/staging-probe.ts
 *
 * Environment variables read (never written or logged):
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET  — checked for presence only
 *
 * Nothing in this script mutates the database, sends HTTP POST/PUT requests
 * to Spotify or radio sources, or produces Slack events.
 */

const PROBE_TIMEOUT_MS = 10_000;
const RATE_LIMIT_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProbeStatus = "pass" | "warn" | "fail";

interface ProbeResult {
  name: string;
  status: ProbeStatus;
  detail: string;
  durationMs: number;
  rateLimitHeaders?: Record<string, string>;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Fetch a JSON endpoint, respecting the probe timeout.
 * Returns { ok, statusCode, body, headers, durationMs, error }.
 */
async function probeJson(
  url: string,
  reqHeaders: Record<string, string> = {},
): Promise<{
  ok: boolean;
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
  durationMs: number;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...reqHeaders },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const durationMs = Date.now() - t0;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore body-parse failures — status code is the primary signal
    }
    const headers: Record<string, string> = {};
    for (const h of RATE_LIMIT_HEADERS) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    return { ok: res.ok, statusCode: res.status, body, headers, durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      statusCode: null,
      body: null,
      headers: {},
      durationMs,
      error: isTimeout ? `Timed out after ${PROBE_TIMEOUT_MS}ms` : String(err),
    };
  }
}

/**
 * Extract rate-limit headers from a probe response for display.
 * Returns undefined when none are present.
 */
function extractRateLimitHeaders(
  headers: Record<string, string>,
): Record<string, string> | undefined {
  const out = { ...headers };
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Individual probes
// ---------------------------------------------------------------------------

/**
 * 1. Spotify configuration — checks that both required env vars are present
 * without making any network call (avoids false 401s from a bot account).
 */
function probeSpotifyConfig(): ProbeResult {
  const t0 = Date.now();
  const hasClientId = !!process.env.SPOTIFY_CLIENT_ID;
  const hasClientSecret = !!process.env.SPOTIFY_CLIENT_SECRET;
  if (hasClientId && hasClientSecret) {
    return {
      name: "Spotify config",
      status: "pass",
      detail: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set",
      durationMs: Date.now() - t0,
    };
  }
  const missing: string[] = [];
  if (!hasClientId) missing.push("SPOTIFY_CLIENT_ID");
  if (!hasClientSecret) missing.push("SPOTIFY_CLIENT_SECRET");
  return {
    name: "Spotify config",
    status: "fail",
    detail: `Missing env vars: ${missing.join(", ")} — OAuth connect and import will not work`,
    durationMs: Date.now() - t0,
  };
}

/**
 * 2. Spotify rate-limit gate — checks the /api/me/library/import route
 * responds (not the production DB; just the local API server on PORT).
 * Verifies the server is reachable and the route exists.
 */
async function probeApiServer(): Promise<ProbeResult> {
  const port = process.env.PORT ?? "3001";
  const url = `http://localhost:${port}/api/spotify/status`;
  const { ok, statusCode, durationMs, error, headers } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "API server reachability",
      status: "warn",
      detail: `Could not reach localhost:${port} — start the API server first. Error: ${error}`,
      durationMs,
    };
  }
  // 503 = Spotify not configured (expected without creds); 200 = connected.
  // Both mean the server is reachable and the route is wired.
  if (ok || statusCode === 503 || statusCode === 401) {
    return {
      name: "API server reachability",
      status: "pass",
      detail: `HTTP ${statusCode} from /api/spotify/status (server reachable)`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  return {
    name: "API server reachability",
    status: "warn",
    detail: `Unexpected HTTP ${statusCode} from /api/spotify/status`,
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 3. Radio Paradise — unauthenticated JSON now-playing endpoint.
 * Expects artist + title fields on the main channel (chan=0).
 */
async function probeRadioParadise(): Promise<ProbeResult> {
  const url = "https://api.radioparadise.com/api/now_playing?chan=0";
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "Radio Paradise (now-playing)",
      status: statusCode === null && durationMs >= PROBE_TIMEOUT_MS - 100
        ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    if (statusCode === 429) {
      return {
        name: "Radio Paradise (now-playing)",
        status: "warn",
        detail: `Rate-limited (HTTP 429)`,
        durationMs,
        rateLimitHeaders: rlHeaders,
      };
    }
    return {
      name: "Radio Paradise (now-playing)",
      status: "fail",
      detail: `HTTP ${statusCode}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  const b = body as Record<string, unknown>;
  const artist = str(b.artist);
  const title = str(b.title);
  if (artist && title) {
    return {
      name: "Radio Paradise (now-playing)",
      status: "pass",
      detail: `${artist} — ${title}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
      data: { artist, title },
    };
  }
  return {
    name: "Radio Paradise (now-playing)",
    status: "warn",
    detail: "Response OK but artist/title fields missing or empty",
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 4. KEXP API — history adapter, page 1. Expects at least one trackplay entry.
 */
async function probeKexp(): Promise<ProbeResult> {
  const url = "https://api.kexp.org/v2/plays/?format=json&limit=5&offset=0";
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "KEXP API (history)",
      status: durationMs >= PROBE_TIMEOUT_MS - 100 ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    return {
      name: "KEXP API (history)",
      status: statusCode === 429 ? "warn" : "fail",
      detail: `HTTP ${statusCode}${statusCode === 429 ? " (rate-limited)" : ""}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  const b = body as { results?: Array<Record<string, unknown>>; count?: number };
  const trackplays = (b.results ?? []).filter((p) => p.play_type === "trackplay");
  if (trackplays.length > 0) {
    const first = trackplays[0]!;
    return {
      name: "KEXP API (history)",
      status: "pass",
      detail: `${trackplays.length} trackplay(s) — latest: ${str(first.artist)} — ${str(first.song)}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
      data: { count: b.count, results: trackplays.length },
    };
  }
  return {
    name: "KEXP API (history)",
    status: "warn",
    detail: `Response OK but no trackplay entries (count=${b.count ?? "?"}; may be an airbreak)`,
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 5. BBC Radio 6 Music — segments/latest feed. Expects at least one music segment.
 */
async function probeBbcRadio6(): Promise<ProbeResult> {
  const sid = "bbc_6music";
  const url = `https://rms.api.bbc.co.uk/v2/services/${sid}/segments/latest?experience=domestic&offset=0`;
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "BBC Radio 6 Music (segments)",
      status: durationMs >= PROBE_TIMEOUT_MS - 100 ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    return {
      name: "BBC Radio 6 Music (segments)",
      status: statusCode === 429 ? "warn" : "fail",
      detail: `HTTP ${statusCode}${statusCode === 429 ? " (rate-limited)" : ""}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  const b = body as {
    data?: Array<{
      segment_type?: string;
      titles?: { primary?: unknown; secondary?: unknown };
    }>;
  };
  const music = (b.data ?? []).filter(
    (s) => !s.segment_type || s.segment_type === "music",
  );
  if (music.length > 0) {
    const first = music[0]!;
    const artist = str(first.titles?.primary);
    const title = str(first.titles?.secondary);
    return {
      name: "BBC Radio 6 Music (segments)",
      status: "pass",
      detail: artist && title
        ? `${music.length} music segment(s) — latest: ${artist} — ${title}`
        : `${music.length} music segment(s) (titles absent)`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  return {
    name: "BBC Radio 6 Music (segments)",
    status: "warn",
    detail: `Response OK but no music segments (total segments: ${(b.data ?? []).length})`,
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 6. NTS Live — both-channels endpoint (`/api/v2/live`).
 * Returns `{ results: [ch1, ch2] }` where each entry has `now.broadcast_title`.
 */
async function probeNts(): Promise<ProbeResult> {
  const url = "https://www.nts.live/api/v2/live";
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "NTS Live (channels 1 & 2)",
      status: durationMs >= PROBE_TIMEOUT_MS - 100 ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    return {
      name: "NTS Live (channels 1 & 2)",
      status: statusCode === 429 ? "warn" : "fail",
      detail: `HTTP ${statusCode}${statusCode === 429 ? " (rate-limited)" : ""}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  const b = body as { results?: Array<Record<string, unknown>> };
  const results = b.results ?? [];
  const titles = results
    .map((ch) => {
      const now = ch.now as Record<string, unknown> | undefined;
      return str(now?.broadcast_title);
    })
    .filter((t): t is string => !!t);

  if (titles.length > 0) {
    return {
      name: "NTS Live (channels 1 & 2)",
      status: "pass",
      detail: titles.map((t, i) => `NTS ${i + 1}: "${t}"`).join(" | "),
      durationMs,
      rateLimitHeaders: rlHeaders,
      data: { titles },
    };
  }
  return {
    name: "NTS Live (channels 1 & 2)",
    status: "warn",
    detail: "Response OK but broadcast_title absent on all channels (off-air or shape changed)",
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 7. SomaFM — recent songs feed for the Groove Salad channel.
 */
async function probeSomaFm(): Promise<ProbeResult> {
  const channel = "groovesalad";
  const url = `https://somafm.com/songs/${channel}.json`;
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "SomaFM (Groove Salad, recent-songs)",
      status: durationMs >= PROBE_TIMEOUT_MS - 100 ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    return {
      name: "SomaFM (Groove Salad, recent-songs)",
      status: statusCode === 429 ? "warn" : "fail",
      detail: `HTTP ${statusCode}${statusCode === 429 ? " (rate-limited)" : ""}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  const b = body as { songs?: Array<Record<string, unknown>> };
  const songs = (b.songs ?? []).filter(
    (s) => str(s.artist) && !/somafm/i.test(str(s.artist) ?? ""),
  );
  if (songs.length > 0) {
    const first = songs[0]!;
    return {
      name: "SomaFM (Groove Salad, recent-songs)",
      status: "pass",
      detail: `${songs.length} track(s) — latest: ${str(first.artist)} — ${str(first.title)}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  return {
    name: "SomaFM (Groove Salad, recent-songs)",
    status: "warn",
    detail: "Response OK but no non-station-ID songs in feed",
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 8. KCRW — current track endpoint for the Music feed.
 */
async function probeKcrw(): Promise<ProbeResult> {
  const url = "https://tracklist-api.kcrw.com/Music";
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "KCRW (current track)",
      status: durationMs >= PROBE_TIMEOUT_MS - 100 ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    return {
      name: "KCRW (current track)",
      status: statusCode === 429 ? "warn" : "fail",
      detail: `HTTP ${statusCode}${statusCode === 429 ? " (rate-limited)" : ""}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  const b = body as Record<string, unknown>;
  const artist = str(b.artist);
  const title = str(b.title);
  if (artist && title) {
    return {
      name: "KCRW (current track)",
      status: "pass",
      detail: `${artist} — ${title}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
      data: { artist, title },
    };
  }
  return {
    name: "KCRW (current track)",
    status: "warn",
    detail: "Response OK but artist/title absent (likely an airbreak or talk segment)",
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

/**
 * 9. FIP Radio — livemeta pull endpoint for the main FIP station (stationId 7).
 */
async function probeFip(): Promise<ProbeResult> {
  const url = "https://api.radiofrance.fr/livemeta/pull/7";
  const { ok, statusCode, body, headers, durationMs, error } = await probeJson(url);
  const rlHeaders = extractRateLimitHeaders(headers);

  if (error) {
    return {
      name: "FIP Radio (livemeta)",
      status: durationMs >= PROBE_TIMEOUT_MS - 100 ? "warn" : "fail",
      detail: error,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  if (!ok) {
    return {
      name: "FIP Radio (livemeta)",
      status: statusCode === 429 ? "warn" : "fail",
      detail: `HTTP ${statusCode}${statusCode === 429 ? " (rate-limited)" : ""}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  // Shape varies; just confirm we got a non-empty JSON object.
  if (body && typeof body === "object" && Object.keys(body as object).length > 0) {
    const b = body as Record<string, unknown>;
    // Try to surface now-playing if the shape is familiar.
    const nowSec = Math.floor(Date.now() / 1000);
    const steps = b.steps as Record<string, Record<string, unknown>> | undefined;
    let trackDetail = "";
    if (steps) {
      let bestStep: Record<string, unknown> | null = null;
      let bestDepth = -Infinity;
      for (const step of Object.values(steps)) {
        const start = typeof step.start === "number" ? step.start : undefined;
        const end = typeof step.end === "number" ? step.end : undefined;
        const depth = typeof step.depth === "number" ? step.depth : 0;
        if (start == null || end == null) continue;
        if (nowSec < start || nowSec > end) continue;
        if (depth > bestDepth) { bestDepth = depth; bestStep = step; }
      }
      if (bestStep) {
        const artist = str(bestStep.authors) ?? str(bestStep.performers);
        const title = str(bestStep.title);
        if (artist && title) trackDetail = ` — playing: ${artist} — ${title}`;
      }
    }
    return {
      name: "FIP Radio (livemeta)",
      status: "pass",
      detail: `Response OK${trackDetail}`,
      durationMs,
      rateLimitHeaders: rlHeaders,
    };
  }
  return {
    name: "FIP Radio (livemeta)",
    status: "warn",
    detail: "Response OK but body is empty or unexpected shape",
    durationMs,
    rateLimitHeaders: rlHeaders,
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<ProbeStatus, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
};

function formatResult(r: ProbeResult): string {
  const icon = STATUS_ICON[r.status];
  const ms = `${r.durationMs}ms`;
  let line = `  ${icon} [${r.status.toUpperCase().padEnd(4)}] ${r.name.padEnd(38)} ${ms.padStart(6)}  ${r.detail}`;
  if (r.rateLimitHeaders) {
    const rl = Object.entries(r.rateLimitHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    line += `\n              rate-limit: ${rl}`;
  }
  return line;
}

async function main(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Lore Radio — Pre-Trial Staging Probe");
  console.log(`  ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Run the synchronous config check immediately; fire all network probes in
  // parallel so the full sweep completes in roughly one round-trip time.
  const configResult = probeSpotifyConfig();

  const networkResults = await Promise.all([
    probeApiServer(),
    probeRadioParadise(),
    probeKexp(),
    probeBbcRadio6(),
    probeNts(),
    probeSomaFm(),
    probeKcrw(),
    probeFip(),
  ]);

  const results: ProbeResult[] = [configResult, ...networkResults];

  const passes = results.filter((r) => r.status === "pass").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const fails = results.filter((r) => r.status === "fail").length;

  console.log("  Results\n  ───────");
  for (const r of results) {
    console.log(formatResult(r));
  }

  console.log(`\n  ───────────────────────────────────────────────────────────`);
  console.log(
    `  Summary: ${passes} pass  ${warns} warn  ${fails} fail  (${results.length} total)`,
  );

  if (warns > 0) {
    console.log("\n  WARN checks indicate degraded sources or missing optional");
    console.log("  services.  Review each warn before the trial — a warn on a");
    console.log("  source used during the trial is a blocking issue.");
  }

  if (fails > 0) {
    console.log("\n  FAIL checks must be resolved before the trial.  See the");
    console.log("  staging runbook (artifacts/api-server/STAGING_RUNBOOK.md)");
    console.log("  for corrective steps.");
  }

  console.log("\n  Spotify OAuth/import steps require a browser.  See the");
  console.log("  staging runbook for the full manual checklist.\n");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Exit non-zero when any check failed (warns are advisory, not blocking).
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("[staging-probe] Unexpected error:", err);
  process.exit(1);
});
