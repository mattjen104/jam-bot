// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";

import { applyGeniusFragmentPointerMigration } from "../src/lore/genius-fragment-migration.js";

function createDatabase() {
  const execute = vi.fn();
  const transaction = vi.fn(
    async (callback: (tx: { execute: typeof execute }) => Promise<void>) =>
      callback({ execute }),
  );
  return {
    database: { transaction } as unknown as Pick<typeof db, "transaction">,
    execute,
  };
}

describe("Genius fragment pointer migration", () => {
  it("backfills normalized receipts before dropping the legacy text column", async () => {
    const { database, execute } = createDatabase();
    execute
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // completion ledger
      .mockResolvedValueOnce({ rows: [{ column_name: "fragment" }] }) // columns
      .mockResolvedValueOnce({ rows: [] }) // add hash
      .mockResolvedValueOnce({ rows: [] }) // add length
      .mockResolvedValueOnce({
        rows: [{ id: 19, fragment: "  Café—NOISE! \n  café-noise  " }],
      }) // legacy rows
      .mockResolvedValue({ rows: [] });

    await expect(applyGeniusFragmentPointerMigration(database)).resolves.toBeUndefined();

    const calls = execute.mock.calls;
    const statements = calls.map(([statement]) => {
      const chunks = statement.queryChunks as Array<string | { value?: unknown[] }>;
      return chunks
        .map((chunk) =>
          typeof chunk === "string" ? chunk : (chunk.value ?? []).join(","),
        )
        .join("");
    });
    expect(statements).toHaveLength(10);
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[6]).toContain("UPDATE genius_annotation_drafts");
    expect(statements[6]).toContain("FROM (VALUES");
    expect(statements[7]).toContain("ALTER TABLE genius_annotation_drafts");
    expect(statements[8]).toContain("DROP COLUMN IF EXISTS fragment");
    expect(statements[9]).toContain("INSERT INTO migration_completions");
  });

  it("does not touch rows again after the completion ledger is present", async () => {
    const { database, execute } = createDatabase();
    execute
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    await applyGeniusFragmentPointerMigration(database);

    // Advisory lock + completion-ledger check only — no row-touching DDL/DML.
    expect(execute).toHaveBeenCalledTimes(2);
  });
});