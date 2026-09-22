import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  booleanArg,
  fail,
  numberArg,
  ok,
  stringArg,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "./types";
import { globToRegExp, relativeTo, resolveInWorkspace, walkFiles } from "./paths";

const MAX_READ_BYTES = 1_000_000;
const MAX_READ_LINES = 2000;
const MAX_GREP_RESULTS = 200;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readTextFile(full: string): string | undefined {
  try {
    const st = statSync(full);
    if (!st.isFile()) return undefined;
    if (st.size > MAX_READ_BYTES) {
      return readFileSync(full, "utf8").slice(0, MAX_READ_BYTES);
    }
    return readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Read a file in full, regardless of size. The edit tool must operate on the complete
 * contents: truncating to MAX_READ_BYTES and writing back would silently destroy data
 * beyond the first megabyte.
 */
function readFullFile(full: string): string | undefined {
  try {
    const st = statSync(full);
    if (!st.isFile()) return undefined;
    return readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

const readTool: Tool = {
  name: "read",
  description: "Read a UTF-8 text file inside the workspace. Returns numbered lines.",
  parameters: {
    path: { type: "string", description: "File path relative to the workspace root", required: true },
    offset: { type: "number", description: "1-based line to start from (default 1)" },
    limit: { type: "number", description: "Maximum number of lines to return (default 400)" },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const p = stringArg(args, "path");
    if (!p) return fail("Missing required argument: path");
    const { full, ok: within } = resolveInWorkspace(ctx.root, p);
    if (!within) return fail(`Path is outside the workspace: ${p}`);
    try {
      if (statSync(full).isDirectory()) return fail(`${p} is a directory; use the list tool instead.`);
    } catch (e) {
      return fail(`Cannot read ${p}: ${errText(e)}`);
    }
    const text = readTextFile(full);
    if (text === undefined) return fail(`Cannot read ${p}`);
    const lines = text.split("\n");
    const offset = Math.max(1, Math.floor(numberArg(args, "offset") ?? 1));
    const limit = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(numberArg(args, "limit") ?? 400)));
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice.map((line, i) => `${offset + i}: ${line}`).join("\n");
    const remaining = lines.length - (offset - 1) - slice.length;
    const suffix = remaining > 0 ? `\n... (${remaining} more lines)` : "";
    return ok(`${p} (${lines.length} lines)\n${numbered}${suffix}`);
  },
};

const writeTool: Tool = {
  name: "write",
  description: "Create or overwrite a file inside the workspace with the given content.",
  parameters: {
    path: { type: "string", description: "File path relative to the workspace root", required: true },
    content: { type: "string", description: "Full file content", required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const p = stringArg(args, "path");
    const content = stringArg(args, "content");
    if (!p) return fail("Missing required argument: path");
    if (content === undefined) return fail("Missing required argument: content");
    const { full, ok: within } = resolveInWorkspace(ctx.root, p);
    if (!within) return fail(`Path is outside the workspace: ${p}`);
    try {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
      return ok(`Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${p}`);
    } catch (e) {
      return fail(`Cannot write ${p}: ${errText(e)}`);
    }
  },
};

const editTool: Tool = {
  name: "edit",
  description:
    "Replace oldString with newString in an existing file. oldString must match exactly and uniquely unless replaceAll is true.",
  parameters: {
    path: { type: "string", description: "File path relative to the workspace root", required: true },
    oldString: { type: "string", description: "Exact substring to replace", required: true },
    newString: { type: "string", description: "Replacement text", required: true },
    replaceAll: { type: "boolean", description: "Replace every occurrence (default false)" },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const p = stringArg(args, "path");
    const oldString = stringArg(args, "oldString");
    const newString = stringArg(args, "newString");
    if (!p) return fail("Missing required argument: path");
    if (oldString === undefined) return fail("Missing required argument: oldString");
    if (newString === undefined) return fail("Missing required argument: newString");
    if (oldString === "") return fail("oldString must not be empty");
    const { full, ok: within } = resolveInWorkspace(ctx.root, p);
    if (!within) return fail(`Path is outside the workspace: ${p}`);
    const original = readFullFile(full);
    if (original === undefined) return fail(`Cannot read ${p}`);
    const count = original.split(oldString).length - 1;
    if (count === 0) return fail(`oldString not found in ${p}`);
    const replaceAll = booleanArg(args, "replaceAll") === true;
    if (count > 1 && !replaceAll) {
      return fail(`oldString occurs ${count} times in ${p}; add more context or set replaceAll=true`);
    }
    const updated = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString);
    try {
      writeFileSync(full, updated, "utf8");
      return ok(`Edited ${p}: replaced ${replaceAll ? count : 1} occurrence(s)`);
    } catch (e) {
      return fail(`Cannot write ${p}: ${errText(e)}`);
    }
  },
};

const listTool: Tool = {
  name: "list",
  description: "List files and directories inside a workspace directory.",
  parameters: {
    path: { type: "string", description: "Directory path relative to the workspace root (default .)" },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const p = stringArg(args, "path") ?? ".";
    const { full, ok: within } = resolveInWorkspace(ctx.root, p);
    if (!within) return fail(`Path is outside the workspace: ${p}`);
    let entries;
    try {
      entries = readdirSync(full, { withFileTypes: true });
    } catch (e) {
      return fail(`Cannot list ${p}: ${errText(e)}`);
    }
    const names = entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort((a, b) => {
        const ad = a.endsWith("/");
        const bd = b.endsWith("/");
        if (ad !== bd) return ad ? -1 : 1;
        return a.localeCompare(b);
      })
      .slice(0, 500);
    return ok(names.length > 0 ? names.join("\n") : "(empty directory)");
  },
};

const globTool: Tool = {
  name: "glob",
  description: "Find files by glob pattern (supports * ? and **), newest matches first.",
  parameters: {
    pattern: { type: "string", description: "Glob pattern such as **/*.ts", required: true },
    path: { type: "string", description: "Directory to search within (default workspace root)" },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const pattern = stringArg(args, "pattern");
    if (!pattern) return fail("Missing required argument: pattern");
    const base = stringArg(args, "path") ?? ".";
    const { full: baseDir, ok: within } = resolveInWorkspace(ctx.root, base);
    if (!within) return fail(`Path is outside the workspace: ${base}`);
    let re: RegExp;
    try {
      re = globToRegExp(pattern);
    } catch (e) {
      return fail(`Invalid glob pattern: ${errText(e)}`);
    }
    const files = walkFiles(baseDir).filter((f) => re.test(relativeTo(ctx.root, f)));
    files.sort((a, b) => {
      const am = statSync(a).mtimeMs;
      const bm = statSync(b).mtimeMs;
      return bm - am;
    });
    const matches = files.slice(0, 200).map((f) => relativeTo(ctx.root, f));
    return ok(matches.length > 0 ? matches.join("\n") : `No files match ${pattern}`);
  },
};

const grepTool: Tool = {
  name: "grep",
  description: "Search file contents with a JavaScript regular expression. Returns path:line: text.",
  parameters: {
    pattern: { type: "string", description: "Regular expression to search for", required: true },
    include: { type: "string", description: "Glob pattern limiting which files are searched, e.g. **/*.ts" },
    path: { type: "string", description: "Directory to search within (default workspace root)" },
    ignoreCase: { type: "boolean", description: "Case-insensitive search (default false)" },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const pattern = stringArg(args, "pattern");
    if (!pattern) return fail("Missing required argument: pattern");
    let re: RegExp;
    try {
      re = new RegExp(pattern, booleanArg(args, "ignoreCase") === true ? "i" : "");
    } catch (e) {
      return fail(`Invalid regular expression: ${errText(e)}`);
    }
    const include = stringArg(args, "include");
    const includeRe = include ? globToRegExp(include) : undefined;
    const base = stringArg(args, "path") ?? ".";
    const { full: baseDir, ok: within } = resolveInWorkspace(ctx.root, base);
    if (!within) return fail(`Path is outside the workspace: ${base}`);

    const results: string[] = [];
    for (const file of walkFiles(baseDir)) {
      if (results.length >= MAX_GREP_RESULTS) break;
      const rel = relativeTo(ctx.root, file);
      if (includeRe && !includeRe.test(rel)) continue;
      const text = readTextFile(file);
      if (text === undefined || text.includes("\u0000")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && results.length < MAX_GREP_RESULTS; i++) {
        if (re.test(lines[i]!)) results.push(`${rel}:${i + 1}: ${lines[i]}`);
      }
    }
    return ok(results.length > 0 ? results.join("\n") : `No matches for ${pattern}`);
  },
};

const bashTool: Tool = {
  name: "bash",
  description: "Run a shell command in the workspace and return stdout, stderr and the exit code.",
  parameters: {
    command: { type: "string", description: "Command to execute", required: true },
    timeoutMs: { type: "number", description: "Timeout in milliseconds (default 120000)" },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const command = stringArg(args, "command");
    if (!command) return fail("Missing required argument: command");
    const timeoutMs = numberArg(args, "timeoutMs");
    const res = await ctx.run(command, timeoutMs !== undefined ? { timeoutMs } : undefined);
    const parts = [`exit code: ${res.exitCode}`, res.stdout.trimEnd()];
    if (res.stderr.trim()) parts.push(`[stderr]\n${res.stderr.trimEnd()}`);
    if (res.timedOut) parts.push("[command timed out]");
    return { ok: res.status === "ok", output: parts.filter(Boolean).join("\n") };
  },
};

export function createDefaultTools(): Tool[] {
  return [readTool, writeTool, editTool, listTool, globTool, grepTool, bashTool];
}

export { readTool, writeTool, editTool, listTool, globTool, grepTool, bashTool };
export type { Tool, ToolContext, ToolResult };
