import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Production bundler for the Slack bot.
 *
 * jam-bot consumes the source-only workspace lib `@workspace/song-enrichment`
 * (its package `exports` point at `./src/*.ts`, never built to JS). Plain `tsc`
 * would leave a bare `import "@workspace/song-enrichment"` in dist/, which node
 * cannot resolve at runtime because it points at TypeScript source. We bundle
 * with esbuild so the workspace lib is inlined, while real npm dependencies
 * (including the native better-sqlite3) stay external and load from node_modules
 * at runtime. Mirrors artifacts/api-server/build.ts.
 */
async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("building jam-bot...");
  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

  // Externalize every real npm dependency; only workspace:* packages get
  // bundled (they ship as TS source and have no runtime JS otherwise).
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) => !pkg.dependencies?.[dep]?.startsWith("workspace:"),
  );

  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "cjs",
    outfile: path.resolve(distDir, "index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
