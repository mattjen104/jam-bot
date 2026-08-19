/**
 * Regression fixtures for the contract checker (node --test).
 *
 * Each test drives runChecks() with miniature versions of the three surfaces
 * (server routes / spec operations / generated exports) and pins which
 * failure class fires. The fixtures model the real drift modes this repo has
 * hit — most importantly [generated-not-in-spec], the hand-patched-generated-
 * client mode where a clean codegen silently deletes a shipped endpoint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks, normalizePath, extractServerRoutes } from "./check-contract.mjs";

const base = {
  serverRoutes: [],
  specOps: [],
  exceptions: [],
  generatedClientOps: new Set(),
  generatedZodExports: new Set(),
  patchExports: new Set(),
};

const classes = (diags) => diags.map((d) => d.cls);

test("aligned surfaces produce no diagnostics", () => {
  const diags = runChecks({
    ...base,
    serverRoutes: [{ method: "GET", path: "/widgets/{id}", file: "routes/widgets.ts" }],
    specOps: [
      {
        method: "GET",
        path: "/widgets/{id}",
        operationId: "getWidget",
        hasBodySchema: true,
      },
    ],
    generatedClientOps: new Set(["getWidget"]),
    generatedZodExports: new Set(["GetWidgetParams", "GetWidgetResponse"]),
  });
  assert.deepEqual(diags, []);
});

test("Express :param syntax normalizes to OpenAPI {param} form", () => {
  assert.equal(normalizePath("/stations/:slug/now-playing"), "/stations/{slug}/now-playing");
  // Template-literal segments (route loops) collapse to a wildcard.
  assert.equal(normalizePath("/share/${kind}/:id"), "/share/*/{id}");
});

test("shipped route missing from spec and exceptions is [missing-contract]", () => {
  const diags = runChecks({
    ...base,
    serverRoutes: [{ method: "POST", path: "/widgets", file: "routes/widgets.ts" }],
  });
  assert.deepEqual(classes(diags), ["missing-contract"]);
  assert.match(diags[0].message, /POST \/widgets/);
});

test("documented plain-JSON exception passes; stale exception fails", () => {
  const exception = {
    method: "GET",
    path: "/widgets/feed",
    kind: "plain-json",
    reason: "hand-written fetch read model",
  };
  const ok = runChecks({
    ...base,
    serverRoutes: [{ method: "GET", path: "/widgets/feed", file: "routes/widgets.ts" }],
    exceptions: [exception],
  });
  assert.deepEqual(ok, []);

  const stale = runChecks({ ...base, exceptions: [exception] });
  assert.deepEqual(classes(stale), ["stale-exception"]);
});

test("spec operation with no server route is [spec-without-server]", () => {
  const diags = runChecks({
    ...base,
    specOps: [
      { method: "GET", path: "/widgets", operationId: "listWidgets", hasBodySchema: true },
    ],
    generatedClientOps: new Set(["listWidgets"]),
    generatedZodExports: new Set(["ListWidgetsResponse"]),
  });
  assert.deepEqual(classes(diags), ["spec-without-server"]);
});

/**
 * Representative endpoint that previously could disappear during regeneration:
 * a fetcher hand-patched straight into generated/api.ts (as logTracklist and
 * patchClaim once were). Everything else lines up, but the export is not in
 * the spec — a clean orval run would delete it, crashing strict-ESM importers
 * at boot. The checker must flag it BEFORE that regen happens.
 */
test("hand-patched generated fetcher is [generated-not-in-spec]", () => {
  const diags = runChecks({
    ...base,
    serverRoutes: [{ method: "POST", path: "/admin/picks", file: "routes/admin.ts" }],
    specOps: [
      { method: "POST", path: "/admin/picks", operationId: "logPicks", hasBodySchema: true },
    ],
    generatedClientOps: new Set(["logPicks", "logTracklist"]),
    generatedZodExports: new Set(["LogPicksBody", "LogPicksResponse"]),
  });
  assert.deepEqual(classes(diags), ["generated-not-in-spec"]);
  assert.match(diags[0].message, /logTracklist/);
});

test("spec operationId absent from generated clients is [missing-generated]", () => {
  const diags = runChecks({
    ...base,
    serverRoutes: [{ method: "GET", path: "/widgets", file: "routes/widgets.ts" }],
    specOps: [
      { method: "GET", path: "/widgets", operationId: "listWidgets", hasBodySchema: true },
    ],
  });
  assert.deepEqual(classes(diags), ["missing-generated", "missing-generated"]);
  assert.match(diags[0].message, /api-client-react/);
  assert.match(diags[1].message, /api-zod/);
});

test("204-no-content operations need no zod export", () => {
  const diags = runChecks({
    ...base,
    serverRoutes: [{ method: "POST", path: "/widgets/{id}/seen", file: "routes/widgets.ts" }],
    specOps: [
      {
        method: "POST",
        path: "/widgets/{id}/seen",
        operationId: "markWidgetSeen",
        hasBodySchema: false,
      },
    ],
    generatedClientOps: new Set(["markWidgetSeen"]),
  });
  assert.deepEqual(diags, []);
});

test("patch seam re-declaring a generated schema is [patch-collision]", () => {
  const diags = runChecks({
    ...base,
    generatedZodExports: new Set(["ReplayResolutionJobResponse"]),
    patchExports: new Set(["ReplayResolutionJobResponse"]),
  });
  assert.deepEqual(classes(diags), ["patch-collision"]);
});

test("same method+path registered twice is [duplicate-route]", () => {
  const diags = runChecks({
    ...base,
    serverRoutes: [
      { method: "GET", path: "/widgets", file: "routes/a.ts" },
      { method: "GET", path: "/widgets", file: "routes/b.ts" },
    ],
    exceptions: [
      { method: "GET", path: "/widgets", kind: "plain-json", reason: "test" },
    ],
  });
  assert.deepEqual(classes(diags), ["duplicate-route"]);
});

/**
 * Coverage-hole regression (caught in code review): the scanner used to read
 * only src/routes/, so routes registered by out-of-tree helper modules —
 * mountX(router) called from a route file, the real
 * lore/apple-library-batch-endpoint.ts pattern — escaped the contract gate
 * entirely. The scanner now reads the whole server src/ tree.
 */
test("routes registered by an out-of-tree helper module are detected", () => {
  const src = mkdtempSync(join(tmpdir(), "contract-scan-"));
  try {
    mkdirSync(join(src, "routes", "me"), { recursive: true });
    mkdirSync(join(src, "helpers"), { recursive: true });
    writeFileSync(
      join(src, "routes", "me", "library.ts"),
      'import { mountAppleLibraryImport } from "../../helpers/apple.js";\n' +
        "mountAppleLibraryImport(router);\n" +
        'router.get("/me/library", handler);\n',
    );
    writeFileSync(
      join(src, "helpers", "apple.ts"),
      'export function mountAppleLibraryImport(router) {\n' +
        '  router.post("/me/apple-library-import", h(async (req, res) => {}));\n' +
        '  router.get("/me/apple-library-import/status", h(async (req, res) => {}));\n' +
        "}\n",
    );
    const routes = extractServerRoutes(src);
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(keys, [
      "GET /me/apple-library-import/status",
      "GET /me/library",
      "POST /me/apple-library-import",
    ]);
    // ...and an undocumented helper route surfaces as [missing-contract].
    const diags = runChecks({ ...base, serverRoutes: routes });
    assert.deepEqual(classes(diags), [
      "missing-contract",
      "missing-contract",
      "missing-contract",
    ]);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});
