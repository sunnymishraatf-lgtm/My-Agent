/**
 * Git service — real git operations for workspace repositories (Node server
 * only). Every operation runs `git` via spawn with no shell, the repo root
 * as cwd (validated against the workspace), a 60s timeout, and
 * GIT_TERMINAL_PROMPT=0 so git never blocks waiting for credentials —
 * auth failures surface as honest errors instead of hangs.
 *
 * Never accepts or stores git passwords: pull/push rely on the server
 * environment's existing git auth (SSH agent, credential helper, or the
 * transient token passed to cloneWithToken, which is never persisted).
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveSafePath, ToolError } from "../agent/tools";

export class GitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GitError";
    this.code = code;
  }
}

const GIT_TIMEOUT_MS = 60_000;
const GIT_OUTPUT_CAP = 200_000;

/** Test hook: replace the git binary (e.g. with a script that sleeps, to test timeouts). */
let gitBin = "git";
export function setGitBinForTests(bin: string): void {
  gitBin = bin;
}
export function resetGitBinForTests(): void {
  gitBin = "git";
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function runGit(root: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitRunResult> {
  // Test hook: shrink the timeout via env so timeout tests don't take a minute.
  const envTimeout = parseInt(process.env.NEUTRON_GIT_TIMEOUT_MS ?? "", 10);
  const effectiveTimeout = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : timeoutMs;
  return new Promise((resolve) => {
    let cwdAbs: string;
    try {
      cwdAbs = resolveSafePath(root, ".");
    } catch (e) {
      resolve({
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: null,
        timedOut: false,
      });
      return;
    }
    // No shell, argv only — arguments are never interpreted.
    const child = spawn(gitBin, args, {
      cwd: cwdAbs,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0", // never prompt for credentials — fail fast instead
        GIT_CONFIG_COUNT: undefined,
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (cur: string, add: string) =>
      cur.length + add.length > GIT_OUTPUT_CAP
        ? cur + add.slice(0, Math.max(0, GIT_OUTPUT_CAP - cur.length))
        : cur + add;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, effectiveTimeout);
    child.stdout?.on("data", (d: Buffer) => { stdout = cap(stdout, d.toString("utf8")); });
    child.stderr?.on("data", (d: Buffer) => { stderr = cap(stderr, d.toString("utf8")); });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\nSpawn error: ${e.message}`, exitCode: null, timedOut: false });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

function gitFailed(res: GitRunResult, what: string): GitError {
  if (res.timedOut) return new GitError("TIMEOUT", `${what} timed out after ${GIT_TIMEOUT_MS / 1000}s.`);
  const detail = ((res.stderr || res.stdout || `git exited with code ${res.exitCode}`).trim().split("\n")[0] ?? "").slice(0, 300);
  return new GitError("GIT_FAILED", `${what} failed: ${detail}`);
}

async function mustSucceed(root: string, args: string[], what: string): Promise<string> {
  const res = await runGit(root, args);
  if (res.timedOut) throw gitFailed(res, what);
  if (res.exitCode !== 0) throw gitFailed(res, what);
  return res.stdout;
}

/** Throw unless root is a git repository. */
export function assertGitRepo(root: string): void {
  let abs: string;
  try {
    abs = resolveSafePath(root, ".");
  } catch (e) {
    throw new GitError("BAD_PATH", e instanceof Error ? e.message : String(e));
  }
  let st;
  try {
    st = statSync(join(abs, ".git"));
  } catch {
    throw new GitError("NOT_A_REPO", "Not a git repository.");
  }
  if (!st.isDirectory() && !st.isFile()) throw new GitError("NOT_A_REPO", "Not a git repository.");
}

const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

function validateBranchName(name: string): void {
  if (typeof name !== "string" || !name.trim()) throw new GitError("BAD_BRANCH", "Branch name is required.");
  const n = name.trim();
  if (n.length > 120 || !BRANCH_RE.test(n) || n.includes("..") || n.startsWith("/") || n.endsWith("/")) {
    throw new GitError("BAD_BRANCH", `Invalid branch name: ${n.slice(0, 60)}`);
  }
}

export interface GitFileStatus {
  path: string;
  staged: string; // porcelain XY first column (M/A/D/R/C or space)
  unstaged: string; // porcelain XY second column
}

export interface GitStatus {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
  clean: boolean;
}

/** git status --porcelain=v1 -b, plus ahead/behind counts (best-effort). */
export async function gitStatus(root: string): Promise<GitStatus> {
  assertGitRepo(root);
  const out = await mustSucceed(root, ["status", "--porcelain=v1", "-b", "--untracked-files=normal"], "git status");
  let branch = "";
  const files: GitFileStatus[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      const unborn = /^No commits yet on (\S+)/.exec(head);
      if (unborn) branch = unborn[1] as string;
      else {
        const m = /^([^\s.]+)/.exec(head);
        branch = m ? (m[1] as string) : head;
      }
      // ahead/behind are parsed below via rev-list for reliability
      continue;
    }
    if (line.length < 4) continue;
    files.push({
      path: line.slice(3),
      staged: line[0] === " " ? "" : (line[0] as string),
      unstaged: line[1] === " " ? "" : (line[1] as string),
    });
  }
  if (!branch) {
    try {
      branch = (await mustSucceed(root, ["rev-parse", "--abbrev-ref", "HEAD"], "git rev-parse")).trim();
    } catch { branch = "HEAD"; }
  }
  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await mustSucceed(
      root,
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      "ahead/behind",
    )).trim().split(/\s+/);
    ahead = parseInt(counts[0] ?? "0", 10) || 0;
    behind = parseInt(counts[1] ?? "0", 10) || 0;
  } catch { /* no upstream — leave at 0 */ }
  return { branch, files, ahead, behind, clean: files.length === 0 };
}

export interface GitBranches { current: string; branches: string[]; }

/** List local branches; current first. */
export async function gitBranches(root: string): Promise<GitBranches> {
  assertGitRepo(root);
  const out = await mustSucceed(root, ["branch", "--list", "--format=%(refname:short)%00%(HEAD)"], "git branch");
  const branches: string[] = [];
  let current = "";
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, head] = line.split("\0");
    if (name) {
      branches.push(name);
      if (head === "*") current = name;
    }
  }
  branches.sort();
  return { current, branches };
}

/** Create a branch (does not switch). */
export async function createBranch(root: string, name: string): Promise<{ branch: string }> {
  assertGitRepo(root);
  validateBranchName(name);
  await mustSucceed(root, ["branch", name.trim()], `create branch ${name.trim()}`);
  return { branch: name.trim() };
}

/** Switch branches. Honest error if uncommitted changes would be overwritten. */
export async function switchBranch(root: string, name: string): Promise<{ branch: string }> {
  assertGitRepo(root);
  validateBranchName(name);
  await mustSucceed(root, ["checkout", name.trim()], `switch to branch ${name.trim()}`);
  return { branch: name.trim() };
}

/**
 * Stage files for commit. No paths = stage everything (`git add -A`).
 * Paths are validated against the repo root.
 */
export async function gitStage(root: string, paths?: string[]): Promise<{ staged: number }> {
  assertGitRepo(root);
  if (paths === undefined) {
    await mustSucceed(root, ["add", "-A"], "git add");
    return { staged: -1 }; // -1 = "all", caller refreshes status for the count
  }
  if (!Array.isArray(paths) || !paths.length) throw new GitError("BAD_PATH", "No paths to stage.");
  if (paths.length > 500) throw new GitError("BAD_PATH", "Too many paths (max 500).");
  for (const p of paths) {
    if (typeof p !== "string" || !p.trim()) throw new GitError("BAD_PATH", "Invalid path.");
    try {
      resolveSafePath(root, p); // throws on escape
    } catch (e) {
      throw new GitError("BAD_PATH", e instanceof Error ? e.message : String(e));
    }
  }
  await mustSucceed(root, ["add", "--", ...paths], "git add");
  return { staged: paths.length };
}

/** Commit staged changes. Message validated; git identity comes from the environment. */export async function gitCommit(root: string, message: string): Promise<{ sha: string }> {
  assertGitRepo(root);
  if (typeof message !== "string" || !message.trim()) {
    throw new GitError("BAD_MESSAGE", "Commit message is required.");
  }
  const msg = message.trim();
  if (msg.length > 2000) throw new GitError("BAD_MESSAGE", "Commit message is too long (max 2000 chars).");
  await mustSucceed(root, ["commit", "-m", msg], "git commit");
  const sha = (await mustSucceed(root, ["rev-parse", "HEAD"], "git rev-parse")).trim();
  return { sha };
}

export interface GitLogEntry {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
}

/** Recent commits, newest first, capped at 100. */
export async function gitLog(root: string, n = 30): Promise<GitLogEntry[]> {
  assertGitRepo(root);
  const count = Math.max(1, Math.min(100, Math.floor(n) || 30));
  const out = await mustSucceed(
    root,
    ["log", `--max-count=${count}`, "--format=%H%x00%h%x00%an%x00%ad%x00%s%x00%b%x1e", "--date=iso"],
    "git log",
  );
  const entries: GitLogEntry[] = [];
  for (const rec of out.split("\x1e")) {
    const parts = rec.split("\x00");
    if (parts.length < 5 || !parts[0]) continue;
    const subject = (parts[4] ?? "").trim();
    const body = (parts[5] ?? "").trim();
    entries.push({
      sha: parts[0] as string,
      shortSha: parts[1] as string,
      author: parts[2] as string,
      date: parts[3] as string,
      message: body ? `${subject}\n\n${body}` : subject,
    });
  }
  return entries;
}

const SHA_RE = /^[0-9a-f]{4,40}$/i;

/** Unified diff: staged, unstaged (default), or a single commit. */
export async function gitDiff(
  root: string,
  opts: { staged?: boolean; ref?: string } = {},
): Promise<{ diff: string }> {
  assertGitRepo(root);
  const args = ["diff", "--no-color", "--no-ext-diff"];
  if (opts.staged) args.push("--cached");
  if (opts.ref) {
    if (!SHA_RE.test(opts.ref)) throw new GitError("BAD_REF", "Invalid commit reference.");
    args.push(`${opts.ref}^!`);
  }
  const out = await mustSucceed(root, args, "git diff");
  return { diff: out };
}

/** Discard unstaged changes to one file (restore from HEAD). Path validated. */
export async function discardFile(root: string, rel: string): Promise<{ path: string }> {
  assertGitRepo(root);
  let abs: string;
  try {
    abs = resolveSafePath(root, rel);
  } catch (e) {
    throw new GitError("BAD_PATH", e instanceof Error ? e.message : String(e));
  }
  void abs;
  await mustSucceed(root, ["restore", "--source=HEAD", "--", rel], `discard changes to ${rel}`);
  return { path: rel };
}

export interface GitStashEntry { index: number; message: string; }

/** List stash entries. */
export async function stashList(root: string): Promise<GitStashEntry[]> {
  assertGitRepo(root);
  const out = await mustSucceed(root, ["stash", "list", "--format=%gd%x00%gs"], "git stash list");
  const entries: GitStashEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const m = /^stash@\{(\d+)\}\x00(.*)$/.exec(line);
    if (m) entries.push({ index: parseInt(m[1] as string, 10), message: (m[2] ?? "").trim() });
  }
  return entries;
}

/** Stash working-tree changes (includes untracked). */
export async function stashPush(root: string, message?: string): Promise<{ stashed: boolean }> {
  assertGitRepo(root);
  const args = ["stash", "push", "--include-untracked"];
  if (typeof message === "string" && message.trim()) args.push("-m", message.trim().slice(0, 200));
  const out = await mustSucceed(root, args, "git stash");
  return { stashed: !/No local changes to save/i.test(out) };
}

/** Apply the latest stash (or a given index). Honest conflict errors. */
export async function stashPop(root: string, index = 0): Promise<{ popped: boolean }> {
  assertGitRepo(root);
  if (!Number.isInteger(index) || index < 0 || index > 99) throw new GitError("BAD_INDEX", "Invalid stash index.");
  await mustSucceed(root, ["stash", "pop", `stash@{${index}}`], "git stash pop");
  return { popped: true };
}

export interface GitMergeResult { merged: boolean; conflicts: string[]; output: string; }

/**
 * Merge a branch into the current one. Never auto-resolves: on conflict the
 * merge is left in its conflicted state and the conflicting files are
 * reported honestly so the user can resolve them.
 */
export async function gitMerge(root: string, branch: string): Promise<GitMergeResult> {
  assertGitRepo(root);
  validateBranchName(branch);
  const res = await runGit(root, ["merge", "--no-edit", branch.trim()]);
  if (res.timedOut) throw gitFailed(res, "git merge");
  const output = (res.stdout + "\n" + res.stderr).trim();
  if (res.exitCode === 0) return { merged: true, conflicts: [], output: output.slice(0, 2000) };
  // Non-zero: check for conflicts vs other failures.
  let conflicts: string[] = [];
  try {
    const st = await gitStatus(root);
    conflicts = st.files
      .filter((f) => f.staged === "U" || f.unstaged === "U" || (f.staged === "A" && f.unstaged === "A"))
      .map((f) => f.path);
  } catch { /* status failed — report the raw error */ }
  if (conflicts.length || /CONFLICT/i.test(output)) {
    return { merged: false, conflicts, output: output.slice(0, 2000) };
  }
  throw gitFailed(res, "git merge");
}

/** Pull from the upstream. Relies on the environment's git auth; never prompts. */
export async function gitPull(root: string): Promise<{ output: string }> {
  assertGitRepo(root);
  const out = await mustSucceed(root, ["pull", "--ff-only"], "git pull");
  return { output: out.trim().slice(0, 2000) };
}

/** Push to the upstream. Relies on the environment's git auth; never prompts. */
export async function gitPush(root: string): Promise<{ output: string }> {
  assertGitRepo(root);
  const out = await mustSucceed(root, ["push"], "git push");
  return { output: out.trim().slice(0, 2000) };
}

const GITHUB_HTTPS_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

function redactToken(text: string, token: string): string {
  return token ? text.split(token).join("[redacted]") : text;
}

/**
 * Clone a repository using a transient token via http.extraHeader (never in
 * the URL). The token is used once and never stored or logged.
 */
export async function cloneWithToken(
  workspace: string,
  url: string,
  token: string,
  destName?: string,
): Promise<{ name: string }> {
  if (typeof url !== "string" || !GITHUB_HTTPS_RE.test(url.trim())) {
    throw new GitError("BAD_URL", "Only https://github.com/<owner>/<repo> URLs can be cloned.");
  }
  if (typeof token !== "string" || !token.trim() || token.length > 200) {
    throw new GitError("BAD_TOKEN", "A GitHub token is required for private repositories.");
  }
  const clean = url.trim().replace(/\.git\/?$/, "");
  const parts = clean.split("/");
  const owner = parts[parts.length - 2] as string;
  const repo = parts[parts.length - 1] as string;
  const dest = typeof destName === "string" && destName.trim()
    ? destName.trim().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80)
    : `${owner}-${repo}`.slice(0, 80);
  if (!dest) throw new GitError("BAD_URL", "Could not derive a destination name.");
  let destAbs: string;
  try {
    destAbs = resolveSafePath(workspace, dest);
  } catch (e) {
    throw new GitError("BAD_PATH", e instanceof Error ? e.message : String(e));
  }
  if (existsSync(destAbs)) throw new GitError("ALREADY_EXISTS", "That repository is already in the workspace.");
  const header = `Authorization: Bearer ${token.trim()}`;
  const res = await runGit(workspace, [
    "-c", `http.extraHeader=${header}`,
    "clone", "--depth", "1", clean, destAbs,
  ]);
  if (res.timedOut) throw new GitError("TIMEOUT", "Clone timed out after 60s.");
  if (res.exitCode !== 0) {
    const detail = redactToken((res.stderr || res.stdout || "clone failed").trim().split("\n")[0] ?? "", token.trim());
    throw new GitError("CLONE_FAILED", `Clone failed: ${detail.slice(0, 300)}`);
  }
  return { name: dest };
}

// Re-export for route handlers that already import from tools.
export { ToolError };
