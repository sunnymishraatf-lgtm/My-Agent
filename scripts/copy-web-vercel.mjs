// Copies the web demo UI into public/ so Vercel serves it as static files.
// URL paths are preserved (/src/web/demo/*) because the UI already references
// those absolute paths — no frontend changes needed for asset loading.
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "web", "demo");
const to = join(root, "public", "src", "web", "demo");
if (!existsSync(from)) {
  console.error("copy-web-vercel: src/web/demo not found");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("copy-web-vercel: public/src/web/demo ready");
