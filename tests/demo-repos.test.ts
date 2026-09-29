/**
 * Workspace repository listing tests: listWorkspaceRepos() in src/server/demo.ts.
 * Powers the Repositories view's "Workspace repositories" section and
 * GET /api/demo/repos (Node + Vercel).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceRepos } from "../src/server/demo";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "neutron-repos-"));
  dirs.push(d);
  return d;
}

describe("listWorkspaceRepos", () => {
  it("lists directories with file counts, sorted by name", () => {
    const ws = tmp();
    mkdirSync(join(ws, "taskflow"));
    writeFileSync(join(ws, "taskflow", "a.ts"), "x");
    writeFileSync(join(ws, "taskflow", "b.ts"), "x");
    mkdirSync(join(ws, "acme-widget"));
    writeFileSync(join(ws, "acme-widget", "index.js"), "x");
    const repos = listWorkspaceRepos(ws);
    expect(repos.map((r) => r.name)).toEqual(["acme-widget", "taskflow"]);
    expect(repos[0]!.files).toBe(1);
    expect(repos[1]!.files).toBe(2);
  });

  it("returns an empty list for an empty or missing workspace", () => {
    expect(listWorkspaceRepos(tmp())).toEqual([]);
    expect(listWorkspaceRepos(join(tmp(), "nope"))).toEqual([]);
  });

  it("skips files, hidden dirs, and suspicious names", () => {
    const ws = tmp();
    writeFileSync(join(ws, "notes.txt"), "x");
    mkdirSync(join(ws, ".hidden"));
    mkdirSync(join(ws, "..evil"));
    mkdirSync(join(ws, "ok-repo"));
    const repos = listWorkspaceRepos(ws);
    expect(repos.map((r) => r.name)).toEqual(["ok-repo"]);
  });

  it("does not descend into .git or node_modules when counting", () => {
    const ws = tmp();
    mkdirSync(join(ws, "proj", ".git", "objects"), { recursive: true });
    writeFileSync(join(ws, "proj", ".git", "objects", "x"), "x".repeat(100));
    mkdirSync(join(ws, "proj", "node_modules", "dep"), { recursive: true });
    writeFileSync(join(ws, "proj", "node_modules", "dep", "i.js"), "x");
    writeFileSync(join(ws, "proj", "src.ts"), "x");
    const repos = listWorkspaceRepos(ws);
    expect(repos).toHaveLength(1);
    expect(repos[0]!.files).toBe(1);
  });

  it("never returns absolute server paths", () => {
    const ws = tmp();
    mkdirSync(join(ws, "proj"));
    const repos = listWorkspaceRepos(ws);
    expect(repos[0]!.name).toBe("proj");
    expect(JSON.stringify(repos)).not.toContain(ws);
  });
});
