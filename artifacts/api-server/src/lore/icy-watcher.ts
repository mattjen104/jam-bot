import * as net from "node:net";
import * as tls from "node:tls";
import { EventEmitter } from "node:events";
import {
  IcyStreamParser,
  parseUrl,
  parseStreamTitle,
  isJunkMetadata,
  type ParsedStreamTitle,
} from "./icy.js";

/**
 * IcyWatcher — one persistent ICY connection per station for instant
 * now-playing.
 *
 * Holds a raw TCP/TLS socket open against the station's stream URL and feeds
 * every chunk through the allocation-free IcyStreamParser. Emits:
 *
 *   - "metadata-changed" (ParsedStreamTitle) — the StreamTitle differs from
 *     the previous one, is non-empty, and passed the junk filter. Local dedup
 *     here blocks the ~2/sec repeats a stream sends between track changes, so
 *     downstream (DB dedup in logSpinIfChanged) only sees real transitions.
 *   - "persistent-failed" — 5 connection failures within 10 minutes, or the
 *     server signalled ICY is unsupported. The watcher stops itself; the
 *     caller should fall back to interval polling.
 *
 * Reconnect policy: exponential backoff 5s → 300s cap, reset to the floor on
 * any successful metadata block. A 30s no-bytes watchdog tears down stalled
 * sockets (some servers silently stop sending on network blips).
 */

const BACKOFF_FLOOR_MS = 5_000;
const BACKOFF_CAP_MS = 300_000;
const WATCHDOG_MS = 30_000;
// Wider window + higher limit so startup-burst timeouts (mux probing 400+
// hosts concurrently during boot) don't trigger a permanent fallback to
// interval polling.  With 12 failures allowed over 30 min, the watcher
// survives the ~2-3 min boot contention and reconnects cleanly once the
// network load drops.
const FAILURE_WINDOW_MS = 30 * 60_000;
const FAILURE_LIMIT = 12;
// 15 s — gives more headroom when Replit's outbound queue is saturated
// during the startup burst; curl connects in <8 s under normal load.
const CONNECT_TIMEOUT_MS = 15_000;

export class IcyWatcher extends EventEmitter {
  private socket: net.Socket | null = null;
  private parser: IcyStreamParser | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private backoffMs = BACKOFF_FLOOR_MS;
  private failureTimestamps: number[] = [];
  private lastStreamTitle: string | null = null;
  private stopped = false;

  constructor(
    private readonly stationSlug: string,
    private readonly streamUrl: string,
  ) {
    super();
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
  }

  private teardown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.connectTimer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
    this.parser = null;
  }

  private armWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      // No bytes for WATCHDOG_MS — the socket is stalled; reconnect.
      this.onFailure("watchdog: no bytes for 30s");
    }, WATCHDOG_MS);
  }

  private connect(): void {
    if (this.stopped) return;
    const parsed = parseUrl(this.streamUrl);
    if (!parsed) {
      this.emitPersistentFailed("unparseable stream URL");
      return;
    }

    this.parser = new IcyStreamParser();
    const socketOpts = { host: parsed.host, port: parsed.port };
    const socket =
      parsed.protocol === "https:"
        ? tls.connect({ ...socketOpts, servername: parsed.host })
        : net.connect(socketOpts);
    this.socket = socket;

    this.connectTimer = setTimeout(() => {
      this.onFailure("connect timeout");
    }, CONNECT_TIMEOUT_MS);

    socket.once("error", (err) => this.onFailure(err.message));
    socket.once("close", () => {
      // Server closed the connection — treat as a failure so we reconnect.
      if (!this.stopped && this.socket === socket) {
        this.onFailure("connection closed by server");
      }
    });

    socket.once("connect", () => {
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      const req = [
        `GET ${parsed.path} HTTP/1.0`,
        `Host: ${parsed.host}`,
        "Icy-MetaData: 1",
        "User-Agent: Lore-ICY-watcher/1.0",
        "",
        "",
      ].join("\r\n");
      socket.write(req);
      this.armWatchdog();
    });

    socket.on("data", (chunk: Buffer) => {
      this.armWatchdog();
      if (!this.parser) return;
      for (const ev of this.parser.feed(chunk)) {
        if (ev.type === "error") {
          // Permanent characteristic (no metaint, redirect, etc) — do not
          // keep reconnecting into the same wall.
          this.emitPersistentFailed(ev.message);
          return;
        }
        if (ev.type === "metadata") {
          // Success — reset backoff so future blips recover fast.
          this.backoffMs = BACKOFF_FLOOR_MS;
          this.failureTimestamps = [];
          this.handleStreamTitle(ev.streamTitle);
        }
      }
    });
  }

  private handleStreamTitle(streamTitle: string | null): void {
    if (!streamTitle) return;
    if (streamTitle === this.lastStreamTitle) return;
    this.lastStreamTitle = streamTitle;

    const parsed: ParsedStreamTitle | null = parseStreamTitle(streamTitle);
    if (!parsed) return;
    const rawArtist = parsed.rawArtist ?? "";
    if (isJunkMetadata(rawArtist, parsed.rawTitle)) return;
    this.emit("metadata-changed", parsed);
  }

  private onFailure(message: string): void {
    if (this.stopped) return;
    this.teardown();

    const now = Date.now();
    this.failureTimestamps = this.failureTimestamps.filter(
      (t) => now - t < FAILURE_WINDOW_MS,
    );
    this.failureTimestamps.push(now);
    if (this.failureTimestamps.length >= FAILURE_LIMIT) {
      this.emitPersistentFailed(
        `${FAILURE_LIMIT} failures in 30 min (last: ${message})`,
      );
      return;
    }

    console.warn(
      `[lore] icy-watcher ${this.stationSlug}: ${message}; reconnecting in ${Math.round(this.backoffMs / 1000)}s`,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CAP_MS);
  }

  private emitPersistentFailed(message: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.teardown();
    console.warn(
      `[lore] icy-watcher ${this.stationSlug} giving up: ${message}`,
    );
    this.emit("persistent-failed", message);
  }
}
