import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEFAULT_REPO_ROOT = resolve(MODULE_ROOT, "..", "..");

function defaultLockPath(repoRoot) {
  const projectId = createHash("sha256")
    .update(resolve(repoRoot))
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), `lore-api-codegen-${projectId}.lock`);
}

function readOwner(lockPath) {
  try {
    const ownerFile = join(lockPath, "owner.json");
    return JSON.parse(readFileSync(ownerFile, "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function describeOwner(owner) {
  if (!owner) return "an unidentifiable process";
  const pid = Number.isInteger(owner.pid) ? ` (pid ${owner.pid})` : "";
  return `${owner.role ?? "another Lore process"}${pid}`;
}

/**
 * Keep destructive client generation and Vite's module graph out of the same
 * generated tree at the same time. The lock directory is created atomically,
 * and the owner metadata lets a later invocation recover after a killed
 * process without making normal concurrent starts wait indefinitely.
 */
export function acquireCodegenLock({
  role = "API client codegen",
  repoRoot = DEFAULT_REPO_ROOT,
  lockPath = process.env.LORE_CODEGEN_LOCK_PATH || defaultLockPath(repoRoot),
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });

  for (;;) {
    const token = randomUUID();
    try {
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, "owner.json"),
        JSON.stringify({ pid: process.pid, role, token }),
        "utf8",
      );

      let released = false;
      const release = () => {
        if (released) return;
        released = true;

        const owner = readOwner(lockPath);
        if (owner?.token !== token) return;
        rmSync(lockPath, { recursive: true, force: true });
      };
      process.once("exit", release);
      return () => {
        release();
        process.removeListener("exit", release);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const owner = readOwner(lockPath);
      if (owner?.pid && !isProcessAlive(owner.pid)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }

      const holder = describeOwner(owner);
      throw new Error(
        `[api-codegen-coordination] ${role} cannot start because ${holder} ` +
          `already owns the client-generation lock. Stop the other process ` +
          `before continuing so generated modules are never removed while ` +
          `the Lore preview is reading them.`,
      );
    }
  }
}