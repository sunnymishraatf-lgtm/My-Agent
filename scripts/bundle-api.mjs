// Bundles each Vercel api route source (api-src/**/*.ts) into a self-contained
// function file (api/**/*.js).
//
// Why: Vercel transpiles api/*.ts in place WITHOUT bundling relative imports
// that escape api/ (../src/*). At runtime Node ESM then fails with
// ERR_MODULE_NOT_FOUND for e.g. '/var/task/src/version'. Bundling here with
// esbuild makes every function standalone (only node: builtins stay external).
//
// The bundled api/*.js files are COMMITTED: Vercel snapshots the api/
// file list before the build, so generating them only at build time breaks
// its function collection. Run `npm run bundle:api` after editing api-src/
// and commit the result. build:vercel re-runs it as a safety net.
import { readdirSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "api-src");
const outDir = join(root, "api");

function collectTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTs(full));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.startsWith("_")) out.push(full);
  }
  return out;
}

const entries = collectTs(srcDir);
if (entries.length === 0) {
  console.error("bundle-api: no api-src routes found");
  process.exit(1);
}

for (const entry of entries) {
  const rel = relative(srcDir, entry).replace(/\.ts$/, ".js");
  const outfile = join(outDir, rel);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    logLevel: "warning",
  });
}

console.log(`bundle-api: bundled ${entries.length} api functions`);
