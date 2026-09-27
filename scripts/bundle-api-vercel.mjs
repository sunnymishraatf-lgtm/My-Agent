// Pre-bundles each Vercel api route into a self-contained .js file.
//
// Why: Vercel transpiles api/*.ts in place WITHOUT bundling relative imports
// that escape api/ (../src/*). At runtime Node ESM then fails with
// ERR_MODULE_NOT_FOUND for e.g. '/var/task/src/version'. Bundling here with
// esbuild makes every function standalone (only node: builtins stay external).
//
// The .ts sources are removed AFTER bundling so Vercel deploys the .js
// functions. This only ever runs inside a build (never committed).
import { readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "api");

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.startsWith("_")) out.push(full);
  }
  return out;
}

const entries = collect(apiDir);
if (entries.length === 0) {
  console.error("bundle-api-vercel: no api routes found");
  process.exit(1);
}

for (const entry of entries) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: entry.replace(/\.ts$/, ".js"),
    logLevel: "warning",
  });
}

// Remove TS sources (and underscore helpers, already inlined) so Vercel
// serves the bundled .js functions instead of transpiling the .ts.
for (const entry of entries) rmSync(entry);
for (const entry of readdirSync(apiDir)) {
  const full = join(apiDir, entry);
  if (entry.startsWith("_") && entry.endsWith(".ts") && statSync(full).isFile()) rmSync(full);
}

console.log(`bundle-api-vercel: bundled ${entries.length} api functions`);
