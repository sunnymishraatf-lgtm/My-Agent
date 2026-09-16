import { Terminal } from "../terminal/terminal";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../logger";

export interface GitStatusItem {
  path: string;
  staged: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string;
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
    const items: GitStatusItem[] = [];
    for (const line of r.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const staged = trimmed.startsWith("A") || trimmed.startsWith("M") || trimmed.startsWith("R") || trimmed.startsWith("C");
      items.push({
        path: trimmed.slice(3),
        staged,
      });
    }
    return items;
  }

  async diff(): Promise<string> {
    const r = await this.term.run("git diff HEAD");
    return r.status === "ok" ? r.stdout : "";
  }

  async log(limit = 10): Promise<string> {
    const r = await this.term.run(`git log --oneline -${limit}`);
    return r.status === "ok" ? r.stdout : "";
  }

  async add(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    const r = await this.term.run(`git add -- ${paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(" ")}`);
    return r.status === "ok";
  }

  async commit(message: string): Promise<boolean> {
    const escaped = message.replace(/'/g, "'\\''");
    const r = await this.term.run(`git commit -m '${escaped}' --no-verify`);
    return r.status === "ok";
  }

  async createBranch(name: string): Promise<boolean> {
    const r = await this.term.run(`git checkout -b ${name}`);
    return r.status === "ok";
  }

  async hasWorktree(path: string): Promise<boolean> {
    const r = await this.term.run(`git worktree list`);
    return r.status === "ok" && r.stdout.includes(path);
  }

  async addWorktree(path: string, branch: string): Promise<boolean> {
    const r = await this.term.run(`git worktree add ${path} -b ${branch}`);
    return r.status === "ok";
  }
}