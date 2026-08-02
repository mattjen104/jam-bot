import {
  db,
  libraryItemsTable,
  pickersTable,
  showsTable,
  spinsTable,
  stationsTable,
  type LibraryItemProvenance,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { buildKeepProvenance } from "../routes/me/keep.js";

const MIGRATION_NAME = "applyLibraryProvenanceBackfill";

/**
 * These are the claims that can be derived from a spin join.  The two client
 * context fields are deliberately excluded: they are useful analytics input,
 * but are not an attribution disagreement.
 */
const DERIVED_ATTRIBUTION_KEYS = [
  "stationSlug",
  "stationName",
  "showName",
  "djName",
  "pickerHandle",
  "pickerName",
  "playedAt",
] as const;

export interface LibraryProvenanceBackfillReport {
  processedRows: number;
  spinLinkedRows: number;
  noSpinRows: number;
  updatedRows: number;
  mismatchCount: number;
}

export interface LibraryProvenanceBackfillOptions {
  /**
   * Test-only scope. Production callers must omit this so the one-shot repair
   * covers every eligible library item.
   */
  _testUserIds?: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Compare JSON values without depending on object key insertion order.
 * Provenance comes from jsonb, where key order is not meaningful.
 */
function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && jsonEqual(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

/**
 * True when a stored spin-linked row made a different attribution claim than
 * the server-derived provenance. Unknown legacy keys are cleaned up, but do
 * not inflate this count because they are not attribution claims.
 */
export function hasDerivedAttributionMismatch(
  stored: unknown,
  derived: LibraryItemProvenance,
): boolean {
  const input = isRecord(stored) ? stored : {};
  return DERIVED_ATTRIBUTION_KEYS.some((key) => {
    const storedHas = hasOwn(input, key);
    const derivedHas = hasOwn(derived, key);
    return storedHas !== derivedHas || (storedHas && !jsonEqual(input[key], derived[key]));
  });
}

/**
 * Repair legacy keep provenance once, using the same whitelist and trusted
 * spin derivation as POST /api/me/keep.
 *
 * Rows with a spin are authoritative even if their old JSON claimed another
 * station/show.  Keep rows without a spin are normalized to context-only
 * provenance; imported rows are intentionally left untouched.
 */
export async function applyLibraryProvenanceBackfill(
  opts?: LibraryProvenanceBackfillOptions,
): Promise<LibraryProvenanceBackfillReport> {
  return db.transaction(async (tx) => {
    const completionCheck = await tx.execute(
      sql`SELECT 1 FROM migration_completions WHERE name = ${MIGRATION_NAME} LIMIT 1`,
    );
    if ((completionCheck.rows?.length ?? 0) > 0) {
      console.info("[migration] library provenance backfill: already complete, skipping");
      return {
        processedRows: 0,
        spinLinkedRows: 0,
        noSpinRows: 0,
        updatedRows: 0,
        mismatchCount: 0,
      };
    }

    const userFilter =
      opts?._testUserIds?.length
        ? inArray(libraryItemsTable.userId, opts._testUserIds)
        : undefined;

    const rows = await tx
      .select({
        id: libraryItemsTable.id,
        userId: libraryItemsTable.userId,
        spinId: libraryItemsTable.spinId,
        provenance: libraryItemsTable.provenance,
        linkedSpinId: spinsTable.id,
        playedAt: spinsTable.playedAt,
        stationSlug: stationsTable.slug,
        stationName: stationsTable.name,
        showName: showsTable.name,
        djName: showsTable.djName,
        pickerHandle: pickersTable.handle,
        pickerName: pickersTable.name,
      })
      .from(libraryItemsTable)
      .leftJoin(spinsTable, eq(libraryItemsTable.spinId, spinsTable.id))
      .leftJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
      .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
      .leftJoin(pickersTable, eq(showsTable.pickerId, pickersTable.id))
      .where(userFilter);

    const report: LibraryProvenanceBackfillReport = {
      processedRows: 0,
      spinLinkedRows: 0,
      noSpinRows: 0,
      updatedRows: 0,
      mismatchCount: 0,
    };

    for (const row of rows) {
      const stored = isRecord(row.provenance) ? row.provenance : {};
      const hasSpin = row.linkedSpinId != null;

      // library_items also stores streaming-service imports. They have no
      // spinId and their service provenance is not part of this repair.
      if (!hasSpin && (stored as Record<string, unknown>)["kind"] === "import") continue;

      report.processedRows += 1;
      if (hasSpin) report.spinLinkedRows += 1;
      else report.noSpinRows += 1;

      const spin = hasSpin
        ? {
            stationSlug: row.stationSlug!,
            stationName: row.stationName!,
            showName: row.showName,
            djName: row.djName,
            pickerHandle: row.pickerHandle,
            pickerName: row.pickerName,
            playedAt: row.playedAt!,
          }
        : null;
      const repaired = buildKeepProvenance(stored, spin);

      if (hasSpin && hasDerivedAttributionMismatch(stored, repaired)) {
        report.mismatchCount += 1;
      }
      if (!jsonEqual(stored, repaired)) {
        await tx
          .update(libraryItemsTable)
          .set({ provenance: repaired })
          .where(eq(libraryItemsTable.id, row.id));
        report.updatedRows += 1;
      }
    }

    console.info(
      `[migration] library provenance backfill: processed ${report.processedRows} row(s), ` +
        `updated ${report.updatedRows}, spin-linked ${report.spinLinkedRows}, ` +
        `no-spin ${report.noSpinRows}, mismatches ${report.mismatchCount}`,
    );

    await tx.execute(sql`
      INSERT INTO migration_completions (name)
      VALUES (${MIGRATION_NAME})
      ON CONFLICT (name) DO NOTHING
    `);

    return report;
  });
}