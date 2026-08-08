import { createHash } from "node:crypto";
import type { ReplayManifest } from "./replay.js";

export const REPLAY_EXPORT_GENERATOR = "Lore Ghost Replay";

/**
 * Canonical ordered-track checksum: sha256 hex over one JSON line per track,
 * in broadcast order, each line being the array
 * `[position, spinId, playedAt, rawArtist, rawTitle, recordingMbid|null]`
 * joined by "\n". Deterministic for a given manifest — export time, coverage
 * counts, and service links are deliberately excluded so re-exports of the
 * same run verify identically. This is an integrity marker, not
 * authentication.
 */
export function replayTracksChecksum(model: ReplayExportModel): string {
  const canonical = model.entries
    .map((entry) =>
      JSON.stringify([
        entry.position,
        entry.spinId,
        entry.playedAt,
        entry.rawArtist,
        entry.rawTitle,
        entry.recording?.mbid ?? null,
      ]),
    )
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface ReplayExportOptions {
  /** Factual export timestamp (ISO 8601). Defaults to now. */
  exportedAt?: string;
}

export const REPLAY_EXPORT_FORMATS = ["jspf", "xspf", "m3u8", "csv"] as const;
export type ReplayExportFormat = (typeof REPLAY_EXPORT_FORMATS)[number];

export function isReplayExportFormat(value: unknown): value is ReplayExportFormat {
  return (
    typeof value === "string" &&
    (REPLAY_EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

export const REPLAY_EXPORT_CONTENT_TYPES: Record<ReplayExportFormat, string> = {
  jspf: "application/jspf+json; charset=utf-8",
  xspf: "application/xspf+xml; charset=utf-8",
  m3u8: "audio/mpegurl; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

export type ReplayCoverageStatus =
  | "resolved"
  | "unresolved"
  | "not-on-service"
  | "dead-link";

export interface ReplayExportEntry
  extends Omit<ReplayManifest["entries"][number], "recording"> {
  recording: ReplayManifest["entries"][number]["recording"];
  /** Exact, live service-neutral URLs only. Search links are never included. */
  serviceUrls: string[];
  coverageStatus: ReplayCoverageStatus;
}

export interface ReplayExportModel
  extends Omit<ReplayManifest, "entries"> {
  entries: ReplayExportEntry[];
}

export interface ReplayServiceMapping {
  service: string;
  url: string;
  deadLink: boolean;
  confidence: string;
}

/**
 * Turn the immutable replay manifest plus the optional materialization read
 * model into the one export view consumed by every serializer.
 *
 * `recording.links` is a public presentation cache, so only exact links are
 * accepted. Durable service mappings take precedence when present and dead
 * mappings are retained as coverage state, but never emitted as locations.
 */
export function materializeReplayExport(
  manifest: ReplayManifest,
  mappingsByMbid: ReadonlyMap<string, ReplayServiceMapping[]> = new Map(),
): ReplayExportModel {
  return {
    ...manifest,
    entries: manifest.entries.map((entry) => {
      if (!entry.recording) {
        return {
          ...entry,
          serviceUrls: [],
          coverageStatus: "unresolved",
        };
      }

      const mappings = mappingsByMbid.get(entry.recording.mbid) ?? [];
      const liveMappedUrls = mappings
        .filter((mapping) => !mapping.deadLink && mapping.confidence === "exact")
        .map((mapping) => mapping.url);
      const deadMappingExists = mappings.some(
        (mapping) => mapping.deadLink && mapping.confidence === "exact",
      );
      const mappedServices = new Set(mappings.map((mapping) => mapping.service));
      const exactRecordingUrls = (Array.isArray(entry.recording.links)
        ? entry.recording.links
        : []) as Array<{ name?: string; kind: string; url: string }>;
      const exactRecordingLinkUrls = exactRecordingUrls
        .filter((link) => link.kind === "exact")
        .filter((link) => {
          const service = link.name?.trim().toLowerCase().replace(/\s+/g, "_");
          return !service || !mappedServices.has(service);
        })
        .map((link) => link.url);
      const serviceUrls = [...new Set([...liveMappedUrls, ...exactRecordingLinkUrls])];

      return {
        ...entry,
        serviceUrls,
        coverageStatus:
          serviceUrls.length > 0
            ? "resolved"
            : deadMappingExists
              ? "dead-link"
              : "not-on-service",
      };
    }),
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function csvField(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function entryArtist(entry: ReplayExportEntry): string {
  return entry.recording?.artist || entry.rawArtist;
}

function entryTitle(entry: ReplayExportEntry): string {
  return entry.recording?.title || entry.rawTitle;
}

function mbidUrl(entry: ReplayExportEntry): string | null {
  return entry.recording
    ? `https://musicbrainz.org/recording/${encodeURIComponent(entry.recording.mbid)}`
    : null;
}

function receiptMeta(entry: ReplayExportEntry): Record<string, string> {
  return {
    position: String(entry.position),
    spin_id: String(entry.spinId),
    played_at: entry.playedAt,
    raw_artist: entry.rawArtist,
    raw_title: entry.rawTitle,
    confidence: entry.confidence,
    coverage_status: entry.coverageStatus,
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.citation ? { citation: entry.citation } : {}),
  };
}

/**
 * Interoperable identifier/timing facts for one entry. Every value is omitted
 * (never emitted empty or zero) when the underlying fact is not stored.
 */
function interopFacts(entry: ReplayExportEntry): Record<string, string> {
  const facts = entry.recordingFacts;
  return {
    ...(entry.recording ? { recording_mbid: entry.recording.mbid } : {}),
    ...(facts?.artistMbid ? { artist_mbid: facts.artistMbid } : {}),
    ...(facts?.isrc ? { isrc: facts.isrc } : {}),
    ...(facts?.durationMs != null && facts.durationMs > 0
      ? { duration_ms: String(facts.durationMs) }
      : {}),
    ...(facts?.releaseGroup ? { album_mbid: facts.releaseGroup.mbid } : {}),
    ...(facts?.releaseGroup?.title ? { album_title: facts.releaseGroup.title } : {}),
  };
}

function entryDurationMs(entry: ReplayExportEntry): number | null {
  const duration = entry.recordingFacts?.durationMs;
  return duration != null && duration > 0 ? duration : null;
}

function entryAlbumTitle(entry: ReplayExportEntry): string | null {
  return entry.recordingFacts?.releaseGroup?.title ?? null;
}

/** JSPF is the canonical JSON interchange format. Every broadcast slot stays. */
export function buildJspf(model: ReplayExportModel, options: ReplayExportOptions = {}): string {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const payload = {
    playlist: {
      title: `${model.station.name} · ${
        model.show?.name ?? "Station stream"
      } · ${model.bounds.date}`,
      creator: "Lore Ghost Replay",
      annotation:
        "Ordered reconstruction of a public broadcast; unresolved moments are intentionally preserved.",
      date: exportedAt,
      meta: [
        { rel: "lore:generator", content: REPLAY_EXPORT_GENERATOR },
        { rel: "lore:exported-at", content: exportedAt },
        { rel: "lore:tracks-sha256", content: replayTracksChecksum(model) },
        { rel: "lore:replay-id", content: String(model.replayId) },
        { rel: "lore:station", content: model.station.slug },
        { rel: "lore:date", content: model.bounds.date },
        { rel: "lore:coverage-total", content: String(model.coverage.total) },
        { rel: "lore:coverage-resolved", content: String(model.coverage.resolved) },
        { rel: "lore:coverage-unresolved", content: String(model.coverage.unresolved) },
      ],
      track: model.entries.map((entry) => {
        const identifier = mbidUrl(entry);
        const meta = { ...receiptMeta(entry), ...interopFacts(entry) };
        const duration = entryDurationMs(entry);
        const album = entryAlbumTitle(entry);
        return {
          title: entryTitle(entry),
          creator: entryArtist(entry),
          ...(album ? { album } : {}),
          ...(duration != null ? { duration } : {}),
          ...(identifier ? { identifier: [identifier] } : {}),
          meta: Object.entries(meta).map(([rel, content]) => ({ rel: `lore:${rel}`, content })),
        };
      }),
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function xspfExtension(entry: ReplayExportEntry): string {
  return Object.entries({ ...receiptMeta(entry), ...interopFacts(entry) })
    .map(([key, value]) => `<lore:${key}>${xmlEscape(value)}</lore:${key}>`)
    .join("");
}

/** XSPF keeps unresolved slots as tracks, omitting only unknown locations. */
export function buildXspf(model: ReplayExportModel, options: ReplayExportOptions = {}): string {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const tracks = model.entries
    .map((entry) => {
      const locations = entry.serviceUrls
        .map((url) => `<location>${xmlEscape(url)}</location>`)
        .join("");
      const identifier = mbidUrl(entry);
      const artistMbid = entry.recordingFacts?.artistMbid;
      const album = entryAlbumTitle(entry);
      const duration = entryDurationMs(entry);
      return [
        "    <track>",
        `      <title>${xmlEscape(entryTitle(entry))}</title>`,
        `      <creator>${xmlEscape(entryArtist(entry))}</creator>`,
        album ? `      <album>${xmlEscape(album)}</album>` : "",
        duration != null ? `      <duration>${duration}</duration>` : "",
        identifier ? `      <identifier>${xmlEscape(identifier)}</identifier>` : "",
        artistMbid
          ? `      <identifier>${xmlEscape(`https://musicbrainz.org/artist/${encodeURIComponent(artistMbid)}`)}</identifier>`
          : "",
        locations,
        `      <extension application="https://lore.radio/ghost-replay">${xspfExtension(entry)}</extension>`,
        "    </track>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const playlistMeta = [
    ["generator", REPLAY_EXPORT_GENERATOR],
    ["exported-at", exportedAt],
    ["tracks-sha256", replayTracksChecksum(model)],
    ["replay-id", String(model.replayId)],
  ] as const;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/" xmlns:lore="https://lore.radio/ghost-replay">',
    `  <title>${xmlEscape(model.station.name)} · ${xmlEscape(model.bounds.date)}</title>`,
    `  <creator>${xmlEscape(REPLAY_EXPORT_GENERATOR)}</creator>`,
    `  <date>${xmlEscape(exportedAt)}</date>`,
    ...playlistMeta.map(
      ([rel, content]) =>
        `  <meta rel="${xmlEscape(`https://lore.radio/ghost-replay/${rel}`)}">${xmlEscape(content)}</meta>`,
    ),
    "  <trackList>",
    tracks,
    "  </trackList>",
    "</playlist>",
    "",
  ].join("\n");
}

/** M3U8 preserves each slot; a gap marker is emitted when no exact location exists. */
export function buildM3u8(model: ReplayExportModel): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const entry of model.entries) {
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${entry.playedAt}`);
    lines.push(`#EXTINF:-1,${entryArtist(entry)} - ${entryTitle(entry)}`);
    if (entry.serviceUrls.length > 0) {
      lines.push(entry.serviceUrls[0]!);
    } else {
      lines.push("#EXT-X-GAP");
      lines.push(
        `# lore:position=${entry.position} spin_id=${entry.spinId} ` +
          `coverage=${entry.coverageStatus} raw_artist=${entry.rawArtist} ` +
          `raw_title=${entry.rawTitle}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** CSV is the lossless receipt view, including every resolved and unresolved slot. */
export function buildReplayCsv(model: ReplayExportModel, options: ReplayExportOptions = {}): string {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  // New interoperable columns are appended only — every pre-existing column
  // keeps its position so downstream consumers of the old schema still parse.
  // Generator/export-time/checksum metadata rides as leading `#`-comment
  // records (a common CSV convention) so the data header/row schema is
  // untouched; the checksum matches lore:tracks-sha256 in JSPF/XSPF.
  const lines = [
    `# generator: ${REPLAY_EXPORT_GENERATOR}`,
    `# exported-at: ${exportedAt}`,
    `# tracks-sha256: ${replayTracksChecksum(model)}`,
    "position,spin_id,played_at,raw_artist,raw_title,mbid,artist,title,coverage_status,confidence,source,citation,artist_mbid,isrc,duration_ms,album_mbid,album_title",
  ];
  for (const entry of model.entries) {
    const facts = entry.recordingFacts;
    lines.push(
      [
        entry.position,
        entry.spinId,
        entry.playedAt,
        entry.rawArtist,
        entry.rawTitle,
        entry.recording?.mbid ?? "",
        entry.recording?.artist ?? "",
        entry.recording?.title ?? "",
        entry.coverageStatus,
        entry.confidence,
        entry.source ?? "",
        entry.citation ?? "",
        facts?.artistMbid ?? "",
        facts?.isrc ?? "",
        entryDurationMs(entry) ?? "",
        facts?.releaseGroup?.mbid ?? "",
        facts?.releaseGroup?.title ?? "",
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function buildReplayExport(
  format: ReplayExportFormat,
  model: ReplayExportModel,
  options: ReplayExportOptions = {},
): string {
  switch (format) {
    case "jspf":
      return buildJspf(model, options);
    case "xspf":
      return buildXspf(model, options);
    case "m3u8":
      return buildM3u8(model);
    case "csv":
      return buildReplayCsv(model, options);
  }
}