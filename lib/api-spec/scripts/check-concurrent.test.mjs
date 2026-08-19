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
import { execFile } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const SPEC_PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

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
