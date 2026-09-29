// Copies the web demo UI into public/ so Vercel serves it as static files.
// URL paths are preserved (/src/web/demo/*) because the UI already references
// those absolute paths — no frontend changes needed for asset loading.
//
// The full /app SPA is copied twice, mirroring the /demo setup:
//   src/web/app -> public/src/web/app   (matches the /src/web/* rewrite)
//   src/web/app -> public/app           (so /app/index.html resolves directly)
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function copyDir(from, to, label) {
  if (!existsSync(from)) {
    console.error(`copy-web-vercel: ${from} not found`);
    process.exit(1);
  }
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`copy-web-vercel: ${label} ready`);
}

copyDir(join(root, "src", "web", "demo"), join(root, "public", "src", "web", "demo"), "public/src/web/demo");
copyDir(join(root, "src", "web", "app"), join(root, "public", "src", "web", "app"), "public/src/web/app");
copyDir(join(root, "src", "web", "app"), join(root, "public", "app"), "public/app");
copyDir(join(root, "src", "web", "download"), join(root, "public", "download"), "public/download");
