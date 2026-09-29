// Bundles yjs into a browser IIFE for the Rooms collaborative editor.
// Output: src/web/app/vendor/yjs.bundle.js (gitignored), copied to dist/web by
// copy-web.mjs. rooms.js loads it lazily only when the Rooms route renders.
import { buildSync, context } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "src", "web", "app", "vendor", "yjs.bundle.js");
mkdirSync(dirname(outfile), { recursive: true });

const opts = {
  entryPoints: [join(root, "node_modules", "yjs", "dist", "yjs.mjs")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "Y",
  platform: "browser",
  outfile,
  logLevel: "warning",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("bundle-collab: watching yjs");
} else {
  buildSync(opts);
  console.log("bundle-collab: src/web/app/vendor/yjs.bundle.js ready");
}
