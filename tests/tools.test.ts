import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, createDefaultTools, globToRegExp, resolveInWorkspace } from "../src/tools";
import type { ToolContext } from "../src/tools";
import { isSubpath } from "../src/files/workspace";

let root: string;
let registry: ToolRegistry;
let ctx: ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-tools-"));
  registry = new ToolRegistry(createDefaultTools());
  ctx = {
    root,
    run: async () => ({ status: "ok", stdout: "hello from bash", stderr: "", exitCode: 0, durationMs: 1, timedOut: false }),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("built-in tools", () => {
  it("writes and reads a file with numbered lines", async () => {
    const write = await registry.execute("write", { path: "src/a.txt", content: "one\ntwo\n" }, ctx);
    expect(write.ok).toBe(true);
    expect(existsSync(join(root, "src", "a.txt"))).toBe(true);

    const read = await registry.execute("read", { path: "src/a.txt" }, ctx);
    expect(read.ok).toBe(true);
    expect(read.output).toContain("1: one");
    expect(read.output).toContain("2: two");
  });

  it("edits a unique string and rejects ambiguous or missing matches", async () => {
    await registry.execute("write", { path: "b.txt", content: "alpha beta" }, ctx);
    const edited = await registry.execute("edit", { path: "b.txt", oldString: "beta", newString: "gamma" }, ctx);
    expect(edited.ok).toBe(true);
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("alpha gamma");

    const missing = await registry.execute("edit", { path: "b.txt", oldString: "nope", newString: "x" }, ctx);
    expect(missing.ok).toBe(false);

    await registry.execute("write", { path: "c.txt", content: "x x" }, ctx);
    const ambiguous = await registry.execute("edit", { path: "c.txt", oldString: "x", newString: "y" }, ctx);
    expect(ambiguous.ok).toBe(false);
    const all = await registry.execute("edit", { path: "c.txt", oldString: "x", newString: "y", replaceAll: true }, ctx);
    expect(all.ok).toBe(true);
    expect(readFileSync(join(root, "c.txt"), "utf8")).toBe("y y");
  });

  it("lists, globs and greps files", async () => {
    await registry.execute("write", { path: "src/index.ts", content: "export const answer = 42;\n" }, ctx);
    await registry.execute("write", { path: "src/util.ts", content: "// nothing here\n" }, ctx);

    const listed = await registry.execute("list", { path: "src" }, ctx);
    expect(listed.output).toContain("index.ts");

    const globbed = await registry.execute("glob", { pattern: "**/*.ts" }, ctx);
    expect(globbed.output).toContain("src/index.ts");
    expect(globbed.output).toContain("src/util.ts");

    const grepped = await registry.execute("grep", { pattern: "answer" }, ctx);
    expect(grepped.output).toContain("src/index.ts:1:");
  });

  it("blocks paths that escape the workspace", async () => {
    const escaped = await registry.execute("read", { path: "../outside.txt" }, ctx);
    expect(escaped.ok).toBe(false);
    expect(escaped.output.toLowerCase()).toContain("outside");
  });

  it("runs commands through the provided runner", async () => {
    const res = await registry.execute("bash", { command: "echo hello" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("hello from bash");
  });

  it("reports unknown tools", async () => {
    const res = await registry.execute("nope", {}, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("Unknown tool");
  });
});

describe("globToRegExp", () => {
  it("matches nested and root files", () => {
    const re = globToRegExp("**/*.ts");
    expect(re.test("a.ts")).toBe(true);
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("a.js")).toBe(false);
  });
});

describe("workspace path safety", () => {
  it("accepts descendants and rejects siblings and escapes", () => {
    expect(isSubpath("/a", "/a/b")).toBe(true);
    expect(isSubpath("/a", "/a")).toBe(true);
    expect(isSubpath("/a", "/ab")).toBe(false);
    expect(isSubpath("/a", "/a/../b")).toBe(false);
  });

  it("resolves workspace-relative paths", () => {
    const inside = resolveInWorkspace(root, "sub/file.txt");
    expect(inside.ok).toBe(true);
    const outside = resolveInWorkspace(root, "../../etc/passwd");
    expect(outside.ok).toBe(false);
  });
});
