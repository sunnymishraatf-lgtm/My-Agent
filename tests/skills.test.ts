/**
 * Skills library tests — curated Hermes-agent skills wired into the
 * NEUTRON autonomous agent via the read_skill tool.
 */
import { describe, it, expect } from "vitest";
import {
  listSkills,
  parseSkillFrontmatter,
  readSkill,
  renderSkillIndex,
} from "../src/server/agent/skills";
import { TOOL_DEFS } from "../src/server/agent/tools";
import { makeTestRun, toolNeedsApproval } from "../src/server/agent/loop";

describe("parseSkillFrontmatter", () => {
  it("parses quoted name and description", () => {
    const { name, description } = parseSkillFrontmatter(
      '---\nname: "code-review"\ndescription: "Review code for bugs."\n---\n\n# Code Review\n',
    );
    expect(name).toBe("code-review");
    expect(description).toBe("Review code for bugs.");
  });
  it("parses unquoted values", () => {
    const { name, description } = parseSkillFrontmatter(
      "---\nname: debugging\ndescription: Systematic debugging\n---\n",
    );
    expect(name).toBe("debugging");
    expect(description).toBe("Systematic debugging");
  });
  it("tolerates missing frontmatter", () => {
    const { name, description } = parseSkillFrontmatter("# Just a doc\n");
    expect(name).toBe("");
    expect(description).toBe("");
  });
});

describe("skills library", () => {
  it("lists well-formed skills", () => {
    const skills = listSkills();
    expect(Array.isArray(skills)).toBe(true);
    for (const s of skills) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.file.endsWith(".md")).toBe(true);
    }
  });

  it("is sorted by name and has no duplicates", () => {
    const skills = listSkills();
    const names = skills.map((s) => s.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    expect(new Set(names).size).toBe(names.length);
  });

  it("round-trips: readSkill returns the listed skill's full content", () => {
    const skills = listSkills();
    if (skills.length === 0) return; // library not yet curated
    const first = skills[0]!;
    const got = readSkill(first.name);
    expect(got.name).toBe(first.name);
    expect(got.content.length).toBeGreaterThan(0);
  });

  it("readSkill matches case-insensitively", () => {
    const skills = listSkills();
    if (skills.length === 0) return;
    const first = skills[0]!;
    expect(readSkill(first.name.toUpperCase()).name).toBe(first.name);
  });

  it("readSkill rejects unknown, empty, and traversal-style names", () => {
    expect(() => readSkill("no-such-skill-xyz")).toThrow();
    expect(() => readSkill("")).toThrow();
    expect(() => readSkill("../../package.json")).toThrow();
    expect(() => readSkill("skills")).toThrow();
  });

  it("renderSkillIndex mentions every listed skill", () => {
    const skills = listSkills();
    const idx = renderSkillIndex();
    if (skills.length === 0) {
      expect(idx).toBe("");
      return;
    }
    for (const s of skills) expect(idx).toContain(s.name);
  });
});

describe("read_skill tool wiring", () => {
  it("is declared in TOOL_DEFS with no approval", () => {
    const def = TOOL_DEFS.find((t) => t.name === "read_skill");
    expect(def).toBeDefined();
    expect(def!.approval).toBe("none");
  });

  it("never needs approval", () => {
    const run = makeTestRun();
    expect(toolNeedsApproval(run, "read_skill", { name: "x" })).toBe(false);
  });
});
