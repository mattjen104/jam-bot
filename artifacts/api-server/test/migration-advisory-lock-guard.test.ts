import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard: any boot-migration transaction containing DDL must acquire a
 * transaction-scoped advisory lock as its FIRST executed statement.
 *
 * Why: a migration transaction holding more than one lock — e.g. a SELECT
 * (AccessShare) followed by ALTER TABLE (AccessExclusive), or DDL touching
 * two tables — deadlocks (Postgres 40P01) when parallel test workers or
 * concurrent production boots run it simultaneously. Serializing via
 * `pg_advisory_xact_lock` (see src/lore/migration-advisory-lock.ts) makes
 * concurrent callers queue instead of deadlocking.
 *
 * This scans src/lore/*-migration.ts source text so NEW migrations cannot
 * silently reintroduce the deadlock class.
 */

const LORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lore");

const DDL_PATTERN =
  /\b(ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)|CREATE\s+MATERIALIZED\s+VIEW|DROP\s+(?:TABLE|INDEX|VIEW)|TRUNCATE)\b/i;

const LOCK_PATTERN = /acquireMigrationLock|pg_advisory_xact_lock/;

interface TxBlock {
  file: string;
  /** 1-based line where `.transaction(` appears */
  line: number;
  body: string;
}

/** Extract each `.transaction(` call body via balanced-paren scanning. */
function extractTransactionBlocks(file: string, source: string): TxBlock[] {
  const blocks: TxBlock[] = [];
  const marker = ".transaction(";
  let idx = source.indexOf(marker);
  while (idx !== -1) {
    const start = idx + marker.length - 1; // position of the opening paren
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push({
      file,
      line: source.slice(0, idx).split("\n").length,
      body: source.slice(start + 1, end),
    });
    idx = source.indexOf(marker, end);
  }
  return blocks;
}

/** The first `execute(` call inside a transaction body, with its argument text. */
function firstExecuteStatement(body: string): string | null {
  const m = body.match(/\.execute\s*\(/);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return body.slice(start + 1, i);
    }
  }
  return body.slice(start + 1);
}

const migrationFiles = readdirSync(LORE_DIR).filter((f) => f.endsWith("-migration.ts"));

describe("migration advisory-lock guard", () => {
  it("finds the migration files it is supposed to scan", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it("every migration transaction containing DDL acquires an advisory lock as its first statement", () => {
    const violations: string[] = [];

    for (const file of migrationFiles) {
      const source = readFileSync(join(LORE_DIR, file), "utf8");
      for (const block of extractTransactionBlocks(file, source)) {
        if (!DDL_PATTERN.test(block.body)) continue;
        const first = firstExecuteStatement(block.body);
        if (first === null || !LOCK_PATTERN.test(first)) {
          violations.push(
            `${block.file}:${block.line} — transaction contains DDL but its first ` +
              `statement is not an advisory lock. Acquire ` +
              `acquireMigrationLock(MIGRATION_LOCK_KEYS.<key>) (from ` +
              `./migration-advisory-lock.ts) as the FIRST tx.execute(...) so ` +
              `concurrent boots/test workers queue instead of deadlocking (40P01).`,
          );
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("advisory lock keys are unique across migrations", async () => {
    const { MIGRATION_LOCK_KEYS } = await import("../src/lore/migration-advisory-lock.js");
    const keys = Object.values(MIGRATION_LOCK_KEYS);
    expect(new Set(keys.map(String)).size).toBe(keys.length);
  });

  it("flags a DDL transaction that skips the lock (self-test of the scanner)", () => {
    const bad = `
      await db.transaction(async (tx) => {
        const rows = await tx.execute(sql\`SELECT 1 FROM foo\`);
        await tx.execute(sql\`ALTER TABLE foo ADD COLUMN bar text\`);
      });
    `;
    const blocks = extractTransactionBlocks("fixture.ts", bad);
    expect(blocks).toHaveLength(1);
    expect(DDL_PATTERN.test(blocks[0].body)).toBe(true);
    const first = firstExecuteStatement(blocks[0].body);
    expect(first !== null && LOCK_PATTERN.test(first)).toBe(false);

    const good = `
      await db.transaction(async (tx) => {
        await tx.execute(acquireMigrationLock(MIGRATION_LOCK_KEYS.foo));
        await tx.execute(sql\`ALTER TABLE foo ADD COLUMN bar text\`);
      });
    `;
    const goodBlock = extractTransactionBlocks("fixture.ts", good)[0];
    const goodFirst = firstExecuteStatement(goodBlock.body);
    expect(goodFirst !== null && LOCK_PATTERN.test(goodFirst)).toBe(true);
  });
});
