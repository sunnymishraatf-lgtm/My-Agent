import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["../package.json", "../../package.json", "package.json"]) {
      try {
        const raw = readFileSync(join(here, rel), "utf8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        /* try the next candidate */
      }
    }
  } catch {
    /* fall through to the literal default */
  }
  return "0.1.0";
}
