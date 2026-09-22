import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { walkFiles } from "../tools/paths";
import { relative } from "node:path";

const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|\.git|\.agent)([\\/]|$)/;

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function generateAgentsMd(root: string): string {
  const name = basename(root) || "project";
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push("");
  lines.push(
    "This file gives AI coding agents context about the project. Keep it up to date.",
  );
  lines.push("");

  const pkg = readJson(join(root, "package.json"));
  if (pkg) {
    if (typeof pkg.name === "string") lines.push(`- Package: \`${pkg.name}\``);
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, string>) : {};
    const scriptNames = Object.keys(scripts);
    if (scriptNames.length > 0) {
      lines.push("");
      lines.push("## Scripts");
      lines.push("");
      for (const key of scriptNames.slice(0, 20)) {
        lines.push(`- \`npm run ${key}\` — \`${scripts[key]}\``);
      }
    }
    const deps = pkg.dependencies && typeof pkg.dependencies === "object" ? Object.keys(pkg.dependencies) : [];
    const devDeps =
      pkg.devDependencies && typeof pkg.devDependencies === "object" ? Object.keys(pkg.devDependencies) : [];
    if (deps.length + devDeps.length > 0) {
      lines.push("");
      lines.push("## Stack");
      lines.push("");
      if (deps.length > 0) lines.push(`- Dependencies: ${deps.slice(0, 20).join(", ")}`);
      if (devDeps.length > 0) lines.push(`- Dev dependencies: ${devDeps.slice(0, 20).join(", ")}`);
    }
  }

  const files = walkFiles(root, 2000)
    .filter((f) => !SKIP.test(f))
    .map((f) => relative(root, f).split(/[\\/]/).join("/"));
  const byExt = new Map<string, number>();
  for (const f of files) {
    const ext = f.includes(".") ? f.slice(f.lastIndexOf(".")) : "(none)";
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
  }
  if (byExt.size > 0) {
    lines.push("");
    lines.push("## Layout");
    lines.push("");
    lines.push(`${files.length} tracked files. Top extensions:`);
    lines.push("");
    for (const [ext, count] of [...byExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      lines.push(`- \`${ext}\` — ${count}`);
    }
  }

  lines.push("");
  lines.push("## Conventions");
  lines.push("");
  lines.push("- Read files before editing them; make small, targeted changes.");
  lines.push("- Run the project's tests and linters before finishing.");
  lines.push("- Never commit secrets or API keys.");
  lines.push("");
  return lines.join("\n");
}

export function initAgentsFile(root: string): { path: string; created: boolean } {
  const path = join(root, "AGENTS.md");
  if (existsSync(path)) return { path, created: false };
  writeFileSync(path, generateAgentsMd(root), "utf8");
  return { path, created: true };
}
