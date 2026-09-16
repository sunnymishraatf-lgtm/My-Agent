import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SYSTEM_DIRS = new Set([".git", "node_modules", ".agent", ".next", "dist", "build"]);

export function workspaceFiles(root: string, max = 500): string[] {
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
      if (SYSTEM_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

export function isWithinWorkspace(root: string, p: string): boolean {
  return isSubpath(root, p);
}

export function isSubpath(parent: string, child: string): boolean {
  const from = resolve(parent);
  const to = resolve(child);
  if (from === to) return true;
  const rel = relative(from, to);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../")) return false;
  return true;
}

export function fileSize(p: string): number | undefined {
  try {
    const s = statSync(p);
    if (s.isFile()) return s.size;
  } catch {
    // ignore
  }
  return undefined;
}

export function ensureParent(p: string): void {
  try {
    mkdirSync(join(p, ".."), { recursive: true });
  } catch {
    // ignore
  }
}

export function writeSystemFile(file: string, content: string): boolean {
  try {
    const target = join(file, "..");
    mkdirSync(target, { recursive: true });
    writeFileSync(file, content, "utf8");
    return true;
  } catch {
    return false;
  }
}