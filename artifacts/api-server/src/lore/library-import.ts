import type { LibraryItemProvenance } from "@workspace/db";

/**
 * `lore.library.v1` file import — pure parsing/validation, no DB access.
 *
 * Round-trip contract: a file produced by the export builder imports back to
 * an identical library — same mbids, added_at, and provenance preserved
 * verbatim (including spin-derived keys like `station` / `spun_at` merged in
 * at export time; jsonb keeps them as-is).
 *
 * Structural failures (not our format, wrong version, no items array) reject
 * the whole file with a clear message. Per-item field failures reject just
 * that item, with an indexed reason — never partial-silent.
 */

export interface ParsedImportItem {
  /** Position in the original file's items array — for accurate error reporting. */
  sourceIndex: number;
  mbid: string;
  /** Title/artist from the file — used only to seed an unknown-mbid spine row. */
  title: string | null;
  artist: string | null;
  isrc: string | null;
  releaseYear: number | null;
  addedAt: Date;
  provenance: LibraryItemProvenance;
}

export interface ImportItemError {
  index: number;
  reason: string;
}

export type ParseImportResult =
  | { ok: true; items: ParsedImportItem[]; itemErrors: ImportItemError[] }
  | { ok: false; error: string };

const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max items per import file — matches the export cap. */
export const IMPORT_MAX_ITEMS = 50_000;

export function parseLibraryImport(body: unknown): ParseImportResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Not a lore.library export file (expected a JSON object)." };
  }
  const b = body as Record<string, unknown>;
  if (b["format"] !== "lore.library.v1") {
    return {
      ok: false,
      error: `Unsupported format ${JSON.stringify(b["format"] ?? null)} — expected "lore.library.v1".`,
    };
  }
  if (!Array.isArray(b["items"])) {
    return { ok: false, error: "Malformed file: missing items array." };
  }
  const rawItems = b["items"] as unknown[];
  if (rawItems.length > IMPORT_MAX_ITEMS) {
    return { ok: false, error: `Too many items (${rawItems.length} > ${IMPORT_MAX_ITEMS}).` };
  }

  const items: ParsedImportItem[] = [];
  const itemErrors: ImportItemError[] = [];

  rawItems.forEach((raw, index) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      itemErrors.push({ index, reason: "not an object" });
      return;
    }
    const it = raw as Record<string, unknown>;

    const mbid = typeof it["mbid"] === "string" ? it["mbid"].trim().toLowerCase() : "";
    if (!MBID_RE.test(mbid)) {
      itemErrors.push({ index, reason: "missing or malformed mbid" });
      return;
    }

    const addedAtRaw = it["added_at"];
    const addedAt = typeof addedAtRaw === "string" ? new Date(addedAtRaw) : null;
    if (!addedAt || isNaN(addedAt.getTime())) {
      itemErrors.push({ index, reason: "missing or malformed added_at" });
      return;
    }

    const provRaw = it["provenance"];
    if (provRaw == null || typeof provRaw !== "object" || Array.isArray(provRaw)) {
      itemErrors.push({ index, reason: "missing provenance object" });
      return;
    }
    const prov = provRaw as Record<string, unknown>;
    if (typeof prov["kind"] !== "string" || !prov["kind"].trim()) {
      itemErrors.push({ index, reason: "provenance.kind must be a non-empty string" });
      return;
    }

    const str = (k: string): string | null =>
      typeof it[k] === "string" && (it[k] as string).trim() ? (it[k] as string).trim() : null;
    const year =
      typeof it["year"] === "number" && Number.isInteger(it["year"]) ? (it["year"] as number) : null;

    items.push({
      sourceIndex: index,
      mbid,
      title: str("title"),
      artist: str("artist"),
      isrc: str("isrc"),
      releaseYear: year,
      addedAt,
      // Preserved verbatim — round-trip fidelity beats normalization here.
      provenance: prov as LibraryItemProvenance,
    });
  });

  return { ok: true, items, itemErrors };
}
