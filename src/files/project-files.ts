import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isWithinWorkspace, ensureParent } from "./workspace";

export function writeSystemFile(file: string, content: string): boolean {
  const full = resolve(file);
  try {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readProjectFile(root: string, p: string): string | undefined {
  const full = resolve(root, p);
  if (!isWithinWorkspace(root, full)) return undefined;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

export function writeProjectFile(root: string, p: string, content: string): boolean {
  const full = resolve(root, p);
  if (!isWithinWorkspace(root, full)) return false;
  try {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function appendProjectFile(root: string, p: string, content: string): boolean {
  const existing = readProjectFile(root, p);
  return writeProjectFile(root, p, (existing ?? "") + content);
}

export { join, isWithinWorkspace, ensureParent };