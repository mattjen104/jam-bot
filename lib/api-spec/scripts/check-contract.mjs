#!/usr/bin/env node
/**
 * API contract drift checker.
 *
 * Compares three surfaces and fails if they disagree:
 *
 *   1. SHIPPED ROUTES  — every `router.METHOD("path", ...)` registration under
 *      artifacts/api-server/src — routes/ files plus out-of-tree helper
 *      modules they mount (e.g. lore/apple-library-batch-endpoint.ts, which
 *      registers routes on a router passed in from routes/me/library.ts).
 *   2. THE CONTRACT    — paths + methods declared in lib/api-spec/openapi.yaml.
 *   3. GENERATED CODE  — operation exports in the orval-generated clients
 *      (lib/api-client-react + lib/api-zod).
 *
 * A route that is intentionally NOT in the OpenAPI contract (plain-JSON read
 * models, OAuth redirects, SSE streams, media/binary endpoints, admin-only
 * ops) must be listed in lib/api-spec/contract-exceptions.json with a reason.
 *
 * Failure classes (each diagnostic is prefixed with one):
 *   [missing-contract]     server route absent from openapi.yaml and exceptions
 *   [spec-without-server]  openapi.yaml operation with no matching server route
 *   [stale-exception]      exception entry that no longer matches a server route
 *   [missing-generated]    spec operationId missing from the generated clients
 *                          (run `pnpm --filter @workspace/api-spec run codegen`)
 *   [generated-not-in-spec] generated client exports an operation that is not in
 *                          openapi.yaml — the historical hand-patch drift mode:
 *                          a clean codegen would silently delete it
 *   [patch-collision]      lib/api-zod/src/patches.ts re-declares a schema the
 *                          generated zod client already exports (dual maintenance)
 *   [duplicate-route]      same method+path registered twice on the server
 *
 * Exit code is 0 when there are no diagnostics, 1 otherwise.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const SPEC_PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = resolve(SPEC_PKG_ROOT, "..", "..");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "all"];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Recursively list .ts files under dir. */
function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Convert an Express path template to OpenAPI form: /a/:id/b -> /a/{id}/b.
 * Template-literal interpolations (`/share/${x}/:id`, used by route loops)
 * collapse to a `*` single-segment wildcard that exceptions may also use.
 */
export function normalizePath(expressPath) {
  return expressPath
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

/**
 * Extract `router.<method>("<path>"` registrations from server source files.
 * Scans the whole server src/ tree, not just src/routes/: route files mount
 * helper modules living elsewhere in src/ (mountX(router) pattern), and those
 * registrations are part of the shipped surface too.
 * Handles multi-line declarations (path on the line after the open paren).
 * Returns [{ method, path, file }].
 */
export function extractServerRoutes(serverSrcDir) {
  const routeRe =
    /router\.(get|post|put|patch|delete|all)\(\s*(["'`])([^"'`]+)\2/gs;
  const routes = [];
  for (const file of listTsFiles(serverSrcDir)) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(routeRe)) {
      const [, method, , rawPath] = match;
      routes.push({
        method: method.toUpperCase(),
        path: normalizePath(rawPath),
        file: relative(REPO_ROOT, file),
      });
    }
  }
  return routes;
}

/**
 * Parse openapi.yaml into [{ method, path, operationId }].
 */
export function extractSpecOperations(specPath) {
  const doc = parseYaml(readFileSync(specPath, "utf8"));
  const ops = [];
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = pathItem?.[method];
      if (op && typeof op === "object") {
        // Orval emits no zod schema for operations whose 2xx responses carry
        // no body (e.g. 204 No Content) — nothing to validate.
        const hasBodySchema = Object.entries(op.responses ?? {}).some(
          ([status, res]) =>
            /^2/.test(status) &&
            res &&
            typeof res === "object" &&
            Object.keys(res.content ?? {}).length > 0,
        );
        ops.push({
          method: method.toUpperCase(),
          path,
          operationId: op.operationId ?? null,
          hasBodySchema,
        });
      }
    }
  }
  return ops;
}

/**
 * Extract generated fetcher exports from the react-query client.
 * Orval emits `export const <operationId> = async (` for every operation —
 * these names are exactly the spec operationIds.
 */
export function extractGeneratedClientOperations(generatedClientPath) {
  const src = readFileSync(generatedClientPath, "utf8");
  const names = new Set();
  for (const match of src.matchAll(/export const (\w+) = async \(/g)) {
    names.add(match[1]);
  }
  return names;
}

/** All `export const <Name>` identifiers in a generated zod file. */
export function extractZodExports(generatedZodPath) {
  const src = readFileSync(generatedZodPath, "utf8");
  const names = new Set();
  for (const match of src.matchAll(/export (?:const|function) (\w+)/g)) {
    names.add(match[1]);
  }
  return names;
}

/** `export const <Name>` identifiers declared in the hand-maintained patch seam. */
export function extractPatchExports(patchesPath) {
  const src = readFileSync(patchesPath, "utf8");
  const names = new Set();
  for (const match of src.matchAll(/^export const (\w+)/gm)) {
    names.add(match[1]);
  }
  return names;
}

function pascalCase(camel) {
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const routeKey = (method, path) => `${method} ${path}`;

/**
 * Run all contract checks. All parameters are plain data so tests can drive
 * this with fixtures.
 *
 * @param {object} input
 * @param {{method:string,path:string,file?:string}[]} input.serverRoutes
 * @param {{method:string,path:string,operationId:string|null}[]} input.specOps
 * @param {{method:string,path:string,kind:string,reason:string}[]} input.exceptions
 * @param {Set<string>} input.generatedClientOps  fetcher names from generated/api.ts
 * @param {Set<string>} input.generatedZodExports export names from zod generated/api.ts
 * @param {Set<string>} input.patchExports         export const names from patches.ts
 * @returns {{cls:string,message:string}[]} diagnostics (empty = pass)
 */
export function runChecks(input) {
  const { serverRoutes, specOps, exceptions, generatedClientOps, generatedZodExports, patchExports } =
    input;
  const diagnostics = [];
  const push = (cls, message) => diagnostics.push({ cls, message });

  const specKeys = new Map(specOps.map((op) => [routeKey(op.method, op.path), op]));
  const exceptionKeys = new Map(
    exceptions.map((e) => [routeKey(e.method.toUpperCase(), normalizePath(e.path)), e]),
  );
  const serverKeys = new Map();

  // [duplicate-route]
  for (const route of serverRoutes) {
    const key = routeKey(route.method, route.path);
    if (serverKeys.has(key)) {
      push(
        "duplicate-route",
        `${key} registered in both ${serverKeys.get(key).file} and ${route.file}`,
      );
    } else {
      serverKeys.set(key, route);
    }
  }

  // [missing-contract]
  for (const [key, route] of serverKeys) {
    if (!specKeys.has(key) && !exceptionKeys.has(key)) {
      push(
        "missing-contract",
        `${key} (${route.file}) is shipped but absent from openapi.yaml; ` +
          `add it to the spec or document it in contract-exceptions.json`,
      );
    }
  }

  // [spec-without-server]
  for (const [key, op] of specKeys) {
    if (!serverKeys.has(key)) {
      push(
        "spec-without-server",
        `${key} (operationId: ${op.operationId ?? "?"}) is declared in openapi.yaml ` +
          `but no server route implements it`,
      );
    }
  }

  // [stale-exception]
  for (const [key, e] of exceptionKeys) {
    if (!serverKeys.has(key)) {
      push(
        "stale-exception",
        `${key} is listed in contract-exceptions.json (${e.kind}: ${e.reason}) ` +
          `but no longer matches a server route — remove the entry`,
      );
    }
  }

  // [missing-generated]
  for (const op of specOps) {
    if (!op.operationId) continue;
    if (!generatedClientOps.has(op.operationId)) {
      push(
        "missing-generated",
        `operationId ${op.operationId} (${op.method} ${op.path}) has no fetcher export in ` +
          `lib/api-client-react/src/generated/api.ts — run codegen`,
      );
    }
    if (!op.hasBodySchema) continue;
    const pascal = pascalCase(op.operationId);
    const hasZod = [...generatedZodExports].some((name) => name.startsWith(pascal));
    if (!hasZod) {
      push(
        "missing-generated",
        `operationId ${op.operationId} (${op.method} ${op.path}) has no ${pascal}* export in ` +
          `lib/api-zod/src/generated/api.ts — run codegen`,
      );
    }
  }

  // [generated-not-in-spec]
  const specOperationIds = new Set(specOps.map((op) => op.operationId).filter(Boolean));
  for (const name of generatedClientOps) {
    if (!specOperationIds.has(name)) {
      push(
        "generated-not-in-spec",
        `generated fetcher ${name} has no operationId in openapi.yaml — it was hand-patched ` +
          `into generated code and a clean codegen will delete it; declare it in the spec instead`,
      );
    }
  }

  // [patch-collision]
  for (const name of patchExports) {
    if (generatedZodExports.has(name)) {
      push(
        "patch-collision",
        `${name} is exported by both lib/api-zod/src/patches.ts and the generated zod client; ` +
          `delete it from patches.ts (see the header comment there)`,
      );
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadExceptions(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data.exceptions)) {
    throw new Error(`${path}: expected an "exceptions" array`);
  }
  for (const e of data.exceptions) {
    if (!e.method || !e.path || !e.kind || !e.reason) {
      throw new Error(
        `${path}: every exception needs method, path, kind, and reason — got ${JSON.stringify(e)}`,
      );
    }
  }
  return data.exceptions;
}

export function checkRepo(repoRoot) {
  const specPkg = join(repoRoot, "lib", "api-spec");
  return runChecks({
    serverRoutes: extractServerRoutes(join(repoRoot, "artifacts", "api-server", "src")),
    specOps: extractSpecOperations(join(specPkg, "openapi.yaml")),
    exceptions: loadExceptions(join(specPkg, "contract-exceptions.json")),
    generatedClientOps: extractGeneratedClientOperations(
      join(repoRoot, "lib", "api-client-react", "src", "generated", "api.ts"),
    ),
    generatedZodExports: extractZodExports(
      join(repoRoot, "lib", "api-zod", "src", "generated", "api.ts"),
    ),
    patchExports: extractPatchExports(join(repoRoot, "lib", "api-zod", "src", "patches.ts")),
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const diagnostics = checkRepo(REPO_ROOT);
  if (diagnostics.length === 0) {
    console.log("api-contract: OK — server routes, openapi.yaml, and generated clients agree");
  } else {
    console.error(`api-contract: ${diagnostics.length} contract problem(s):\n`);
    for (const d of diagnostics) {
      console.error(`  [${d.cls}] ${d.message}`);
    }
    console.error(
      "\nSee lib/api-spec/README.md for how to resolve each failure class.",
    );
    process.exit(1);
  }
}
