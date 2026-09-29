/**
 * Agent tools — sandboxed filesystem + command execution for the autonomous
 * AI agent (Node server only). Every tool operates inside a repo root and
 * validates paths server-side; client-supplied paths are never trusted.
 *
 * Approval requirements (enforced by the agent loop, declared here):
 *   read_file, list_files, search_text — safe, no approval
 *   write_file, apply_patch          — approval per file per run (unless the
 *                                      run enabled auto-approve-edits)
 *   delete_file                      — always requires approval
 *   run_command, run_tests           — always require approval
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/** Resolve a client-supplied relative path inside root. Throws on escape. */
export function resolveSafePath(root: string, rel: string): string {
  if (typeof rel !== "string" || !rel.trim()) throw new ToolError("BAD_PATH", "Path is required.");
  if (rel.length > 1024) throw new ToolError("BAD_PATH", "Path too long.");
  const abs = resolve(root, rel);
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new ToolError("PATH_ESCAPE", `Path escapes the workspace: ${rel}`);
  }
  return abs;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage",
  ".coverage", "vendor", ".venv", "venv", "__pycache__", ".idea", ".vscode",
  "target", "out", ".turbo", ".parcel-cache", ".agent",
]);

const MAX_READ_BYTES = 200_000;
const MAX_WRITE_BYTES = 1_000_000;
const MAX_LIST = 500;
const MAX_SEARCH_MATCHES = 100;
const CMD_TIMEOUT_MS = 120_000;
const CMD_OUTPUT_CAP = 100_000;

export interface ReadResult { path: string; content: string; truncated: boolean; bytes: number }

/** read_file — safe, no approval. */
export function readFile(root: string, rel: string): ReadResult {
  const abs = resolveSafePath(root, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new ToolError("NOT_FOUND", `File not found: ${rel}`);
  }
  if (!st.isFile()) throw new ToolError("NOT_A_FILE", `Not a file: ${rel}`);
  if (st.size > MAX_READ_BYTES * 4) throw new ToolError("TOO_LARGE", `File too large to read: ${rel}`);
  const buf = readFileSync(abs);
  const truncated = buf.length > MAX_READ_BYTES;
  return {
    path: rel,
    content: buf.slice(0, MAX_READ_BYTES).toString("utf8"),
    truncated,
    bytes: buf.length,
  };
}

function globToRegExp(glob: string): RegExp {
  // Supports * (within a segment) and ** (across segments). Keep it simple
  // and honest — this is not a full minimatch implementation.
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(re + "$");
}

/** list_files — safe, no approval. */
export function listFiles(root: string, glob = "**/*"): { files: string[]; truncated: boolean } {
  const abs = resolveSafePath(root, ".");
  const re = globToRegExp(glob);
  const out: string[] = [];
  let truncated = false;
  const walk = (dir: string, rel: string) => {
    if (out.length >= MAX_LIST) { truncated = true; return; }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_LIST) { truncated = true; return; }
      if (SKIP_DIRS.has(e.name)) continue;
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.isFile() && re.test(r)) out.push(r);
    }
  };
  walk(abs, "");
  out.sort();
  return { files: out, truncated };
}

export interface SearchMatch { file: string; line: number; text: string }

/** search_text — safe, no approval. Plain substring search (case-insensitive). */
export function searchText(root: string, query: string, dir = "."): { matches: SearchMatch[]; truncated: boolean } {
  if (typeof query !== "string" || !query.trim() || query.length > 200) {
    throw new ToolError("BAD_QUERY", "Search query is required (max 200 chars).");
  }
  const abs = resolveSafePath(root, dir);
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];
  let truncated = false;
  const walk = (d: string, rel: string) => {
    if (matches.length >= MAX_SEARCH_MATCHES) { truncated = true; return; }
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (matches.length >= MAX_SEARCH_MATCHES) { truncated = true; return; }
      if (SKIP_DIRS.has(e.name)) continue;
      const r = rel ? rel + "/" + e.name : e.name;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) {
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.size > MAX_READ_BYTES) continue;
        let text;
        try { text = readFileSync(p, "utf8"); } catch { continue; }
        if (text.includes("\0")) continue; // binary
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] as string;
          if (line.toLowerCase().includes(q)) {
            matches.push({ file: r, line: i + 1, text: line.slice(0, 300) });
            if (matches.length >= MAX_SEARCH_MATCHES) { truncated = true; return; }
          }
        }
      }
    }
  };
  walk(abs, dir === "." ? "" : dir);
  return { matches, truncated };
}

/** write_file — requires approval (per file per run, unless auto-approve). */
export function writeFile(root: string, rel: string, content: string): { path: string; bytes: number } {
  if (typeof content !== "string") throw new ToolError("BAD_CONTENT", "Content must be a string.");
  if (content.length > MAX_WRITE_BYTES) throw new ToolError("TOO_LARGE", "Content exceeds the 1MB write cap.");
  const abs = resolveSafePath(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return { path: rel, bytes: Buffer.byteLength(content, "utf8") };
}

interface Hunk { oldStart: number; oldLines: number; newLines: string[] }

/**
 * Minimal unified-diff applier (fuzz 0). Parses ---/+++/@@ hunks and applies
 * them to the file. Honest errors on mismatch — never silently mis-applies.
 */
export function applyPatch(root: string, rel: string, diff: string): { path: string; hunksApplied: number } {
  const abs = resolveSafePath(root, rel);
  let original: string;
  try {
    original = readFileSync(abs, "utf8");
  } catch {
    throw new ToolError("NOT_FOUND", `File not found: ${rel}`);
  }
  if (typeof diff !== "string" || !diff.includes("@@")) {
    throw new ToolError("BAD_DIFF", "Not a unified diff (no @@ hunks found).");
  }
  const lines = diff.split("\n");
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const ln of lines) {
    const m = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      cur = { oldStart: parseInt(m[1] as string, 10), oldLines: m[2] ? parseInt(m[2] as string, 10) : 1, newLines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (ln.startsWith(" ") || ln.startsWith("+") || ln.startsWith("-")) cur.newLines.push(ln);
    else if (ln === "\\ No newline at end of file") continue;
    else if (ln.trim() === "") cur.newLines.push(" " + ln);
  }
  if (!hunks.length) throw new ToolError("BAD_DIFF", "No parseable hunks.");
  const src = original.split("\n");
  // Apply from the last hunk backwards so earlier line numbers stay valid.
  const ordered = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const h of ordered) {
    const at = h.oldStart - 1;
    const oldSeg: string[] = [];
    const newSeg: string[] = [];
    for (const hl of h.newLines) {
      const sig = hl[0];
      const body = hl.slice(1);
      if (sig === " " || sig === "-") oldSeg.push(body);
      if (sig === " " || sig === "+") newSeg.push(body);
    }
    const actual = src.slice(at, at + oldSeg.length);
    if (actual.length !== oldSeg.length || !actual.every((v, i) => v === oldSeg[i])) {
      throw new ToolError(
        "PATCH_MISMATCH",
        `Hunk at line ${h.oldStart} does not match the file — the file may have changed. No changes were applied.`,
      );
    }
    src.splice(at, oldSeg.length, ...newSeg);
  }
  writeFileSync(abs, src.join("\n"), "utf8");
  return { path: rel, hunksApplied: hunks.length };
}

/** delete_file — always requires approval; files only, never directories. */
export function deleteFile(root: string, rel: string): { path: string } {
  const abs = resolveSafePath(root, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new ToolError("NOT_FOUND", `File not found: ${rel}`);
  }
  if (!st.isFile()) throw new ToolError("NOT_A_FILE", `Refusing to delete a non-file: ${rel}`);
  unlinkSync(abs);
  return { path: rel };
}

/* ------------------------------------------------------------------ */
/* run_command — no shell, argv split, sandboxed                      */
/* ------------------------------------------------------------------ */

const SHELL_META = new Set([";", "|", "&", "$", "`", "<", ">", "(", ")"]);
const BLOCKED_COMMANDS = new Set([
  "mkfs", "dd", "shutdown", "reboot", "halt", "poweroff", "init",
  "useradd", "userdel", "passwd", "visudo", "mount", "umount",
]);

function splitArgv(cmd: string): string[] {  // Small POSIX-ish tokenizer: honors single/double quotes and backslash
  // escapes. Unquoted shell metacharacters are rejected (no shell here).
  const args: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let inArg = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === "\"" && i + 1 < cmd.length) cur += cmd[++i] as string;
      else cur += c;
      inArg = true;
      continue;
    }
    if (c === "'" || c === "\"") { quote = c; inArg = true; continue; }
    if (c === "\\" && i + 1 < cmd.length) { cur += cmd[++i] as string; inArg = true; continue; }
    if (c === " " || c === "\t" || c === "\n") {
      if (inArg) { args.push(cur); cur = ""; inArg = false; }
      continue;
    }
    if (SHELL_META.has(c) || (c === "$" && cmd[i + 1] === "(")) {
      throw new ToolError("SHELL_BLOCKED", `Shell metacharacter "${c}" is not allowed — run simpler commands without pipes, redirects, or substitution.`);
    }
    cur += c;
    inArg = true;
  }
  if (quote) throw new ToolError("BAD_COMMAND", "Unterminated quote in command.");
  if (inArg) args.push(cur);
  if (!args.length) throw new ToolError("BAD_COMMAND", "Empty command.");
  return args;
}

function looksDangerous(argv: string[]): string | null {
  const bin = (argv[0] as string).split("/").pop()!.toLowerCase();
  if (BLOCKED_COMMANDS.has(bin)) return `Command "${bin}" is blocked.`;
  if ((bin === "rm" || bin === "rmdir") && argv.some((a) => a === "-rf" || a === "-fr" || a === "--recursive")) {
    const targets = argv.slice(1).filter((a) => !a.startsWith("-"));
    if (targets.some((t) => t === "/" || t === "/*" || t === "." || t === "./" || t === "*")) {
      return "Refusing recursive delete of a filesystem root or the whole workspace.";
    }
  }
  for (const a of argv.slice(1)) {
    if (a.length > 4096) return "Argument too long.";
    // Absolute paths or .. traversal outside the workspace are rejected —
    // the command runs with cwd inside the repo; keep it there.
    if ((a.startsWith("/") || /^[A-Za-z]:[\\/]/.test(a) || a.includes("..")) && !a.startsWith("-")) {
      // Allow common harmless flags/values; block path-like args.
      if (/^[/\\.]/.test(a) || a.includes("..")) {
        return `Path argument outside the workspace is not allowed: ${a.slice(0, 80)}`;
      }
    }
  }
  return null;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/** run_command — always requires approval. No shell; sandboxed to the repo. */
export function runCommand(
  root: string,
  cmd: string,
  cwd = ".",
  hooks?: { onChild?: (c: ChildProcess) => void },
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let cwdAbs: string;
    let argv: string[];
    try {
      cwdAbs = resolveSafePath(root, cwd);
      argv = splitArgv(cmd);
      const blocked = looksDangerous(argv);
      if (blocked) throw new ToolError("COMMAND_BLOCKED", blocked);
    } catch (e) {
      // Validation failures reject (never throw synchronously past the caller).
      rejectPromise(e);
      return;
    }
    doSpawn(resolvePromise, cmd, argv, cwdAbs, hooks);
  });
}

function doSpawn(
  resolvePromise: (r: CommandResult) => void,
  cmd: string,
  argv: string[],
  cwdAbs: string,
  hooks?: { onChild?: (c: ChildProcess) => void },
): void {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const cap = (s: string) => {
      if (stdout.length + stderr.length + s.length > CMD_OUTPUT_CAP) {
        truncated = true;
        return s.slice(0, Math.max(0, CMD_OUTPUT_CAP - stdout.length - stderr.length));
      }
      return s;
    };
    let child: ChildProcess;
    try {
      child = spawn(argv[0] as string, argv.slice(1), { cwd: cwdAbs, shell: false, windowsHide: true });
      try { hooks?.onChild?.(child); } catch { /* hook is best-effort */ }
    } catch (e) {
      resolvePromise({
        command: cmd, exitCode: null, stdout: "", timedOut: false, truncated: false,
        stderr: `Failed to start: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, CMD_TIMEOUT_MS);
    child.stdout?.on("data", (d: Buffer) => { stdout += cap(d.toString("utf8")); });
    child.stderr?.on("data", (d: Buffer) => { stderr += cap(d.toString("utf8")); });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolvePromise({
        command: cmd, exitCode: null, stdout, stderr: stderr + `\nSpawn error: ${e.message}`,
        timedOut: false, truncated,
      });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolvePromise({ command: cmd, exitCode: code, stdout, stderr, timedOut, truncated });
    });
}

/* ------------------------------------------------------------------ */
/* run_tests — detect the repo's test command, run it (approval first) */
/* ------------------------------------------------------------------ */

export interface TestDetect { command: string[]; kind: string }

export function detectTestCommand(repoRoot: string): TestDetect | null {
  const pkg = join(repoRoot, "package.json");
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> };
      if (parsed.scripts && typeof parsed.scripts.test === "string" && parsed.scripts.test.trim()) {
        const t = parsed.scripts.test.trim();
        // Obvious placeholders do not count as a real test command.
        if (!/echo\s+["']?no test/i.test(t) && t.toLowerCase() !== "exit 0") {
          return { command: ["npm", "test", "--silent"], kind: "npm" };
        }
      }
      if (existsSync(join(repoRoot, "vitest.config.ts")) || existsSync(join(repoRoot, "vitest.config.js"))) {
        return { command: ["npx", "vitest", "run"], kind: "vitest" };
      }
    } catch { /* fall through */ }
  }
  if (existsSync(join(repoRoot, "pytest.ini")) || existsSync(join(repoRoot, "pyproject.toml")) || existsSync(join(repoRoot, "setup.py"))) {
    return { command: ["pytest", "-q"], kind: "pytest" };
  }
  if (existsSync(join(repoRoot, "go.mod"))) return { command: ["go", "test", "./..."], kind: "go" };
  if (existsSync(join(repoRoot, "Cargo.toml"))) return { command: ["cargo", "test", "--quiet"], kind: "cargo" };
  return null;
}

/** run_tests — always requires approval (it executes repo code). */
export async function runTests(repoRoot: string): Promise<CommandResult & { detected: TestDetect | null }> {
  const detected = detectTestCommand(repoRoot);
  if (!detected) {
    return {
      command: "", exitCode: null, stdout: "", timedOut: false, truncated: false,
      stderr: "", detected: null,
    };
  }
  const res = await runCommand(repoRoot, detected.command.map((a) => (/[\s"']/.test(a) ? `"${a}"` : a)).join(" "), ".");
  return { ...res, detected };
}

/** Tool metadata shared with the ReAct prompt and the approval UI. */
export interface ToolDef {
  name: string;
  description: string;
  approval: "none" | "per-file" | "always";
  args: string;
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "read_file", description: "Read a text file (200KB cap).", approval: "none", args: "{ path: string }" },
  { name: "list_files", description: "List files matching a glob (e.g. 'src/**/*.ts').", approval: "none", args: "{ glob?: string }" },
  { name: "search_text", description: "Substring search across files (100 matches cap).", approval: "none", args: "{ query: string, dir?: string }" },
  { name: "write_file", description: "Create or overwrite a file (1MB cap). Needs approval per file.", approval: "per-file", args: "{ path: string, content: string }" },
  { name: "apply_patch", description: "Apply a unified diff to a file. Needs approval per file.", approval: "per-file", args: "{ path: string, diff: string }" },
  { name: "delete_file", description: "Delete a file. Always needs approval.", approval: "always", args: "{ path: string }" },
  { name: "run_command", description: "Run a command (no shell; sandboxed to the repo; 120s timeout). Always needs approval.", approval: "always", args: "{ cmd: string, cwd?: string }" },
  { name: "run_tests", description: "Run the repo's detected test command. Always needs approval.", approval: "always", args: "{}" },
];

/* Test helpers — exported for vitest; not part of the tool surface. */
export { splitArgv, looksDangerous };
