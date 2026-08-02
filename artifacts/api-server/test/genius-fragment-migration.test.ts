// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<void>) =>
  callback({ execute }),
);

vi.mock("@workspace/db", () => ({
  db: { transaction },
}));

const { applyGeniusFragmentPointerMigration } = await import(
  "../src/lore/genius-fragment-migration.js"
);

describe("Genius fragment pointer migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("backfills normalized receipts before dropping the legacy text column", async () => {
    execute
      .mockResolvedValueOnce({ rows: [] }) // completion ledger
      .mockResolvedValueOnce({ rows: [{ column_name: "fragment" }] }) // columns
      .mockResolvedValueOnce({ rows: [] }) // add hash
      .mockResolvedValueOnce({ rows: [] }) // add length
      .mockResolvedValueOnce({
        rows: [{ id: 19, fragment: "  Café—NOISE! \n  café-noise  " }],
      }) // legacy rows
      .mockResolvedValue({ rows: [] });

    await expect(applyGeniusFragmentPointerMigration()).resolves.toBeUndefined();

    const calls = execute.mock.calls;
    const statements = calls.map(([statement]) => {
      const chunks = statement.queryChunks as Array<string | { value?: unknown[] }>;
      return chunks
        .map((chunk) =>
          typeof chunk === "string" ? chunk : (chunk.value ?? []).join(","),
        )
        .join("");
    });
    expect(statements).toHaveLength(9);
    expect(statements[5]).toContain("UPDATE genius_annotation_drafts");
    expect(statements[5]).toContain("FROM (VALUES");
    expect(statements[6]).toContain("ALTER TABLE genius_annotation_drafts");
    expect(statements[7]).toContain("DROP COLUMN IF EXISTS fragment");
    expect(statements[8]).toContain("INSERT INTO migration_completions");
  });

  it("does not touch rows again after the completion ledger is present", async () => {
    execute.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    await applyGeniusFragmentPointerMigration();

    expect(execute).toHaveBeenCalledOnce();
  });
});