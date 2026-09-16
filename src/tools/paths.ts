import { readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isWithinWorkspace } from "../files/workspace";

export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".agent",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
]);

export function resolveInWorkspace(root: string, p: string): { full: string; ok: boolean } {
  const full = isAbsolute(p) ? resolve(p) : resolve(root, p);
  return { full, ok: isWithinWorkspace(root, full) };
}

export function relativeTo(root: string, full: string): string {
  const rel = relative(root, full);
  return rel.split(sep).join("/");
}

export function walkFiles(root: string, max = 5000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(resolve(dir, e.name));
      } else if (e.isFile()) {
        out.push(resolve(dir, e.name));
      }
    }
  }
  return out;
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split("\\").join("/");
  let re = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i]!;
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`, "i");
}
