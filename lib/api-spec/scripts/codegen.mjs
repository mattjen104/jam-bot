#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireCodegenLock } from "./codegen-lock.mjs";

const SPEC_PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = resolve(SPEC_PKG_ROOT, "..", "..");
const ORVAL_BIN = join(SPEC_PKG_ROOT, "node_modules", ".bin", "orval");

let release;
try {
  release = acquireCodegenLock({
    role: "API client codegen",
    repoRoot: REPO_ROOT,
  });

  execFileSync(ORVAL_BIN, ["--config", "./orval.config.ts"], {
    cwd: SPEC_PKG_ROOT,
    env: { ...process.env, API_CODEGEN_COORDINATED: "1" },
    stdio: "inherit",
  });
  execFileSync(
    "pnpm",
    ["--filter", "@workspace/api-zod", "run", "typecheck"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  execFileSync(
    "pnpm",
    ["--filter", "@workspace/api-client-react", "run", "typecheck"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  execFileSync("node", ["scripts/check-contract.mjs"], {
    cwd: SPEC_PKG_ROOT,
    stdio: "inherit",
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
} finally {
  release?.();
}