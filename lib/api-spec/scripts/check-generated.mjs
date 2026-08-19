#!/usr/bin/env node
/**
 * Codegen reproducibility gate — ISOLATED variant.
 *
 * The validation workflow runs commands in PARALLEL, so this gate must never
 * mutate the live workspace: an orval run with `clean: true` against the real
 * generated/ directories races api-contract, typecheck, lint, and every test
 * suite that imports @workspace/api-zod (a prior version of this gate did
 * exactly that and was caught in code review via an ENOENT race).
 *
 * Instead, this script mirrors the three lib packages (package.json,
 * tsconfig.json, full src trees) plus the repo-root package.json into a
 * temporary directory, symlinking node_modules so module resolution matches
 * the real workspace. The orval config derives every output path from its own
 * __dirname (root = <configDir>/../..), so the mirror redirects ALL codegen
 * output into the temp tree. Orval then runs ONCE and its output is compared
 * byte-for-byte against the checked-in generated/ trees — proving a clean
 * checkout regenerates exactly what is committed, with zero writes outside
 * the temp dir.
 *
 * As a self-guard against regressions of this isolation (the clean/read race
 * from code review), the script hashes both live src trees before and after
 * the run and fails if anything in them changed.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SPEC_PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = resolve(SPEC_PKG_ROOT, "..", "..");
const ORVAL_BIN = join(SPEC_PKG_ROOT, "node_modules", ".bin", "orval");

const PACKAGES = [
  { name: "api-spec", src: null },
  { name: "api-client-react", src: join(REPO_ROOT, "lib", "api-client-react", "src") },
  { name: "api-zod", src: join(REPO_ROOT, "lib", "api-zod", "src") },
];
const CODEGEN_PACKAGES = PACKAGES.filter((p) => p.src !== null);

function hashTree(dir) {
  const hashes = new Map(); // rel path -> sha256
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        hashes.set(
          relative(dir, full),
          createHash("sha256").update(readFileSync(full)).digest("hex"),
        );
      }
    }
  };
  walk(dir);
  return hashes;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Non-mutation self-guard: hash live src trees before doing anything.
  const liveBefore = new Map(CODEGEN_PACKAGES.map((p) => [p.name, hashTree(p.src)]));

  const tmp = mkdtempSync(join(tmpdir(), "api-codegen-repro-"));
  const problems = [];
  try {
    // Mirror ALL lib packages' package.json + tsconfig.json — orval's tsconfck
    // walk follows project references (e.g. lib/song-enrichment/tsconfig.json)
    // and crashes if any are missing. Full src trees are copied only for the
    // codegen target packages (the react client src carries the custom-fetch
    // mutator the config points at). node_modules are symlinked so imports
    // resolve exactly as in the repo.
    for (const entry of readdirSync(join(REPO_ROOT, "lib"))) {
      const realDir = join(REPO_ROOT, "lib", entry);
      if (!statSync(realDir).isDirectory()) continue;
      const tmpDir = join(tmp, "lib", entry);
      mkdirSync(tmpDir, { recursive: true });
      for (const f of ["package.json", "tsconfig.json"]) {
        if (existsSync(join(realDir, f))) copyFileSync(join(realDir, f), join(tmpDir, f));
      }
      const nm = join(realDir, "node_modules");
      if (existsSync(nm)) symlinkSync(nm, join(tmpDir, "node_modules"), "dir");
    }
    for (const pkg of CODEGEN_PACKAGES) {
      cpSync(pkg.src, join(tmp, "lib", pkg.name, "src"), { recursive: true });
    }
    // Spec package also needs the orval config (not under src/).
    copyFileSync(join(SPEC_PKG_ROOT, "orval.config.ts"), join(tmp, "lib", "api-spec", "orval.config.ts"));
    copyFileSync(join(SPEC_PKG_ROOT, "openapi.yaml"), join(tmp, "lib", "api-spec", "openapi.yaml"));
    // Repo-root context that tool resolution (prettier etc.) may walk up to.
    for (const f of ["package.json", "tsconfig.json", "tsconfig.base.json"]) {
      if (existsSync(join(REPO_ROOT, f))) copyFileSync(join(REPO_ROOT, f), join(tmp, f));
    }
    symlinkSync(join(REPO_ROOT, "node_modules"), join(tmp, "node_modules"), "dir");

    execFileSync(ORVAL_BIN, ["--config", "./orval.config.ts"], {
      cwd: join(tmp, "lib", "api-spec"),
      stdio: "inherit",
    });

    // Compare freshly generated output against the checked-in trees.
    for (const p of CODEGEN_PACKAGES) {
      const fresh = hashTree(join(tmp, "lib", p.name, "src", "generated"));
      const checkedIn = hashTree(join(p.src, "generated"));
      for (const [rel, hash] of checkedIn) {
        if (!fresh.has(rel)) {
          problems.push(`${p.name}/generated/${rel}: checked in but not produced by a clean codegen run`);
        } else if (fresh.get(rel) !== hash) {
          problems.push(`${p.name}/generated/${rel}: differs from a clean codegen run — run \`pnpm --filter @workspace/api-spec run codegen\` and commit the result`);
        }
      }
      for (const rel of fresh.keys()) {
        if (!checkedIn.has(rel)) {
          problems.push(`${p.name}/generated/${rel}: produced by codegen but not checked in`);
        }
      }
    }
  } catch (err) {
    problems.push(`isolated codegen run crashed: ${err.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // Verify the live workspace was not touched at all.
  for (const p of CODEGEN_PACKAGES) {
    const after = hashTree(p.src);
    const before = liveBefore.get(p.name);
    for (const [rel, hash] of after) {
      if (!before.has(rel)) problems.push(`SAFETY: live file ${p.name}/src/${rel} was created during the check`);
      else if (before.get(rel) !== hash) problems.push(`SAFETY: live file ${p.name}/src/${rel} was modified during the check`);
    }
    for (const rel of before.keys()) {
      if (!after.has(rel)) problems.push(`SAFETY: live file ${p.name}/src/${rel} was deleted during the check`);
    }
  }

  if (problems.length === 0) {
    console.log(
      "api-codegen-repro: OK — checked-in generated clients are byte-identical to an isolated clean codegen run (live workspace untouched)",
    );
  } else {
    console.error(`api-codegen-repro: ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}
