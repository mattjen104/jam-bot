import type { LibraryItemProvenance } from "@workspace/db";

/**
 * Library export formatting — pure functions, no DB access.
 *
 * The export endpoint runs ONE provenance-joined query and streams the result
 * through one of these builders. Honesty rule: fields we don't have export as
 * empty (CSV) or null (JSON) — never fabricated.
 */

/** One provenance-joined library row, ready to format. */
export interface LibraryExportRow {
  mbid: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  releaseGroupMbid: string | null;
  releaseYear: number | null;
  isrc: string | null;
  addedAt: Date;
  provenance: LibraryItemProvenance;
  /** Joined spin context when the keep is linked to a real play. */
  spin: {
    stationSlug: string | null;
    stationName: string | null;
    showName: string | null;
    playedAt: Date | null;
  } | null;
}

export const EXPORT_FORMATS = ["csv", "json", "m3u8", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === "string" && (EXPORT_FORMATS as readonly string[]).includes(v);
}

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  m3u8: "audio/mpegurl; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** RFC 4180: quote a field when it contains comma, quote, or newline. */
export function csvField(v: string | null | undefined): string {
  const s = v ?? "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV with the exact header `title,artist,album,isrc`; empty, never "null". */
export function buildCsv(rows: LibraryExportRow[]): string {
  const lines = ["title,artist,album,isrc"];
  for (const r of rows) {
    lines.push(
      [csvField(r.title), csvField(r.artist), csvField(r.album), csvField(r.isrc)].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Provenance object for JSON export: stored keys + joined spin context. */
function exportProvenance(r: LibraryExportRow): Record<string, unknown> {
  const p: Record<string, unknown> = { ...r.provenance };
  if (r.spin) {
    if (r.spin.stationSlug) p["station"] = r.spin.stationSlug;
    if (r.spin.stationName) p["station_name"] = r.spin.stationName;
    if (r.spin.showName) p["show"] = r.spin.showName;
    if (r.spin.playedAt) p["spun_at"] = r.spin.playedAt.toISOString();
  }
  return p;
}

/** `lore.library.v1` — full-fidelity round-trippable format. */
export function buildJson(rows: LibraryExportRow[], exportedAt: Date): string {
  return JSON.stringify(
    {
      format: "lore.library.v1",
      exported_at: exportedAt.toISOString(),
      count: rows.length,
      items: rows.map((r) => ({
        mbid: r.mbid,
        isrc: r.isrc,
        title: r.title,
        artist: r.artist,
        release_group_mbid: r.releaseGroupMbid,
        album: r.album,
        year: r.releaseYear,
        added_at: r.addedAt.toISOString(),
        provenance: exportProvenance(r),
      })),
    },
    null,
    2,
  );
}

/** M3U8: `#EXTM3U` header + `#EXTINF:-1,Artist - Title` per track. */
export function buildM3u8(rows: LibraryExportRow[]): string {
  const lines = ["#EXTM3U"];
  for (const r of rows) {
    const artist = r.artist ?? "";
    const title = r.title ?? r.mbid;
    lines.push(`#EXTINF:-1,${artist ? `${artist} - ${title}` : title}`);
  }
  return lines.join("\n") + "\n";
}

/** TXT: `Artist — Title (Album, Year)`; paren block degrades honestly. */
export function buildTxt(rows: LibraryExportRow[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    const head = r.artist ? `${r.artist} — ${r.title ?? r.mbid}` : (r.title ?? r.mbid);
    const parenParts = [r.album, r.releaseYear != null ? String(r.releaseYear) : null].filter(
      (x): x is string => !!x,
    );
    lines.push(parenParts.length ? `${head} (${parenParts.join(", ")})` : head);
  }
  return lines.join("\n") + "\n";
}

export function buildExport(
  format: ExportFormat,
  rows: LibraryExportRow[],
  exportedAt: Date,
): string {
  switch (format) {
    case "csv":
      return buildCsv(rows);
    case "json":
      return buildJson(rows, exportedAt);
    case "m3u8":
      return buildM3u8(rows);
    case "txt":
      return buildTxt(rows);
  }
}
