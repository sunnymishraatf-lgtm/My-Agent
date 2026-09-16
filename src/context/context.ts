import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import type { Task } from "../scheduler/task";

export interface ContextBundle {
  task: string;
  relevantFiles: string[];
  files: Array<{ path: string; content: string }>;
  history: string;
  designExcerpt?: string;
}

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".agent",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

const INCLUDED_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".sql",
  ".prisma",
  ".yml",
  ".yaml",
  ".toml",
  ".env.example",
  ".env.sample",
  ".sh",
  ".ps1",
]);

function listFiles(root: string, max = 300): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0 && result.length < max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (result.length >= max) break;
      const ext = e.name.includes(".") ? `.${e.name.split(".").pop()}` : "";
      if (INCLUDED_EXT.has(ext)) result.push(full);
    }
  }
  return result;
}

function readFileSafe(p: string): { path: string; content: string } | undefined {
  try {
    if (existsSync(p)) {
      const stat = statSync(p);
      if (stat.size > 100_000) return undefined;
      return { path: p, content: readFileSync(p, "utf8") };
    }
  } catch {
    // ignore unreadable files
  }
  return undefined;
}

export function discoverRelevantFiles(task: Task, root: string): string[] {
  const keywords = task.description
    .toLowerCase()
    .replace(/[^a-z0-9_\s/]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const all = listFiles(root);
  const scored = all.map((p) => {
    const rel = relative(root, p).toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (rel.includes(kw)) score += 3;
    }
    const agent = task.agent.toLowerCase();
    const agentDirs: Record<string, string[]> = {
      frontend: ["src/pages", "app", "components", "src/styles", "public", "src/App"],
      backend: ["src/api", "src/routes", "src/controllers", "src/services"],
      database: ["prisma", "src/db", "migrations", "models"],
      devops: ["docker", ".github", "infra", "deploy"],
      security: ["auth", "middleware"],
    };
    for (const dir of agentDirs[agent] ?? []) {
      if (rel.startsWith(dir)) score += 2;
    }
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, 30)
    .map((s) => s.p);
}

export async function getContextForTask(task: Task, root: string): Promise<ContextBundle> {
  const relevant = discoverRelevantFiles(task, root);
  const files: Array<{ path: string; content: string }> = [];
  for (const p of relevant.slice(0, 20)) {
    const entry = readFileSafe(p);
    if (entry) files.push({ path: relative(root, entry.path), content: entry.content });
  }

  let history = "";
  const gitDir = join(root, ".git");
  if (existsSync(gitDir)) {
    try {
      history = execSync("git log --oneline -15", { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).toString();
    } catch {
      history = "";
    }
  }

  let designExcerpt: string | undefined;
  for (const name of ["design.md", "DESIGN.md", "design.MD"]) {
    const p = join(root, name);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf8");
      designExcerpt = content.slice(0, 6_000);
      break;
    }
  }

  return {
    task: task.description,
    relevantFiles: files.map((f) => f.path),
    files,
    history,
    designExcerpt,
  };
}

export function resolveProjectPath(root: string, p: string): string {
  return resolve(root, p);
}