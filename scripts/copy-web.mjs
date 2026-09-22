// Copies the dashboard assets next to the built server so `neutron web` works
// from an installed package (src/ is not published; dist/ is).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "web");
const to = join(root, "dist", "web");
if (!existsSync(from)) {
  console.error("copy-web: src/web not found");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("copy-web: dist/web ready");
