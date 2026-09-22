/**
 * Minimal `.env` file support for the NEUTRON CLI.
 *
 * Deliberately dependency-free (no `dotenv` package): it runs on any
 * platform with plain Node APIs, including Windows CMD, and works offline.
 *
 * Loading order (later files win, but real environment variables always win):
 *   1. `<home>/.env`
 *   2. `<cwd>/.env`  (overrides the home file for the same variable)
 *
 * Real environment variables (present before any .env file is loaded) always
 * win: no .env file can shadow an explicitly exported variable.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Paths of `.env` files successfully applied in this process. */
export const loadedEnvFiles: string[] = [];

let loaded = false;

/** Keys that were present in the real environment before any .env loading. */
let originalKeys: Set<string> | undefined;

/** Keys set by an earlier `.env` file in this process (may be overridden). */
const fileKeys = new Set<string>();

/**
 * Parse dotenv-format text into a key/value map.
 *
 * Supports: `KEY=value`, `KEY="double quoted"`, `KEY='single quoted'`,
 * `export KEY=value`, `# comments`, blank lines, and `\n` escapes inside
 * double quotes. Values are trimmed of surrounding whitespace.
 */
export function parseDotEnv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = src.split(/\r?\n/);
  for (let raw of lines) {
    raw = raw.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (raw.startsWith("export ")) raw = raw.slice(7).trim();
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = raw.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      // Unquoted: strip a trailing inline comment ("value # comment").
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function applyFile(path: string): boolean {
  let text: string;
  try {
    if (!existsSync(path)) return false;
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (!originalKeys) originalKeys = new Set(Object.keys(process.env));
  const parsed = parseDotEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    // Real environment variables always win; values from an earlier .env
    // file (home) may be overridden by a later one (project).
    if (originalKeys.has(key)) continue;
    if (process.env[key] === undefined || fileKeys.has(key)) {
      process.env[key] = value;
      fileKeys.add(key);
    }
  }
  loadedEnvFiles.push(path);
  return true;
}

/**
 * Load `.env` files once per process. Safe to call repeatedly; the second
 * call is a no-op. Returns the list of files that were applied.
 *
 * The `home` parameter exists so tests can simulate a home directory; the
 * CLI always calls this with the real one.
 */
export function loadDotEnvFiles(cwd: string = process.cwd(), home: string = homedir()): string[] {
  if (loaded) return loadedEnvFiles;
  loaded = true;
  try {
    applyFile(join(home, ".env"));
  } catch {
    /* home may be unavailable; ignore */
  }
  try {
    const homeEnv = join(home, ".env");
    const cwdEnv = join(cwd, ".env");
    if (cwdEnv !== homeEnv) applyFile(cwdEnv);
  } catch {
    /* ignore */
  }
  return loadedEnvFiles;
}

/** Reset loader state (tests only). */
export function resetDotEnvLoader(): void {
  loaded = false;
  loadedEnvFiles.length = 0;
  fileKeys.clear();
  originalKeys = undefined;
}
