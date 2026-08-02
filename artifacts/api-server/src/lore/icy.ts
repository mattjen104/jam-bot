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
 *
 * Encoding: ICY is nominally UTF-8 but many stations (especially European
 * broadcasters) send Latin-1 / ISO 8859-1. We try UTF-8 first; if the result
 * contains the Unicode replacement character (U+FFFD) we retry as Latin-1,
 * which never produces replacements (every byte is a valid Latin-1 code point).
 */
export function parseIcyStreamTitle(block: Buffer): string | null {
  const extractTitle = (text: string): string | null => {
    const m = /StreamTitle='([^']*)'/i.exec(text);
    if (!m) return null;
    const title = m[1]?.trim();
    return title || null;
  };

  const utf8 = block.toString("utf8");
  const fromUtf8 = extractTitle(utf8);
  if (fromUtf8 !== null && !fromUtf8.includes("\uFFFD")) return fromUtf8;

  // Try Latin-1 fallback when UTF-8 produced replacement characters.
  const latin1 = block.toString("latin1");
  const fromLatin1 = extractTitle(latin1);
  if (fromLatin1 !== null) return fromLatin1;

  // Return the UTF-8 result even if it had replacement chars — better than null.
  return fromUtf8;
}

/**
 * Extended result from parseStreamTitle — adds optional fields that only
 * the tilde-structured format can supply.
 */
export interface ParsedStreamTitle {
  rawArtist?: string;
  rawTitle: string;
  /** MusicBrainz Recording UUID, present when the tilde format supplies one. */
  sourceRecordingId?: string;
  /** Track duration in ms, present when the tilde format supplies one. */
  durationMs?: number;
}

/**
 * Attempt to parse a tilde-delimited structured stream title used by a cluster
 * of stations (Radio Monte Carlo Nights Story, United Music Pink Floyd, et al.).
 *
 * Format (≥6 `~`-separated fields, 0-indexed):
 *   [0]  title
 *   [1]  artist
 *   [2]  empty
 *   [3]  release year (e.g. "1986")
 *   [4]  empty
 *   [5]  duration in seconds (e.g. "333")
 *   [6]  start datetime ISO
 *   [7]  end datetime ISO
 *   [8]  station name
 *   [9]  elapsed seconds (e.g. "261.88")
 *   [10] MusicBrainz recording UUID (optional — present on some networks)
 *
 * Returns a result whenever title, artist, and a numeric duration can be
 * extracted (minimum 6 fields). `sourceRecordingId` is set only when a
 * valid UUID is present at field 10. Returns null when the string does not
 * look like the tilde format (< 6 fields, or missing title/artist/duration).
 */
export function parseTildeStreamTitle(s: string): ParsedStreamTitle | null {
  if (!s.includes("~")) return null;
  const parts = s.split("~");
  if (parts.length < 6) return null;

  const rawTitle = parts[0]?.trim();
  const rawArtist = parts[1]?.trim();
  if (!rawTitle || !rawArtist) return null;

  // Require a parseable duration in field[5] to distinguish this format from
  // any random tilde-containing string.
  const durationStr = parts[5]?.trim();
  if (!durationStr) return null;
  const secs = parseFloat(durationStr);
  if (!Number.isFinite(secs) || secs <= 0) return null;

  const result: ParsedStreamTitle = {
    rawTitle,
    rawArtist,
    durationMs: Math.round(secs * 1000),
  };

  // UUID at field[10] is optional — include it when present and valid.
  if (parts.length >= 11) {
    const potentialUuid = parts[10]?.trim() ?? "";
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(potentialUuid)) {
      result.sourceRecordingId = potentialUuid;
    }
  }

  return result;
}

/**
 * Strip leading dash/em-dash/en-dash delimiter debris from a raw ICY artist
 * field.  Some streams emit "- Nina Simone" rather than "Nina Simone" because
 * the source software prefixes the standard "Artist - Title" separator.  We
 * strip the leading punctuation, keeping the rest of the string intact.
 * Returns null when stripping leaves nothing.
 */
export function stripLeadingDelimiter(raw: string): string | null {
  const stripped = raw.replace(/^[-–—]+\s*/, "").trim();
  return stripped || null;
}

/**
 * Split an ICY `StreamTitle` value into artist and title.
 *
 * Tries the tilde-structured format first (used by a cluster of stations that
 * embed a MusicBrainz UUID). Falls back to the standard `Artist - Title`
 * heuristic. When the delimiter is absent the whole string is treated as the
 * title with rawArtist undefined.
 *
 * Leading delimiter debris (e.g. "- Nina Simone") is stripped from the artist
 * field so the resolution path sees a clean artist name.
 */
export function parseStreamTitle(streamTitle: string): ParsedStreamTitle | null {
  const trimmed = streamTitle.trim();
  if (!trimmed) return null;

  // Tilde-structured format takes priority — it supplies a direct MB UUID.
  const tilde = parseTildeStreamTitle(trimmed);
  if (tilde) return tilde;

  // Standard "Artist - Title" split.
  const sep = trimmed.indexOf(" - ");
  if (sep > 0) {
    const rawArtist = trimmed.slice(0, sep).trim();
    const rawTitle = trimmed.slice(sep + 3).trim();
    if (rawTitle) {
      // Strip leading dash/em-dash/en-dash artifact from the artist field.
      const cleanedArtist = rawArtist ? stripLeadingDelimiter(rawArtist) : null;
      return { rawArtist: cleanedArtist ?? undefined, rawTitle };
    }
  }
  return { rawTitle: trimmed };
}

/**
 * Non-musical programming labels that appear in the artist field of ICY and
 * adapter metadata when stations carry breaks, IDs, or filler content.
 * Applied to the artist field only — a song could be legitimately titled
 * "Commercial" or "News", but no real artist is named that.
 *
 * Mirrors the client-side `MISSING_LIVE_ARTIST_VALUES` set in useDialData.ts
 * so both layers enforce the same vocabulary.
 */
const PROGRAMMING_ARTIST_LABELS = new Set([
  // Generic unknowns / placeholders
  "unknown", "unknown artist", "artist unknown", "no artist",
  "unknown show", "unknown station", "unknown channel", "no metadata",
  "various artists", "n/a", "na", "none", "null", "undefined", "continuous",
  // Station programming / non-musical segments
  "commercial", "commercial break", "advertisement", "advertisements", "ads", "ad",
  "break", "station break", "news", "news break", "weather", "traffic", "sports",
  "id", "station id", "legal id", "liner", "station liner",
  "sweeper", "jingle", "bumper", "promo", "promotion", "spot", "intermission",
  "off air", "off-air", "sign off", "sign-off", "automation",
  // Filler / loading-state values seen in the wild
  "music", "live", "now playing", "loading", "please wait",
  "tba", "tbd", "to be announced", "to be determined",
]);

/** Matches an audio file extension at the end of an artist or title string. */
const AUDIO_EXT_RE = /\.\s*(?:mp3|wav|ogg|flac|aac|m4a|opus|wma|aiff?)\s*$/i;

/** At least one Unicode letter is required in the artist field. */
const HAS_LETTER_RE = /\p{L}/u;

/** Matches an explicit protocol prefix — a clear sign of a URL in a metadata field. */
const URL_PROTOCOL_RE = /^https?:\/\//i;

/**
 * Common country-code and generic TLDs that appear in domain-name artist values
 * (e.g. "wellsfargo.com", "sponsor.fm").  Only used after a dot is confirmed so
 * the list doesn't need to be exhaustive — it just needs to cover the cases that
 * actually appear in ICY metadata from ad-injection systems.
 */
const DOMAIN_TLD_RE =
  /\.(com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)\b/i;

/**
 * Return true when a string looks like a URL or a bare domain name. Requires
 * either an explicit protocol or a dot followed by a known TLD.  The value must
 * also look like a hostname (only alphanumerics, dots, and hyphens — no spaces,
 * slashes in the TLD portion, or other word-boundary separators that would
 * indicate a normal sentence containing a country abbreviation).
 */
function isDomainLike(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // Explicit protocol — unambiguous.
  if (URL_PROTOCOL_RE.test(t)) return true;
  // Bare hostname: only hostname-safe characters AND ends with a known TLD.
  if (!t.includes(".")) return false;
  if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(t)) return false;
  return DOMAIN_TLD_RE.test(t);
}

/**
 * Count occurrences of a specific character in a string without allocation.
 */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) n++;
  }
  return n;
}

/**
 * Return true when a raw artist/title pair is clearly not a song — an ad slot,
 * break announcement, station ID loop, or other junk metadata that should be
 * silently discarded before resolution is attempted.
 *
 * Kept intentionally conservative: only patterns with near-zero false-positive
 * risk are listed. Unknown/unusual content is allowed through so real tracks
 * are never dropped.
 */
export function isJunkMetadata(rawArtist: string, rawTitle: string): boolean {
  // Identical artist and title — station loop, jingle ID, or ad filler.
  if (rawArtist === rawTitle) return true;

  // Ad-tag prefix used by several network broadcasters.
  if (/^ADWTAG_/i.test(rawArtist) || /^ADWTAG_/i.test(rawTitle)) return true;

  // Known break-announcement phrases (case-insensitive, apostrophe-tolerant).
  const combined = `${rawArtist} ${rawTitle}`.toLowerCase().replace(/'/g, "");
  const BREAK_PHRASES = [
    "espacio publicitario",
    "well be right back",    // matches "we'll be right back"
    "well be back",
    "continue after this break",
    "after this message",
    "station will continue",
  ];
  if (BREAK_PHRASES.some((p) => combined.includes(p))) return true;

  // Icecast placeholder when a mount carries no metadata: bare "Unknown"
  // (often with an empty artist). No real track is titled just "Unknown"
  // with no artist attached.
  if (!rawArtist.trim() && /^unknown$/i.test(rawTitle.trim())) return true;

  // Purely numeric entries — station ID counters, timestamp codes, etc.
  // No real song title or artist name is just digits.
  if (/^\d+$/.test(rawArtist) || /^\d+$/.test(rawTitle)) return true;

  // Station-slug-shaped ALL_CAPS identifiers: uppercase letters, digits, and
  // underscores only (no spaces, no lowercase), must contain an underscore to
  // distinguish from legitimately all-caps artist names like "ABBA" or "AC/DC".
  // Catches patterns like STATION_ID_123, IDENT_LOOP_01, etc.
  const isSlug = (s: string): boolean =>
    /^[A-Z][A-Z0-9_-]+$/.test(s) && s.includes("_");
  if (isSlug(rawArtist) || isSlug(rawTitle)) return true;

  // Backup-stream indicators — a station's fallback feed annotates itself
  // with a parenthetical like "(BACKUP ONLY!)" or "(BACKUP)" in the artist
  // field instead of a real artist name.  No real track has this pattern.
  if (/\(backup\b/i.test(rawArtist) || /\(backup\b/i.test(rawTitle)) return true;

  // Known non-musical programming labels in the artist field — "Commercial",
  // "Station ID", "TBA", "Various Artists", etc.  The title field is exempt:
  // a song could genuinely be titled "News" or "Commercial".
  const artistKey = rawArtist.trim().toLowerCase();
  if (artistKey && PROGRAMMING_ARTIST_LABELS.has(artistKey)) return true;

  // Pure-punctuation / no-letter artist value — "---", "...", "- -", "***",
  // "????".  No real artist name contains zero Unicode letters.  The title
  // field is not checked here because some avant-garde titles contain only
  // symbols; the artist field is the more reliable signal.
  if (rawArtist.trim() && !HAS_LETTER_RE.test(rawArtist)) return true;

  // Audio filenames in either field — "jingle_01.mp3", "news_break.ogg",
  // "track 01.wav".  No real artist or track title ends with an audio extension.
  if (AUDIO_EXT_RE.test(rawArtist) || AUDIO_EXT_RE.test(rawTitle)) return true;

  // URL or domain-name artist values — ad-injection systems often drop a
  // sponsor URL into the artist field (e.g. "wellsfargo.com").  No real artist
  // name is a bare domain or a URL.  We check both fields: a URL in the title
  // field is equally indicative of an ad or tracker slot.
  if (isDomainLike(rawArtist) || isDomainLike(rawTitle)) return true;

  // High replacement-character (U+FFFD) ratio — severe encoding artifact
  // (mojibake) that would never be a real artist or title.  We require the
  // string to be at least 4 characters long to avoid penalising very short
  // values where a single bad byte happens to appear.  A threshold of 50 %
  // is conservative: legitimate names with one or two replacement chars (rare
  // partial decoding issues) still pass through for human review.
  const REPLACEMENT_CHAR = "\uFFFD";
  if (rawArtist.length >= 4 && countChar(rawArtist, REPLACEMENT_CHAR) / rawArtist.length >= 0.5) {
    return true;
  }
  if (rawTitle.length >= 4 && countChar(rawTitle, REPLACEMENT_CHAR) / rawTitle.length >= 0.5) {
    return true;
  }

  return false;
}

export function parseUrl(rawUrl: string): {
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

// ---- Streaming parser (persistent-connection mode) -----------------------

/** Events produced by IcyStreamParser.feed(). */
export type IcyParserEvent =
  | { type: "headers"; icyMetaint: number }
  | { type: "metadata"; streamTitle: string | null }
  | { type: "error"; kind: "icy_unsupported"; message: string };

/** Cap on accumulated HTTP header bytes before we give up on the response. */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * Incremental ICY stream parser for persistent connections.
 *
 * Unlike the one-shot path in fetchIcyMetadata (which Buffer.concats the whole
 * stream — fine for a single metadata block, fatal on a socket held open for
 * hours), this parser counts audio bytes with an integer and only ever
 * allocates metadata blocks (max 255*16 = 4080 bytes) and the HTTP headers
 * (capped). Feed it raw socket chunks; it returns zero or more events per
 * chunk. After an `error` event the parser is dead — reconnect with a fresh
 * instance.
 */
export class IcyStreamParser {
  private state: "headers" | "audio" | "meta-len" | "meta" | "failed" =
    "headers";
  private headerChunks: Buffer[] = [];
  private headerBytes = 0;
  private icyMetaint = 0;
  private audioRemaining = 0;
  private metaRemaining = 0;
  private metaChunks: Buffer[] = [];

  feed(chunk: Buffer): IcyParserEvent[] {
    const events: IcyParserEvent[] = [];
    if (this.state === "failed") return events;

    let offset = 0;

    if (this.state === "headers") {
      this.headerChunks.push(chunk);
      this.headerBytes += chunk.length;
      const full = Buffer.concat(this.headerChunks, this.headerBytes);
      const sep = full.indexOf("\r\n\r\n");
      if (sep === -1) {
        if (this.headerBytes > MAX_HEADER_BYTES) {
          this.state = "failed";
          events.push({
            type: "error",
            kind: "icy_unsupported",
            message: "response headers too large",
          });
        }
        return events;
      }

      const headerStr = full.slice(0, sep).toString("utf8");
      const statusLine = headerStr.split("\r\n")[0] ?? "";
      const statusCode = parseInt(statusLine.split(" ")[1] ?? "0", 10);
      if (statusCode < 200 || statusCode >= 300) {
        this.state = "failed";
        events.push({
          type: "error",
          kind: "icy_unsupported",
          message: `HTTP ${statusCode}`,
        });
        return events;
      }
      const metaintMatch = /icy-metaint:\s*(\d+)/i.exec(headerStr);
      const metaint = metaintMatch ? parseInt(metaintMatch[1]!, 10) : 0;
      if (!metaint || metaint <= 0) {
        this.state = "failed";
        events.push({
          type: "error",
          kind: "icy_unsupported",
          message: "no icy-metaint header",
        });
        return events;
      }

      this.icyMetaint = metaint;
      events.push({ type: "headers", icyMetaint: metaint });

      // Continue with the body bytes that arrived alongside the headers,
      // then release the header accumulation buffers.
      this.headerChunks = [];
      this.headerBytes = 0;
      this.state = "audio";
      this.audioRemaining = metaint;
      chunk = full;
      offset = sep + 4;
    }

    while (offset < chunk.length) {
      if (this.state === "audio") {
        // Count-and-skip: never buffer audio bytes.
        const skip = Math.min(this.audioRemaining, chunk.length - offset);
        this.audioRemaining -= skip;
        offset += skip;
        if (this.audioRemaining === 0) this.state = "meta-len";
      } else if (this.state === "meta-len") {
        const lenByte = chunk[offset]!;
        offset += 1;
        this.metaRemaining = lenByte * 16;
        if (this.metaRemaining === 0) {
          // Zero-length metadata block — no update; next audio segment.
          this.audioRemaining = this.icyMetaint;
          this.state = "audio";
        } else {
          this.metaChunks = [];
          this.state = "meta";
        }
      } else if (this.state === "meta") {
        const take = Math.min(this.metaRemaining, chunk.length - offset);
        this.metaChunks.push(chunk.slice(offset, offset + take));
        this.metaRemaining -= take;
        offset += take;
        if (this.metaRemaining === 0) {
          const block = Buffer.concat(this.metaChunks);
          this.metaChunks = [];
          events.push({
            type: "metadata",
            streamTitle: parseIcyStreamTitle(block),
          });
          this.audioRemaining = this.icyMetaint;
          this.state = "audio";
        }
      } else {
        break;
      }
    }

    return events;
  }
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
