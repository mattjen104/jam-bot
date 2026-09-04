import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";
import { applyInstrumentalAuditMigration } from "../src/lore/instrumental-audit-migration.js";

function createDatabase() {
  const execute = vi.fn().mockResolvedValue(undefined);
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applyInstrumentalAuditMigration", () => {
  it("is idempotent and issues only guarded DDL/backfill statements", async () => {
    const { database, execute } = createDatabase();
    await expect(applyInstrumentalAuditMigration(database)).resolves.not.toThrow();
    const firstPass = execute.mock.calls
      .map(([statement]) => JSON.stringify(statement))
      .join("\n");
    expect(firstPass).toContain("ADD COLUMN IF NOT EXISTS lyric_status");
    expect(firstPass).toContain("offset_ms = -1");
    expect(firstPass).toContain("no_result");
    expect(firstPass).not.toContain("instrumental'::text");

    await expect(applyInstrumentalAuditMigration(database)).resolves.not.toThrow();
    expect(execute.mock.calls).toHaveLength(10);
  });

  it("propagates DB failures to the boot migration registry", async () => {
    const { database, execute } = createDatabase();
    execute.mockRejectedValueOnce(new Error("migration failed"));
    await expect(applyInstrumentalAuditMigration(database)).rejects.toThrow(
      "migration failed",
    );
  });
});