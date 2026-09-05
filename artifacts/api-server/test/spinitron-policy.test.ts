import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))
      ? [path]
      : [];
  });
}

describe("Spinitron provider boundary", () => {
  it("never harvests the listener SPA", () => {
    const forbiddenHost = ["spa", "spinitron", "com"].join(".");
    const offenders = sourceFiles(join(import.meta.dirname, "..", "src"))
      .filter((path) => readFileSync(path, "utf8").includes(forbiddenHost));
    expect(offenders).toEqual([]);
  });
});