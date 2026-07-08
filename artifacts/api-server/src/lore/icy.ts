import * as net from "node:net";
import * as tls from "node:tls";

/**
 * ICY / Shoutcast stream metadata fetcher.
 *
 * Opens a raw TCP (or TLS) connection to the stream server, sends a minimal
 * HTTP/1.0 request with `Icy-MetaData: 1`, reads just enough bytes to reach
 * the first metadata block, extracts `StreamTitle`, then closes the socket.
 *
 * No audio data is buffered beyond what is necessary to advance the read
 * cursor to the first metadata position.
 */

const CONNECT_TIMEOUT_MS = 8_000;
const READ_TIMEOUT_MS = 15_000;

/**
 * Discriminated result from fetchIcyMetadata.
 *
 * - `ok: true`  — ICY metadata received; streamTitle may still be empty
 *   (station between tracks). rawStreamTitle is the raw ICY value.
 * - `ok: false, kind: "icy_unsupported"` — the server responded but does not
 *   honour `Icy-MetaData: 1` (no icy-metaint header, or non-2xx redirect).
 *   This is a permanent station characteristic.
 * - `ok: false, kind: "transient_error"` — network/timeout/socket failure.
 *   Caller should increment its error counter.
 */
export type IcyFetchResult =
  | { ok: true; streamTitle: string | null; icyMetaint: number }
  | { ok: false; kind: "icy_unsupported" | "transient_error"; message?: string };

/**
 * Parse `StreamTitle` from a raw ICY metadata block. The block is a NUL-padded
 * sequence of `Key='Value';` pairs. Returns the StreamTitle string, or null
 * when absent or empty.
 */
export function parseIcyStreamTitle(block: Buffer): string | null {
  const text = block.toString("utf8");
  const m = /StreamTitle='([^']*)'/i.exec(text);
  if (!m) return null;
  const title = m[1]?.trim();
  return title || null;
}

/**
 * Split an ICY `StreamTitle` value into artist and title.
 *
 * Heuristic: most stations use `Artist - Title`. We split on the first ` - `
 * (space-dash-space) and trim both sides. When the delimiter is absent the
 * whole string is treated as the title with rawArtist undefined (caller
 * decides how to handle title-only entries).
 */
export function parseStreamTitle(
  streamTitle: string,
): { rawArtist?: string; rawTitle: string } | null {
  const trimmed = streamTitle.trim();
  if (!trimmed) return null;
  const sep = trimmed.indexOf(" - ");
  if (sep > 0) {
    const rawArtist = trimmed.slice(0, sep).trim();
    const rawTitle = trimmed.slice(sep + 3).trim();
    if (rawTitle) return { rawArtist: rawArtist || undefined, rawTitle };
  }
  return { rawTitle: trimmed };
}

function parseUrl(rawUrl: string): {
  protocol: "http:" | "https:";
  host: string;
  port: number;
  path: string;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  const port = parsed.port ? Number(parsed.port) : defaultPort;
  const path = (parsed.pathname || "/") + (parsed.search || "");
  return { protocol: parsed.protocol as "http:" | "https:", host: parsed.hostname, port, path };
}

/**
 * Fetch ICY metadata from a stream URL.
 *
 * Returns a discriminated `IcyFetchResult`:
 *   - `{ ok: true, streamTitle, icyMetaint }` on success (streamTitle may be
 *     null when the station is between tracks).
 *   - `{ ok: false, kind: "icy_unsupported" }` when the server does not honour
 *     `Icy-MetaData: 1` (missing icy-metaint, redirect, non-2xx).
 *   - `{ ok: false, kind: "transient_error" }` on socket/timeout/network failure.
 *
 * Never throws.
 */
export async function fetchIcyMetadata(streamUrl: string): Promise<IcyFetchResult> {
  const parsed = parseUrl(streamUrl);
  if (!parsed) {
    return { ok: false, kind: "icy_unsupported", message: "unparseable URL" };
  }

  return new Promise<IcyFetchResult>((resolve) => {
    let settled = false;

    function done(result: IcyFetchResult) {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(readTimer);
      try {
        socket.destroy();
      } catch {}
      resolve(result);
    }

    const connectTimer = setTimeout(
      () => done({ ok: false, kind: "transient_error", message: "connect timeout" }),
      CONNECT_TIMEOUT_MS,
    );
    let readTimer: NodeJS.Timeout;

    const socketOpts = { host: parsed.host, port: parsed.port };
    const socket =
      parsed.protocol === "https:"
        ? tls.connect({ ...socketOpts, servername: parsed.host })
        : net.connect(socketOpts);

    socket.once("error", (err) =>
      done({ ok: false, kind: "transient_error", message: err.message }),
    );
    socket.once("timeout", () =>
      done({ ok: false, kind: "transient_error", message: "read timeout" }),
    );

    socket.once("connect", () => {
      clearTimeout(connectTimer);
      readTimer = setTimeout(
        () => done({ ok: false, kind: "transient_error", message: "read timeout" }),
        READ_TIMEOUT_MS,
      );

      const req = [
        `GET ${parsed.path} HTTP/1.0`,
        `Host: ${parsed.host}`,
        "Icy-MetaData: 1",
        "User-Agent: Lore-ICY-fetcher/1.0",
        "Connection: close",
        "",
        "",
      ].join("\r\n");

      socket.write(req);

      // Accumulate raw bytes until we can parse headers + the first metadata block.
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let icyMetaint: number | null = null;
      let headersParsed = false;
      let headerEnd = -1;
      let audioConsumed = 0;
      let full = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        totalBytes += chunk.length;
        full = Buffer.concat(chunks, totalBytes);

        // Step 1: wait for the end of HTTP headers (double CRLF).
        if (!headersParsed) {
          const sep = full.indexOf("\r\n\r\n");
          if (sep === -1) return;
          headerEnd = sep + 4;
          const headerStr = full.slice(0, sep).toString("utf8");

          // Check HTTP status — non-2xx (e.g. 302 redirect) means the station
          // is not directly reachable at this URL; treat as icy_unsupported since
          // we don't follow audio redirects.
          const statusLine = headerStr.split("\r\n")[0] ?? "";
          const statusCode = parseInt(statusLine.split(" ")[1] ?? "0", 10);
          if (statusCode < 200 || statusCode >= 300) {
            done({ ok: false, kind: "icy_unsupported", message: `HTTP ${statusCode}` });
            return;
          }

          // icy-metaint header tells us how many audio bytes appear before each
          // metadata block. Its absence means the server doesn't support ICY.
          const metaintMatch = /icy-metaint:\s*(\d+)/i.exec(headerStr);
          if (!metaintMatch) {
            done({ ok: false, kind: "icy_unsupported", message: "no icy-metaint header" });
            return;
          }
          icyMetaint = parseInt(metaintMatch[1]!, 10);
          if (!icyMetaint || icyMetaint <= 0) {
            done({ ok: false, kind: "icy_unsupported", message: "invalid icy-metaint value" });
            return;
          }
          headersParsed = true;
        }

        if (icyMetaint === null) return;

        // Step 2: we need `icyMetaint` audio bytes, then 1 length byte, then
        // `length * 16` metadata bytes. Advance through the buffer when enough
        // bytes have arrived.
        const audioStart = headerEnd + audioConsumed;
        const needed = icyMetaint - audioConsumed;
        if (full.length < audioStart + needed) return; // need more audio bytes

        // The byte immediately after the audio block is the metadata length
        // (multiply by 16 to get the block size in bytes).
        const metaLenByte = full[audioStart + needed];
        if (metaLenByte === undefined) return;
        const metaBlockLen = metaLenByte * 16;

        const metaStart = audioStart + needed + 1;
        if (full.length < metaStart + metaBlockLen) return; // need more meta bytes

        const metaBlock = full.slice(metaStart, metaStart + metaBlockLen);
        // Return ok:true even when streamTitle is null — the server supports
        // ICY; the station may just be between tracks.
        done({ ok: true, streamTitle: parseIcyStreamTitle(metaBlock), icyMetaint });
      });
    });
  });
}
