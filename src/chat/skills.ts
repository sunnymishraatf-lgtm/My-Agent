import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../config";
import { parseFrontmatter } from "./agent-config";

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
}

const SKILL_DIRS = [".sunny/skills", ".neutron/skills", ".claude/skills", ".opencode/skills"];

function dirsFor(root: string): string[] {
  return [...SKILL_DIRS.map((d) => join(root, d)), join(configDir(), "skills")];
}

export function loadSkills(root: string): Skill[] {
  const byName = new Map<string, Skill>();
  for (const dir of dirsFor(root)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = join(dir, entry, "SKILL.md");
      const flat = join(dir, entry);
      let target = file;
      if (!existsSync(target)) {
        if (entry.endsWith(".md") && existsSync(flat)) target = flat;
        else continue;
      }
      let text: string;
      try {
        text = readFileSync(target, "utf8");
      } catch {
        continue;
      }
      const { data, body } = parseFrontmatter(text);
      const fallback = entry.replace(/\.md$/i, "");
      const name = typeof data.name === "string" && data.name ? data.name : fallback;
      const description =
        typeof data.description === "string" && data.description
          ? data.description
          : body.split(/\r?\n/).find((l) => l.trim())?.replace(/^#+\s*/, "") ?? name;
      byName.set(name, { name, description, body: body.trim(), path: target });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkill(root: string, name: string): Skill | undefined {
  return loadSkills(root).find((s) => s.name === name);
}