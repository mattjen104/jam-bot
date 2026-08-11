/**
 * stream-relay.ts — server-side HTTPS relay for HTTP-only Icecast stations.
 *
 * Problem: browsers running Lore over HTTPS block plain-HTTP audio streams as
 * mixed content. Several curated college-radio stations only serve audio over
 * http:// (Icecast port 8000). This module opens one upstream TCP connection
 * per active station, fans the raw bytes out to every listener currently tuned
 * in, and exposes a single https:// endpoint the browser can use.
 *
 * Design decisions:
 *  - One upstream connection per station (fan-out, not per-listener tunnelling).
 *  - Upstream tears down when the last listener disconnects.
 *  - Exponential back-off (5s → 300s cap) on upstream error; if the upstream
 *    is unreachable at relay-open time (before any bytes arrive), we fail fast
 *    (503) rather than waiting for a reconnect.
 *  - Listener cap per relay session (RELAY_LISTENER_CAP = 50).
 *  - ICY headers (Content-Type, icy-metaint, icy-name, icy-genre, etc.) are
 *    passed through to the browser so the existing now-playing pipeline works.
 *  - SSRF guard: the upstream URL comes from the DB, not the client, but we
 *    still validate it is HTTP (not HTTPS) and that the station slug is in the
 *    explicit STREAM_RELAY_ALLOWLIST before opening any connection.
 */

import * as http from "node:http";
import * as net from "node:net";
import type { Response } from "express";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RELAY_LISTENER_CAP = 50;
const BACKOFF_FLOOR_MS = 5_000;
const BACKOFF_CAP_MS = 300_000;
/** Per-listener write-buffer cap. A client that stops reading makes Node
 *  buffer every subsequent `res.write()` in user-space memory without bound —
 *  an externally triggerable memory-exhaustion vector. 512 KiB is ~30s of
 *  128 kbps audio; any listener that far behind live is unrecoverable anyway,
 *  so it is evicted (socket destroyed) instead of buffered further. */
export const MAX_LISTENER_BUFFER_BYTES = 512 * 1024;
/** If no upstream bytes arrive within this window the connection is considered
 *  stalled and the relay tears down (listeners receive EOS). */
const STALL_WATCHDOG_MS = 30_000;

// ---------------------------------------------------------------------------
// Station allow-list
//
// Only slugs in this set may be relayed. The URL comes from the DB, but the
// slug must still be on this list so a compromised DB row cannot turn the
// relay into a general SSRF proxy.
//
// Seeded with the curated stations named in the relay plan. Slugs whose seed
// streamUrl turned out to be HTTPS (or empty) are harmless here — toStation()
// only emits a relayUrl when the stored streamUrl is actually http://, and
// attachListener() re-validates the URL protocol before connecting.
// ---------------------------------------------------------------------------

export const STREAM_RELAY_ALLOWLIST: ReadonlySet<string> = new Set([
  // US freeform cohort 1
  "whpk",  // University of Chicago (HTTPS as of 2026-08 — relay is fallback)
  "wesu",  // Wesleyan University (stream currently unreachable; empty seed)
  "wzbc",  // Boston College (HTTPS as of 2026-08 — relay is fallback)
  "wrct",  // Carnegie Mellon University (HTTPS as of 2026-08)
  "wbrs",  // Brandeis University (stream currently unreachable; empty seed)
  "wmfo",  // Tufts University (HTTP-only Shoutcast)
  "wxdu",  // Duke University (HTTP-only Icecast)
  "wrir",  // Richmond Independent Radio (stream currently unreachable)
  "wicb",  // Ithaca College (HTTPS as of 2026-08)
  // Canadian campus stations (HTTP-only Icecast)
  "chmr",  // Memorial University of Newfoundland
  "cism",  // Université de Montréal
  "cjsr",  // University of Alberta
  "ckut",  // McGill University
]);

// ---------------------------------------------------------------------------
// RelaySession
// ---------------------------------------------------------------------------

interface RelaySession {
  /** Slug this session is for. */
  slug: string;
  /** HTTP-only upstream URL. */
  upstreamUrl: string;
  /** All currently-connected client response streams. */
  listeners: Set<Response>;
  /** Buffered ICY response headers from the upstream (passed to late joiners). */
  icyHeaders: Record<string, string>;
  /** Whether we have received at least the upstream response headers. */
  connected: boolean;
  /** Whether tear-down is in progress (prevent double-teardown races). */
  closing: boolean;
  /** Back-off state. */
  backoffMs: number;
  /** Reconnect timer handle. */
  reconnectTimer: NodeJS.Timeout | null;
  /** Stall watchdog timer handle. */
  watchdogTimer: NodeJS.Timeout | null;
  /** The live upstream request (kept so we can abort it on teardown). */
  upstreamReq: http.ClientRequest | null;
  /** Whether the upstream has EVER produced response headers. Until it has,
   *  a connect failure fails fast (503 to waiting listeners) instead of
   *  entering the reconnect loop — "missing upstream" must be an explicit
   *  error, not an endless silent wait. */
  everConnected: boolean;
  /** Listeners awaiting the first (re)connect outcome. Resolved true when
   *  upstream headers arrive, false when the session dies first. */
  waiters: Array<(ok: boolean) => void>;
  /** Attaches in flight: incremented before awaiting the connect outcome,
   *  decremented once the listener is added (or the attach fails). Guards the
   *  idle-teardown checks — waiters are flushed in the same macrotask that
   *  can also deliver the first "data" event, before the awaiting attaches'
   *  microtasks have run, so `waiters.length` alone can read zero while
   *  listeners are still on their way in. */
  pendingAttaches: number;
}

/** Active relay sessions keyed by station slug. */
const sessions = new Map<string, RelaySession>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function armWatchdog(session: RelaySession): void {
  clearWatchdog(session);
  session.watchdogTimer = setTimeout(() => {
    console.warn(`[relay] ${session.slug}: upstream stalled (no bytes for ${STALL_WATCHDOG_MS / 1000}s), tearing down`);
    teardown(session, "watchdog");
  }, STALL_WATCHDOG_MS);
}

function clearWatchdog(session: RelaySession): void {
  if (session.watchdogTimer) {
    clearTimeout(session.watchdogTimer);
    session.watchdogTimer = null;
  }
}

function clearReconnect(session: RelaySession): void {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
}

/** Evict a listener that can no longer keep up: remove it from the fan-out
 *  set and destroy its response so no further bytes are buffered for it.
 *  The listener's "close" handler performs the usual empty-session check,
 *  but run it here too in case the destroy is swallowed. */
function evictListener(session: RelaySession, res: Response, reason: string): void {
  session.listeners.delete(res);
  console.warn(`[relay] ${session.slug}: evicting listener (${reason}; ${session.listeners.size} remaining)`);
  try {
    res.destroy();
  } catch { /* already gone */ }
  if (session.listeners.size === 0 && session.pendingAttaches === 0 && !session.closing) {
    teardown(session, "all listeners gone after eviction");
  }
}

/** Broadcast a raw Buffer to every listener. Listeners that have errored are
 *  silently dropped (they will be cleaned up via the "close" event).
 *
 *  Backpressure: `res.write()` returning false is fine transiently (live
 *  audio outpaces a momentarily slow socket), but a client that stops
 *  reading altogether would let Node buffer the stream in memory without
 *  bound. Any listener whose buffered bytes exceed MAX_LISTENER_BUFFER_BYTES
 *  is evicted before the next write, bounding per-listener memory. */
function broadcast(session: RelaySession, chunk: Buffer): void {
  for (const res of session.listeners) {
    try {
      if (res.writableLength > MAX_LISTENER_BUFFER_BYTES) {
        evictListener(session, res, `write buffer over ${MAX_LISTENER_BUFFER_BYTES} bytes`);
        continue;
      }
      res.write(chunk);
    } catch {
      // The listener disconnected between the Set snapshot and the write.
      // The "close" handler on its socket will clean it up.
    }
  }
}

/** Resolve (and clear) all pending first-connect waiters. */
function flushWaiters(session: RelaySession, ok: boolean): void {
  const waiters = session.waiters;
  session.waiters = [];
  for (const resolve of waiters) resolve(ok);
}

/** End all listener responses cleanly and drop the session. */
function teardown(session: RelaySession, reason: string): void {
  if (session.closing) return;
  session.closing = true;

  clearWatchdog(session);
  clearReconnect(session);
  flushWaiters(session, false);

  if (session.upstreamReq) {
    try { session.upstreamReq.destroy(); } catch { /* ignore */ }
    session.upstreamReq = null;
  }

  for (const res of session.listeners) {
    try { res.end(); } catch { /* ignore */ }
  }
  session.listeners.clear();

  sessions.delete(session.slug);
  console.log(`[relay] ${session.slug}: session ended (${reason})`);
}

/** Open a new upstream connection for `session`. */
function connectUpstream(session: RelaySession): void {
  if (session.closing) return;

  let url: URL;
  try {
    url = new URL(session.upstreamUrl);
  } catch {
    console.error(`[relay] ${session.slug}: invalid upstream URL`);
    teardown(session, "invalid URL");
    return;
  }

  if (url.protocol !== "http:") {
    console.error(`[relay] ${session.slug}: upstream must be http:, got ${url.protocol}`);
    teardown(session, "not http");
    return;
  }

  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname + url.search,
    method: "GET",
    headers: {
      "Icy-MetaData": "1",
      "User-Agent": "Lore-Relay/1.0",
      "Connection": "close",
    },
  };

  const req = http.request(options, (upstreamRes) => {
    // Validate it looks like an audio stream (2xx or some Icecast-specific codes).
    const status = upstreamRes.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      console.warn(`[relay] ${session.slug}: upstream returned HTTP ${status}`);
      upstreamRes.destroy();
      scheduleReconnect(session, `upstream HTTP ${status}`);
      return;
    }

    // Capture ICY / audio headers to pass to listeners.
    const allowed = [
      "content-type",
      "icy-metaint",
      "icy-name",
      "icy-genre",
      "icy-url",
      "icy-br",
      "icy-sr",
      "icy-pub",
      "icy-audio-info",
    ];
    const icyHeaders: Record<string, string> = {};
    for (const key of allowed) {
      const val = upstreamRes.headers[key];
      if (typeof val === "string") icyHeaders[key] = val;
    }
    session.icyHeaders = icyHeaders;
    session.connected = true;
    session.everConnected = true;
    session.backoffMs = BACKOFF_FLOOR_MS; // reset back-off on successful connect

    // Wake listeners waiting on the first connect — attachListener sends
    // their ICY headers and adds them to the fan-out set. The first "data"
    // event can fire before those microtasks run, so a joining listener may
    // miss the very first chunk — harmless for live radio, where every
    // listener joins mid-stream by definition.
    flushWaiters(session, true);

    armWatchdog(session);

    upstreamRes.on("data", (chunk: Buffer) => {
      armWatchdog(session);
      if (session.listeners.size === 0 && session.pendingAttaches === 0) {
        // All listeners dropped while we were reading — tear down.
        upstreamRes.destroy();
        teardown(session, "all listeners disconnected");
        return;
      }
      broadcast(session, chunk);
    });

    upstreamRes.on("end", () => {
      clearWatchdog(session);
      console.log(`[relay] ${session.slug}: upstream ended stream`);
      // Upstream closed cleanly — reconnect if listeners remain.
      if (session.listeners.size > 0) {
        scheduleReconnect(session, "upstream ended");
      } else {
        teardown(session, "upstream ended, no listeners");
      }
    });

    upstreamRes.on("error", (err) => {
      clearWatchdog(session);
      scheduleReconnect(session, `upstream response error: ${err.message}`);
    });
  });

  req.on("error", (err) => {
    clearWatchdog(session);
    scheduleReconnect(session, `upstream request error: ${err.message}`);
  });

  req.setTimeout(15_000, () => {
    req.destroy(new Error("connect timeout"));
  });

  req.end();
  session.upstreamReq = req;
}

function scheduleReconnect(session: RelaySession, reason: string): void {
  if (session.closing) return;

  // Fail fast when the upstream never produced headers: waiting listeners
  // get an explicit 503 rather than an endless silent reconnect loop.
  if (!session.everConnected) {
    console.warn(`[relay] ${session.slug}: first connect failed (${reason})`);
    teardown(session, `first connect failed: ${reason}`);
    return;
  }

  if (session.listeners.size === 0 && session.pendingAttaches === 0) {
    teardown(session, `${reason} (no listeners left to reconnect for)`);
    return;
  }

  // Abort the current upstream request if still live.
  if (session.upstreamReq) {
    try { session.upstreamReq.destroy(); } catch { /* ignore */ }
    session.upstreamReq = null;
  }

  session.connected = false;

  console.warn(`[relay] ${session.slug}: ${reason}; reconnecting in ${Math.round(session.backoffMs / 1000)}s`);
  clearReconnect(session);
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    connectUpstream(session);
  }, session.backoffMs);
  session.backoffMs = Math.min(session.backoffMs * 2, BACKOFF_CAP_MS);
}

/** Write ICY-compatible headers to a listener response. Called once per listener. */
function sendIcyHeaders(res: Response, icyHeaders: Record<string, string>): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (icyHeaders["content-type"]) {
    res.setHeader("Content-Type", icyHeaders["content-type"]);
  } else {
    res.setHeader("Content-Type", "audio/mpeg");
  }
  for (const [k, v] of Object.entries(icyHeaders)) {
    if (k !== "content-type") res.setHeader(k, v);
  }
  // Keep the TCP socket alive for streaming (no idle timeout from Node's http).
  res.socket?.setTimeout(0);
  res.status(200);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when `slug` is in the relay allow-list.
 */
export function isRelayAllowed(slug: string): boolean {
  return STREAM_RELAY_ALLOWLIST.has(slug);
}

/**
 * Returns the relay URL path for a station slug.
 * Does NOT check the allow-list — callers must check `isRelayAllowed` first.
 */
export function relayUrlPath(slug: string): string {
  return `/api/stations/${slug}/relay`;
}

export type RelayResult =
  | { kind: "ok" }
  | { kind: "not_allowed" }
  | { kind: "no_stream_url" }
  | { kind: "cap_exceeded" }
  | { kind: "upstream_unavailable" };

/**
 * Attach a listener (Express `res`) to the relay for `slug`.
 *
 * The caller must ensure:
 *  - `slug` is in STREAM_RELAY_ALLOWLIST
 *  - `streamUrl` is the DB value for this station (starts with "http://")
 *
 * This function takes ownership of `res` on success and will call `res.end()`
 * when the upstream terminates or the listener disconnects.
 *
 * Resolves `{ kind: "ok" }` once the upstream is connected and ICY headers
 * have been written to `res`. Resolves `{ kind: "upstream_unavailable" }`
 * when the upstream cannot be reached (the caller sends a 503 — `res` has
 * not been written to in that case).
 */
export async function attachListener(
  slug: string,
  streamUrl: string,
  res: Response,
): Promise<RelayResult> {
  if (!STREAM_RELAY_ALLOWLIST.has(slug)) return { kind: "not_allowed" };
  if (!streamUrl || !streamUrl.startsWith("http://")) return { kind: "no_stream_url" };

  // The URL comes from the DB (never the client), but still reject obvious
  // private/loopback hosts so a bad DB row cannot aim the relay inward.
  let upstreamHost: string;
  try {
    upstreamHost = new URL(streamUrl).hostname;
  } catch {
    return { kind: "no_stream_url" };
  }
  if (!upstreamHost) return { kind: "no_stream_url" };
  if (!allowPrivateUpstreamForTests && isPrivateHost(upstreamHost)) {
    return { kind: "no_stream_url" };
  }

  // Get or create a relay session.
  let session = sessions.get(slug);

  if (!session) {
    session = {
      slug,
      upstreamUrl: streamUrl,
      listeners: new Set(),
      icyHeaders: {},
      connected: false,
      closing: false,
      backoffMs: BACKOFF_FLOOR_MS,
      reconnectTimer: null,
      watchdogTimer: null,
      upstreamReq: null,
      everConnected: false,
      waiters: [],
      pendingAttaches: 0,
    };
    sessions.set(slug, session);
    // Start the upstream connection; waiters below observe the outcome.
    connectUpstream(session);
  }

  // Listener cap (count pending attaches too, so a connect stampede cannot
  // overshoot the cap while the upstream is still handshaking).
  if (session.listeners.size + session.pendingAttaches >= RELAY_LISTENER_CAP) {
    return { kind: "cap_exceeded" };
  }

  session.pendingAttaches++;
  try {
    // Wait for upstream headers if this session has not connected yet.
    if (!session.connected) {
      const ok = await new Promise<boolean>((resolve) => {
        session.waiters.push(resolve);
      });
      if (!ok) return { kind: "upstream_unavailable" };
      // Session may have been replaced/torn down while waiting.
      if (sessions.get(slug) !== session || session.closing) {
        return { kind: "upstream_unavailable" };
      }
    }

    sendIcyHeaders(res, session.icyHeaders);
    session.listeners.add(res);
  } finally {
    session.pendingAttaches--;
  }
  console.log(`[relay] ${slug}: listener attached (${session.listeners.size}/${RELAY_LISTENER_CAP})`);

  // Clean up when the client disconnects.
  res.on("close", () => {
    session.listeners.delete(res);
    console.log(`[relay] ${slug}: listener left (${session.listeners.size} remaining)`);
    if (session.listeners.size === 0 && session.pendingAttaches === 0 && !session.closing) {
      teardown(session, "all listeners gone");
    }
  });

  // Prevent Express from automatically finishing the response.
  res.socket?.setKeepAlive(true);

  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// Lightweight private-IP guard for the upstream hostname.
// This mirrors the isPrivateIp() guard in share.ts but works synchronously
// on the hostname string (no DNS lookup needed — we just reject obvious
// RFC-1918 and loopback literals; station URLs from the DB should be FQDNs).
// ---------------------------------------------------------------------------

function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  if (net.isIPv4(host)) {
    const parts = host.split(".").map(Number);
    const [a, b] = parts as [number, number, number, number];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = lower;
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

/** Number of active relay sessions (test/diagnostic use). */
export function activeSessionCount(): number {
  return sessions.size;
}

/** Listener count for a slug's session, or 0 when no session exists. */
export function listenerCount(slug: string): number {
  return sessions.get(slug)?.listeners.size ?? 0;
}

let allowPrivateUpstreamForTests = false;

/** Test seam: allow 127.0.0.1 upstreams so unit tests can run a local mock
 *  Icecast server. Never call outside tests. */
export function __setAllowPrivateUpstreamForTests(allow: boolean): void {
  allowPrivateUpstreamForTests = allow;
}

/** Test seam: force-teardown every active session (test isolation). */
export function __teardownAllForTests(): void {
  for (const session of [...sessions.values()]) {
    teardown(session, "test teardown");
  }
}
