/**
 * Skills browser tests: the Hermes skill library must be published as static
 * files (public/skills/) with a valid index, and the web app must reference
 * them. The publish script runs in `npm run build`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pubDir = join(root, "public", "skills");
const srcDir = join(root, "src", "server", "agent", "skills");
const appRoot = join(root, "src", "web", "app");

describe("skills publishing", () => {
  it("publishes every skill markdown to public/skills/", () => {
    const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith(".md")).sort();
    expect(srcFiles.length).toBe(124);
    expect(existsSync(join(pubDir, "index.json"))).toBe(true);
    for (const f of srcFiles) {
      expect(existsSync(join(pubDir, f)), `${f} published`).toBe(true);
    }
  });

  it("index.json has a name and description for every skill", () => {
    const index = JSON.parse(readFileSync(join(pubDir, "index.json"), "utf8"));
    expect(index.length).toBe(124);
    const names = new Set<string>();
    for (const e of index) {
      expect(typeof e.name).toBe("string");
      expect(e.name.length).toBeGreaterThan(0);
      expect(typeof e.description).toBe("string");
      expect(typeof e.file).toBe("string");
      expect(e.file.endsWith(".md")).toBe(true);
      expect(names.has(e.name), `duplicate skill name: ${e.name}`).toBe(false);
      names.add(e.name);
    }
  });

  it("published files match sources byte-for-byte", () => {
    const index = JSON.parse(readFileSync(join(pubDir, "index.json"), "utf8"));
    for (const e of index.slice(0, 10)) {
      const a = readFileSync(join(srcDir, e.file), "utf8");
      const b = readFileSync(join(pubDir, e.file), "utf8");
      expect(a).toBe(b);
    }
  });
});

describe("skills web wiring", () => {
  const html = readFileSync(join(appRoot, "index.html"), "utf8");
  const appJs = readFileSync(join(appRoot, "app.js"), "utf8");
  const skillsJs = readFileSync(join(appRoot, "skills.js"), "utf8");

  it("has a nav link, script tag, and route", () => {
    expect(html).toMatch(/data-route="skills"/);
    expect(html).toMatch(/src="\/src\/web\/app\/skills\.js"/);
    expect(appJs).toMatch(/skills:\s*function\s*\(view\)/);
  });

  it("fetches the published index and renders markdown safely", () => {
    expect(skillsJs).toMatch(/\/skills\/index\.json/);
    // Skill file names come from our own index, encoded before fetching.
    expect(skillsJs).toMatch(/encodeURIComponent\(s\.file\)/);
    // Display goes through the app's safe markdown renderer, not innerHTML of raw md.
    expect(skillsJs).toMatch(/renderMarkdown/);
  });
});
