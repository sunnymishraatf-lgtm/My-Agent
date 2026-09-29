/**
 * Skills library for the autonomous agent (Node server only).
 *
 * Curated portable skills sourced from the Hermes Agent project by Nous
 * Research (MIT licensed — see vendor/hermes-agent/ATTRIBUTION.md).
 * Only skills that do NOT depend on Hermes-specific infrastructure
 * (gateway, `hermes` CLI, Hermes-only tools) were selected, so the agent
 * never hallucinates capabilities it does not have.
 *
 * The agent loop injects the skill INDEX (name + one-line description)
 * into the system prompt and the agent pulls full skill text on demand
 * with the `read_skill` tool. This keeps the prompt small while giving
 * the agent 100+ expert playbooks (code review, testing, debugging,
 * research, devops, …).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "skills");

const MAX_SKILL_BYTES = 100_000;

export interface SkillMeta {
  name: string;
  description: string;
  file: string;
}

/** Parse the YAML frontmatter block (name/description) at the top of a SKILL.md. */
export function parseSkillFrontmatter(content: string): { name: string; description: string } {
  let name = "";
  let description = "";
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = content.slice(3, end);
      for (const line of fm.split("\n")) {
        const m = line.match(/^\s*(name|description)\s*:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/);
        if (m) {
          const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
          if (m[1] === "name") name = value;
          else description = value;
        }
      }
    }
  }
  return { name, description };
}

/** List every curated skill (name + description). Never throws — returns []. */
export function listSkills(): SkillMeta[] {
  let files: string[] = [];
  try {
    files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out: SkillMeta[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(SKILLS_DIR, file), "utf8");
      const { name, description } = parseSkillFrontmatter(content);
      out.push({
        name: name || file.replace(/\.md$/, ""),
        description: description || "(no description)",
        file,
      });
    } catch {
      // Skip unreadable skill files; the library stays usable.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Read one skill's full text by name (case-insensitive exact match).
 * The name is matched against the scanned library — never used as a path —
 * so there is no directory-traversal risk.
 */
export function readSkill(name: string): { name: string; content: string } {
  const want = String(name || "").trim().toLowerCase();
  if (!want) throw new Error("Skill name is required.");
  const found = listSkills().find((s) => s.name.toLowerCase() === want);
  if (!found) throw new Error(`Unknown skill: ${name}`);
  const abs = join(SKILLS_DIR, found.file);
  const buf = readFileSync(abs);
  return {
    name: found.name,
    content: buf.slice(0, MAX_SKILL_BYTES).toString("utf8"),
  };
}

/** Render the compact index injected into the agent system prompt. */
export function renderSkillIndex(): string {
  const skills = listSkills();
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return [
    "Skills library (expert playbooks — call read_skill with { name } to load the full text before relying on one):",
    ...lines,
  ].join("\n");
}

export function skillsDirExists(): boolean {
  return existsSync(SKILLS_DIR);
}
