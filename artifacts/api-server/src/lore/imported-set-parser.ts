import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Hardened XSPF/JSPF interchange parser for listener-uploaded portable sets.
 *
 * Design constraints (see task "Import and play portable sets"):
 *  - Plain third-party files (title/creator only) are first-class input.
 *  - Limits are enforced BEFORE full processing: 1 MB, 500 tracks.
 *  - XML is parsed by one deliberately chosen hardened parser
 *    (fast-xml-parser) with entity processing disabled, and any DOCTYPE /
 *    ENTITY declaration is rejected outright — no DTDs, no entity expansion,
 *    no external references.
 *  - Identifier preference: Lore MBID metadata > standard MusicBrainz
 *    recording identifier > ISRC > title/creator. The parser only extracts
 *    facts; the resolver decides the basis and records it honestly.
 *  - Provenance claims in uploaded files (picker/DJ/station/citation meta)
 *    are NEVER imported — a user-editable file cannot restore archival radio
 *    provenance or claim a selector.
 */

export const IMPORTED_SET_MAX_BYTES = 1_048_576; // 1 MB
export const IMPORTED_SET_MAX_TRACKS = 500;

export interface ImportedSetManifestEntry {
  position: number;
  title: string | null;
  creator: string | null;
  album: string | null;
  durationMs: number | null;
  /** Recording MBID claimed by the file (uuid or lore synthetic id). */
  claimedMbid: string | null;
  /** True when the MBID came from a lore:* extension/meta field. */
  claimedMbidFromLore: boolean;
  claimedIsrc: string | null;
}

export interface ImportedSetManifest {
  format: "xspf" | "jspf";
  /** Playlist title from the file, when present. */
  title: string | null;
  entries: ImportedSetManifestEntry[];
}

export type ImportedSetParseResult =
  | { ok: true; manifest: ImportedSetManifest }
  | { ok: false; error: string };

const MBID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lore also mints synthetic `sp:<id>` spine keys; accept a bounded charset. */
const LORE_MBID_RE = /^(?:sp:)?[0-9A-Za-z:_-]{8,64}$/;
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;
const RECORDING_URL_RE =
  /^https?:\/\/(?:www\.)?musicbrainz\.org\/recording\/([0-9a-f-]{36})\/?$/i;

const TEXT_FIELD_MAX = 1_000;

function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, TEXT_FIELD_MAX);
}

function asDurationMs(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const ms = Math.floor(n);
  // XSPF/JSPF duration is milliseconds; ignore nonsense values.
  return ms > 0 && ms < 24 * 60 * 60 * 1000 ? ms : null;
}

function mbidFromIdentifier(raw: string): string | null {
  const url = RECORDING_URL_RE.exec(raw.trim());
  if (url) return url[1]!.toLowerCase();
  if (MBID_UUID_RE.test(raw.trim())) return raw.trim().toLowerCase();
  return null;
}

function isrcFromIdentifier(raw: string): string | null {
  const value = raw.trim().replace(/^isrc:/i, "").replace(/-/g, "");
  return ISRC_RE.test(value) ? value.toUpperCase() : null;
}

/** Meta rel keys the parser reads. Provenance keys are deliberately absent. */
const LORE_MBID_RELS = new Set(["lore:recording_mbid", "recording_mbid"]);
const LORE_ISRC_RELS = new Set(["lore:isrc", "isrc"]);

interface RawTrackFacts {
  title: unknown;
  creator: unknown;
  album: unknown;
  duration: unknown;
  identifiers: string[];
  /** rel → content pairs from meta/extension fields (lowercased rel). */
  meta: Array<{ rel: string; content: string }>;
}

function normalizeEntry(position: number, facts: RawTrackFacts): ImportedSetManifestEntry {
  let claimedMbid: string | null = null;
  let claimedMbidFromLore = false;
  let claimedIsrc: string | null = null;

  // 1. Lore extension metadata is the strongest claim when present.
  for (const { rel, content } of facts.meta) {
    if (!claimedMbid && LORE_MBID_RELS.has(rel)) {
      const candidate = content.trim();
      if (MBID_UUID_RE.test(candidate) || LORE_MBID_RE.test(candidate)) {
        claimedMbid = candidate.toLowerCase().startsWith("sp:")
          ? candidate
          : candidate.toLowerCase();
        claimedMbidFromLore = true;
      }
    }
    if (!claimedIsrc && LORE_ISRC_RELS.has(rel)) {
      claimedIsrc = isrcFromIdentifier(content);
    }
  }

  // 2. Standard identifiers (musicbrainz.org recording URLs, bare uuids, isrc:).
  for (const identifier of facts.identifiers) {
    if (!claimedMbid) {
      const mbid = mbidFromIdentifier(identifier);
      if (mbid) claimedMbid = mbid;
    }
    if (!claimedIsrc) claimedIsrc = isrcFromIdentifier(identifier);
  }

  return {
    position,
    title: asText(facts.title),
    creator: asText(facts.creator),
    album: asText(facts.album),
    durationMs: asDurationMs(facts.duration),
    claimedMbid,
    claimedMbidFromLore,
    claimedIsrc,
  };
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectMeta(value: unknown): Array<{ rel: string; content: string }> {
  const out: Array<{ rel: string; content: string }> = [];
  for (const item of toArray(value as Record<string, unknown> | Record<string, unknown>[])) {
    if (item == null || typeof item !== "object") continue;
    const rel = asText((item as Record<string, unknown>).rel ?? (item as Record<string, unknown>)["@_rel"]);
    const content = asText(
      (item as Record<string, unknown>).content ?? (item as Record<string, unknown>)["#text"],
    );
    if (rel && content) out.push({ rel: rel.toLowerCase(), content });
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSPF
// ---------------------------------------------------------------------------

function parseJspf(raw: string): ImportedSetParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "This file is not valid JSON, so it cannot be read as a JSPF playlist." };
  }
  const playlist = (parsed as { playlist?: unknown })?.playlist;
  if (playlist == null || typeof playlist !== "object" || Array.isArray(playlist)) {
    return { ok: false, error: "JSPF files must contain a top-level \"playlist\" object." };
  }
  const p = playlist as Record<string, unknown>;
  const tracks = toArray(p.track as unknown[]);
  if (tracks.length === 0) {
    return { ok: false, error: "This playlist contains no tracks." };
  }
  if (tracks.length > IMPORTED_SET_MAX_TRACKS) {
    return {
      ok: false,
      error: `This playlist has ${tracks.length} tracks — the import limit is ${IMPORTED_SET_MAX_TRACKS}.`,
    };
  }
  const entries = tracks.map((track, position) => {
    const t = (track ?? {}) as Record<string, unknown>;
    return normalizeEntry(position, {
      title: t.title,
      creator: t.creator,
      album: t.album,
      duration: t.duration,
      identifiers: toArray(t.identifier as string | string[])
        .filter((id): id is string => typeof id === "string"),
      meta: collectMeta(t.meta),
    });
  });
  return {
    ok: true,
    manifest: { format: "jspf", title: asText(p.title), entries },
  };
}

// ---------------------------------------------------------------------------
// XSPF
// ---------------------------------------------------------------------------

/** Any DTD / entity declaration is an immediate rejection — before parsing. */
const XML_DTD_RE = /<!\s*(?:DOCTYPE|ENTITY)/i;

function parseXspf(raw: string): ImportedSetParseResult {
  if (XML_DTD_RE.test(raw)) {
    return {
      ok: false,
      error: "This XML file declares a DTD or entity, which imports do not accept for safety.",
    };
  }
  const valid = XMLValidator.validate(raw);
  if (valid !== true) {
    return { ok: false, error: "This file is not well-formed XML, so it cannot be read as an XSPF playlist." };
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) =>
      name === "track" || name === "identifier" || name === "location" || name === "meta",
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "This XML file could not be parsed as an XSPF playlist." };
  }
  const playlist = doc.playlist as Record<string, unknown> | undefined;
  if (playlist == null || typeof playlist !== "object") {
    return { ok: false, error: "XSPF files must have a root <playlist> element." };
  }
  const trackList = playlist.trackList as Record<string, unknown> | undefined;
  const tracks = toArray(trackList?.track as unknown[]);
  if (tracks.length === 0) {
    return { ok: false, error: "This playlist contains no tracks." };
  }
  if (tracks.length > IMPORTED_SET_MAX_TRACKS) {
    return {
      ok: false,
      error: `This playlist has ${tracks.length} tracks — the import limit is ${IMPORTED_SET_MAX_TRACKS}.`,
    };
  }
  const entries = tracks.map((track, position) => {
    const t = (track ?? {}) as Record<string, unknown>;
    // Foreign extensions are tolerated; only lore:* facts (never provenance)
    // are read out of <extension> children.
    const extensionMeta: Array<{ rel: string; content: string }> = [];
    for (const ext of toArray(t.extension as Record<string, unknown> | Record<string, unknown>[])) {
      if (ext == null || typeof ext !== "object") continue;
      for (const [key, value] of Object.entries(ext)) {
        if (key.startsWith("@_")) continue;
        const content = asText(value);
        if (content) extensionMeta.push({ rel: key.toLowerCase(), content });
      }
    }
    return normalizeEntry(position, {
      title: t.title,
      creator: t.creator,
      album: t.album,
      duration: t.duration,
      identifiers: toArray(t.identifier as string | string[])
        .filter((id): id is string => typeof id === "string"),
      meta: [...collectMeta(t.meta), ...extensionMeta],
    });
  });
  return {
    ok: true,
    manifest: { format: "xspf", title: asText(playlist.title), entries },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse an uploaded playlist file into the one ordered manifest vocabulary.
 * `content` is the raw file text; format is sniffed from the content itself
 * (with the filename extension as a tiebreaker), so a mislabeled but valid
 * file still imports.
 */
export function parseImportedSet(
  content: string,
  filename: string,
): ImportedSetParseResult {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes === 0) return { ok: false, error: "The uploaded file is empty." };
  if (bytes > IMPORTED_SET_MAX_BYTES) {
    return {
      ok: false,
      error: `This file is ${(bytes / 1_048_576).toFixed(1)} MB — the import limit is 1 MB.`,
    };
  }
  const head = content.replace(/^\uFEFF/, "").trimStart();
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (head.startsWith("{")) return parseJspf(head);
  if (head.startsWith("<")) return parseXspf(head);
  if (ext === "jspf" || ext === "json") return parseJspf(head);
  if (ext === "xspf" || ext === "xml") return parseXspf(head);
  return {
    ok: false,
    error: "Only XSPF (XML) and JSPF (JSON) playlist files can be imported.",
  };
}
