// Unit tests for the HTTP→HTTPS stream relay (lore/stream-relay.ts).
//
// A local mock Icecast server on 127.0.0.1 plays the upstream role; the
// private-upstream test seam is enabled so the SSRF guard allows loopback
// during these tests only. Listener responses are exercised with a minimal
// Express-Response-shaped stub so no real HTTP server is needed on the
// listener side.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as http from "node:http";
import { EventEmitter } from "node:events";
import {
  STREAM_RELAY_ALLOWLIST,
  RELAY_LISTENER_CAP,
  MAX_LISTENER_BUFFER_BYTES,
  isRelayAllowed,
  relayUrlPath,
  attachListener,
  activeSessionCount,
  listenerCount,
  __setAllowPrivateUpstreamForTests,
  __teardownAllForTests,
} from "../src/lore/stream-relay.js";
import type { Response } from "express";

// ── Mock listener (Express Response stand-in) ────────────────────────────

interface MockListener {
  res: Response;
  headers: Record<string, string>;
  chunks: Buffer[];
  ended: boolean;
  destroyed: boolean;
  statusCode: number | null;
  /** Simulated Node write-buffer size (bytes not yet drained by the client). */
  bufferedBytes: number;
  /** When true, writes accumulate in bufferedBytes — a client that stopped reading. */
  stopDraining: boolean;
  emitter: EventEmitter;
  disconnect: () => void;
}

function makeListener(): MockListener {
  const emitter = new EventEmitter();
  const listener: MockListener = {
    headers: {},
    chunks: [],
    ended: false,
    destroyed: false,
    statusCode: null,
    bufferedBytes: 0,
    stopDraining: false,
    emitter,
    res: null as unknown as Response,
    disconnect: () => emitter.emit("close"),
  };
  let headersSent = false;
  const res = {
    get headersSent() {
      return headersSent;
    },
    get writableLength() {
      return listener.bufferedBytes;
    },
    setHeader(name: string, value: string) {
      listener.headers[name.toLowerCase()] = String(value);
      return res;
    },
    status(code: number) {
      listener.statusCode = code;
      headersSent = true;
      return res;
    },
    write(chunk: Buffer) {
      if (listener.ended) throw new Error("write after end");
      listener.chunks.push(Buffer.from(chunk));
      if (listener.stopDraining) {
        listener.bufferedBytes += chunk.length;
        return false;
      }
      return true;
    },
    end() {
      listener.ended = true;
      emitter.emit("close");
      return res;
    },
    destroy() {
      listener.destroyed = true;
      listener.ended = true;
      emitter.emit("close");
      return res;
    },
    on(event: string, cb: (...args: unknown[]) => void) {
      emitter.on(event, cb);
      return res;
    },
    socket: null,
  } as unknown as Response;
  listener.res = res;
  return listener;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await sleep(25);
  }
}

// ── Mock Icecast upstream ─────────────────────────────────────────────────

let upstream: http.Server;
let upstreamPort: number;
let upstreamConnections = 0;
let activeUpstreamSockets = 0;

beforeAll(async () => {
  __setAllowPrivateUpstreamForTests(true);
  upstream = http.createServer((req, res) => {
    upstreamConnections++;
    activeUpstreamSockets++;
    res.on("close", () => {
      activeUpstreamSockets--;
    });
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "icy-metaint": "16000",
      "icy-name": "Mock College Radio",
      "icy-br": "128",
    });
    // Emit a chunk immediately, then keep trickling bytes until closed.
    res.write(Buffer.from("chunk-0"));
    const timer = setInterval(() => {
      res.write(Buffer.from("tick"));
    }, 100);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const addr = upstream.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  upstreamPort = addr.port;
});

afterAll(async () => {
  __setAllowPrivateUpstreamForTests(false);
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

afterEach(() => {
  __teardownAllForTests();
});

const upstreamUrl = () => `http://127.0.0.1:${upstreamPort}/stream`;
// Use an allowlisted slug for relay tests (any works — the URL is passed in).
const SLUG = "wmfo";

// ── Allowlist & URL helpers ───────────────────────────────────────────────

describe("relay allowlist", () => {
  it("contains exactly the curated HTTP-only cohort", () => {
    const expected = [
      "whpk", "wesu", "wzbc", "wrct", "wbrs", "wmfo", "wxdu", "wrir", "wicb",
      "chmr", "cism", "cjsr", "ckut",
    ];
    expect([...STREAM_RELAY_ALLOWLIST].sort()).toEqual([...expected].sort());
  });

  it("isRelayAllowed accepts allowlisted slugs and rejects others", () => {
    expect(isRelayAllowed("wmfo")).toBe(true);
    expect(isRelayAllowed("kexp")).toBe(false);
    expect(isRelayAllowed("")).toBe(false);
  });

  it("relayUrlPath produces the API route path", () => {
    expect(relayUrlPath("wxdu")).toBe("/api/stations/wxdu/relay");
  });
});

// ── attachListener validation ─────────────────────────────────────────────

describe("attachListener validation", () => {
  it("rejects non-allowlisted slugs", async () => {
    const l = makeListener();
    const result = await attachListener("kexp", upstreamUrl(), l.res);
    expect(result.kind).toBe("not_allowed");
    expect(activeSessionCount()).toBe(0);
  });

  it("rejects empty stream URLs", async () => {
    const l = makeListener();
    const result = await attachListener(SLUG, "", l.res);
    expect(result.kind).toBe("no_stream_url");
  });

  it("rejects https:// stream URLs (relay is for HTTP-only streams)", async () => {
    const l = makeListener();
    const result = await attachListener(SLUG, "https://example.com/stream", l.res);
    expect(result.kind).toBe("no_stream_url");
  });

  it("rejects malformed URLs", async () => {
    const l = makeListener();
    const result = await attachListener(SLUG, "http://", l.res);
    expect(result.kind).toBe("no_stream_url");
  });

  it("returns upstream_unavailable when the upstream cannot be reached", async () => {
    const l = makeListener();
    // Port 1 on loopback is never listening — connect fails fast.
    const result = await attachListener(SLUG, "http://127.0.0.1:1/stream", l.res);
    expect(result.kind).toBe("upstream_unavailable");
    // Nothing was written to the response, so the route can still send a 503.
    expect(l.statusCode).toBeNull();
    expect(l.chunks.length).toBe(0);
    expect(activeSessionCount()).toBe(0);
  });
});

// ── Streaming behavior ────────────────────────────────────────────────────

describe("relay streaming", () => {
  it("passes ICY headers and audio bytes through to a listener", async () => {
    const l = makeListener();
    const result = await attachListener(SLUG, upstreamUrl(), l.res);
    expect(result.kind).toBe("ok");

    await waitFor(() => l.chunks.length > 0);

    expect(l.statusCode).toBe(200);
    expect(l.headers["content-type"]).toBe("audio/mpeg");
    expect(l.headers["icy-metaint"]).toBe("16000");
    expect(l.headers["icy-name"]).toBe("Mock College Radio");
    expect(l.headers["cache-control"]).toBe("no-store");
    // Live-stream semantics: the listener joins mid-stream, so it may miss
    // the very first upstream chunk — but bytes must be flowing.
    expect(Buffer.concat(l.chunks).length).toBeGreaterThan(0);

    l.disconnect();
  });

  it("shares one upstream connection across multiple listeners", async () => {
    const before = upstreamConnections;
    const a = makeListener();
    const b = makeListener();

    expect((await attachListener(SLUG, upstreamUrl(), a.res)).kind).toBe("ok");
    await waitFor(() => a.chunks.length > 0);
    expect((await attachListener(SLUG, upstreamUrl(), b.res)).kind).toBe("ok");
    await waitFor(() => b.chunks.length > 0);

    expect(upstreamConnections - before).toBe(1);
    expect(listenerCount(SLUG)).toBe(2);

    // Late joiner got the ICY headers too.
    expect(b.headers["icy-metaint"]).toBe("16000");
    expect(b.statusCode).toBe(200);

    a.disconnect();
    b.disconnect();
  });

  it("tears down the upstream when the last listener leaves", async () => {
    const a = makeListener();
    const b = makeListener();
    await attachListener(SLUG, upstreamUrl(), a.res);
    await attachListener(SLUG, upstreamUrl(), b.res);
    await waitFor(() => a.chunks.length > 0);

    a.disconnect();
    await sleep(50);
    expect(activeSessionCount()).toBe(1); // b still listening

    b.disconnect();
    await waitFor(() => activeSessionCount() === 0);
    await waitFor(() => activeUpstreamSockets === 0);
  });

  it("enforces the listener cap with cap_exceeded", async () => {
    const listeners: MockListener[] = [];
    for (let i = 0; i < RELAY_LISTENER_CAP; i++) {
      const l = makeListener();
      listeners.push(l);
      const r = await attachListener(SLUG, upstreamUrl(), l.res);
      expect(r.kind).toBe("ok");
    }
    const overflow = makeListener();
    const r = await attachListener(SLUG, upstreamUrl(), overflow.res);
    expect(r.kind).toBe("cap_exceeded");

    for (const l of listeners) l.disconnect();
    await waitFor(() => activeSessionCount() === 0);
  });

  it("evicts a listener whose write buffer exceeds the cap (non-reading client)", async () => {
    const healthy = makeListener();
    const stalled = makeListener();
    await attachListener(SLUG, upstreamUrl(), healthy.res);
    await attachListener(SLUG, upstreamUrl(), stalled.res);
    await waitFor(() => stalled.chunks.length > 0);

    // The stalled client stops reading: every write now accumulates in its
    // simulated kernel/user-space buffer instead of draining.
    stalled.stopDraining = true;
    stalled.bufferedBytes = MAX_LISTENER_BUFFER_BYTES + 1;

    // Next broadcast tick must evict it (destroy, not buffer further).
    await waitFor(() => stalled.destroyed);
    expect(listenerCount(SLUG)).toBe(1);

    // The healthy listener keeps receiving bytes after the eviction.
    const before = healthy.chunks.length;
    await waitFor(() => healthy.chunks.length > before);
    expect(activeSessionCount()).toBe(1);

    healthy.disconnect();
    await waitFor(() => activeSessionCount() === 0);
  });

  it("tears the session down when the last listener is evicted for stalling", async () => {
    const stalled = makeListener();
    await attachListener(SLUG, upstreamUrl(), stalled.res);
    await waitFor(() => stalled.chunks.length > 0);

    stalled.stopDraining = true;
    stalled.bufferedBytes = MAX_LISTENER_BUFFER_BYTES + 1;

    await waitFor(() => stalled.destroyed);
    await waitFor(() => activeSessionCount() === 0);
    await waitFor(() => activeUpstreamSockets === 0);
  });

  it("keeps the session pinned to the first upstream URL for a slug", async () => {
    const a = makeListener();
    await attachListener(SLUG, upstreamUrl(), a.res);
    await waitFor(() => a.chunks.length > 0);
    const before = upstreamConnections;

    // Second listener passes a different URL — must NOT open a new upstream.
    const b = makeListener();
    const r = await attachListener(SLUG, "http://127.0.0.1:1/other", b.res);
    expect(r.kind).toBe("ok");
    await waitFor(() => b.chunks.length > 0);
    expect(upstreamConnections).toBe(before);

    a.disconnect();
    b.disconnect();
    await waitFor(() => activeSessionCount() === 0);
  });
});
