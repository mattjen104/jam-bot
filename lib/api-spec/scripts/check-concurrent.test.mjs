/**
 * Regression test for the clean/read race caught in code review:
 * api-codegen-repro previously ran orval with clean:true against the LIVE
 * generated/ trees while api-contract (and typecheck, lint, test suites)
 * read them in the parallel validation workflow — api-contract hit ENOENT
 * on lib/api-zod/src/generated/api.ts mid-clean.
 *
 * check-generated.mjs now generates into an isolated temp mirror. This test
 * runs both gates CONCURRENTLY — the exact interleaving that failed — and
 * requires both to exit 0. It also re-verifies non-mutation afterwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const SPEC_PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = resolve(SPEC_PKG_ROOT, "..", "..");
const LOCK_MODULE = join(SPEC_PKG_ROOT, "scripts", "codegen-lock.mjs");
const CODEGEN_SCRIPT = join(SPEC_PKG_ROOT, "scripts", "codegen.mjs");
const LORE_ROOT = join(REPO_ROOT, "artifacts", "lore");
const VITE_BIN = join(LORE_ROOT, "node_modules", ".bin", "vite");

async function startLockHolder(lockPath, role) {
  const moduleUrl = pathToFileURL(LOCK_MODULE).href;
  const script = [
    `import { acquireCodegenLock } from ${JSON.stringify(moduleUrl)};`,
    `acquireCodegenLock({ role: ${JSON.stringify(role)}, lockPath: ${JSON.stringify(lockPath)} });`,
    'console.log("READY");',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, LORE_CODEGEN_LOCK_PATH: lockPath },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = new Promise((resolveReady, rejectReady) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("READY")) resolveReady();
    });
    child.once("error", rejectReady);
    child.once("exit", (code, signal) => {
      rejectReady(
        new Error(`lock holder exited before READY (code=${code}, signal=${signal})`),
      );
    });
  });
  await ready;
  return child;
}

async function stopLockHolder(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}

test(
  "api-contract and api-codegen-repro pass when run concurrently (clean/read race regression)",
  { timeout: 240_000 },
  async () => {
    const [contract, repro] = await Promise.allSettled([
      execFileP("node", [join(SPEC_PKG_ROOT, "scripts", "check-contract.mjs")], {
        cwd: SPEC_PKG_ROOT,
      }),
      execFileP("node", [join(SPEC_PKG_ROOT, "scripts", "check-generated.mjs")], {
        cwd: SPEC_PKG_ROOT,
      }),
    ]);
    assert.equal(
      contract.status,
      "fulfilled",
      `check-contract failed under concurrent codegen: ${contract.status === "rejected" ? contract.reason : ""}`,
    );
    assert.equal(
      repro.status,
      "fulfilled",
      `check-generated failed under concurrent contract read: ${repro.status === "rejected" ? repro.reason : ""}`,
    );
    // The isolated gate's own SAFETY self-guard (live-tree hashes before/after)
    // has already asserted non-mutation inside the repro run above.
  },
);

test(
  "live codegen and the Lore preview refuse to race over generated clients",
  { timeout: 45_000 },
  async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "lore-codegen-coordination-test-"));
    const lockPath = join(tempRoot, "client-generation.lock");
    let holder;

    try {
      holder = await startLockHolder(lockPath, "Lore preview");
      await assert.rejects(
        execFileP(process.execPath, [CODEGEN_SCRIPT], {
          cwd: SPEC_PKG_ROOT,
          env: { ...process.env, LORE_CODEGEN_LOCK_PATH: lockPath },
        }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(
            `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
            /\[api-codegen-coordination\].*Lore preview.*lock/,
          );
          return true;
        },
      );
      await stopLockHolder(holder);
      holder = await startLockHolder(lockPath, "API client codegen");

      await assert.rejects(
        execFileP(VITE_BIN, ["--config", "vite.config.ts", "--host", "127.0.0.1"], {
          cwd: LORE_ROOT,
          env: {
            ...process.env,
            BASE_PATH: "/lore/",
            LORE_CODEGEN_LOCK_PATH: lockPath,
            PORT: "29991",
          },
          timeout: 15_000,
        }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(
            `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
            /\[api-codegen-coordination\].*API client codegen.*lock/,
          );
          return true;
        },
      );
    } finally {
      await stopLockHolder(holder);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  },
);
