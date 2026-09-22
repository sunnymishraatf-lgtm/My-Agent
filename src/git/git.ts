import { Terminal } from "../terminal/terminal";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Logger } from "../logger";

/** Normalize a path for exact comparison (worktree paths from git may be relative). */
function normPath(p: string): string {
  return resolve(p);
}

export interface GitStatusItem {
  path: string;
  /** True when the index (X) column shows a staged change: A/M/R/C. */
  staged: boolean;
  /** Porcelain v1 X (index) column. */
  index: string;
  /** Porcelain v1 Y (worktree) column. */
  worktree: string;
}

export interface GitWorktree {
  path: string;
  branch: string;
}

/** Shell-quote a single argument for `sh -c` style execution. */
export function shq(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Parse `git status --porcelain` (v1) output, preserving the X/Y status columns.
 * Lines are NOT trimmed: leading spaces are the worktree/index columns, and the
 * path starts at offset 3 (`XY<space>path`).
 */
export function parsePorcelainStatus(stdout: string): GitStatusItem[] {
  const items: GitStatusItem[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    if (x === " " && y === " ") continue;
    const path = line.slice(3);
    if (!path) continue;
    items.push({
      path,
      staged: x === "A" || x === "M" || x === "R" || x === "C",
      index: x,
      worktree: y,
    });
  }
  return items;
}

/** Parse `git worktree list --porcelain` output into worktree entries. */
export function parseWorktreeList(stdout: string): GitWorktree[] {
  const entries: GitWorktree[] = [];
  let path = "";
  let branch = "";
  const flush = () => {
    if (path) entries.push({ path, branch });
    path = "";
    branch = "";
  };
  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
  }
  flush();
  return entries;
}

export class Git {
  private term: Terminal;
  private logger?: Logger;
  private root: string;

  constructor(cwd: string, opts?: { logger?: Logger }) {
    this.root = cwd;
    this.logger = opts?.logger;
    this.term = new Terminal({ cwd, logger: opts?.logger });
  }

  isRepo(): boolean {
    return existsSync(join(this.root, ".git"));
  }

  async init(): Promise<boolean> {
    const r = await this.term.run("git init -q");
    return r.status === "ok";
  }

  async isWorkingClean(): Promise<boolean> {
    const r = await this.term.run("git status --porcelain");
    return r.status === "ok" && r.stdout.trim() === "";
  }

  async currentBranch(): Promise<string> {
    const r = await this.term.run("git rev-parse --abbrev-ref HEAD");
    if (r.status !== "ok") return "main";
    return r.stdout.trim() || "main";
  }

  async status(): Promise<GitStatusItem[]> {
    const r = await this.term.run("git status --porcelain");
    if (r.status !== "ok") return [];
    return parsePorcelainStatus(r.stdout);
  }

  async diff(): Promise<string> {
    const r = await this.term.run("git diff HEAD");
    return r.status === "ok" ? r.stdout : "";
  }

  async log(limit = 10): Promise<string> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const r = await this.term.run(`git log --oneline -${safeLimit}`);
    return r.status === "ok" ? r.stdout : "";
  }

  async add(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    const r = await this.term.run(`git add -- ${paths.map((p) => shq(p)).join(" ")}`);
    return r.status === "ok";
  }

  async commit(message: string): Promise<boolean> {
    const r = await this.term.run(`git commit -m ${shq(message)} --no-verify`);
    return r.status === "ok";
  }

  async createBranch(name: string): Promise<boolean> {
    const r = await this.term.run(`git checkout -b ${shq(name)}`);
    return r.status === "ok";
  }

  async hasWorktree(path: string): Promise<boolean> {
    const r = await this.term.run("git worktree list --porcelain");
    if (r.status !== "ok") return false;
    const target = normPath(path);
    return parseWorktreeList(r.stdout).some((w) => normPath(w.path) === target);
  }

  async addWorktree(path: string, branch: string): Promise<boolean> {
    const r = await this.term.run(`git worktree add ${shq(path)} -b ${shq(branch)}`);
    return r.status === "ok";
  }
}