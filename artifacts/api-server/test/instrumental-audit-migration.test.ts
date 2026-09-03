import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyInstrumentalAuditMigration } from "../src/lore/instrumental-audit-migration.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: { execute: vi.fn().mockResolvedValue(undefined) },
  };
});

describe("applyInstrumentalAuditMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is idempotent and issues only guarded DDL/backfill statements", async () => {
    const { db } = await import("@workspace/db");
    await expect(applyInstrumentalAuditMigration()).resolves.not.toThrow();
    const firstPass = (db.execute as ReturnType<typeof vi.fn>).mock.calls
      .map(([statement]) => JSON.stringify(statement))
      .join("\n");
    expect(firstPass).toContain("ADD COLUMN IF NOT EXISTS lyric_status");
    expect(firstPass).toContain("offset_ms = -1");
    expect(firstPass).toContain("no_result");
    expect(firstPass).not.toContain("instrumental'::text");

    await expect(applyInstrumentalAuditMigration()).resolves.not.toThrow();
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(10);
  });

  it("propagates DB failures to the boot migration registry", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("migration failed"),
    );
    await expect(applyInstrumentalAuditMigration()).rejects.toThrow(
      "migration failed",
    );
  });
});