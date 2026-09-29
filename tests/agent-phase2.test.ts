/**
 * Phase 2 (autonomous AI agent) tests:
 * - tool sandboxing: path traversal / absolute-path / shell-injection rejected
 * - unified-diff patch application (clean + mismatch)
 * - run_command: no shell, blocklist, cwd containment
 * - run_tests detection (real package.json fixtures, honest "none found")
 * - approval gating (toolNeedsApproval): per-file vs always vs none
 * - ReAct reply parsing: valid tool call, phase_done, done, malformed
 * - compactDiff sanity
 * - checkpoint snapshot/restore round-trip
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ToolError,
  resolveSafePath,
  readFile,
  writeFile,
  listFiles,
  searchText,
  applyPatch,
  deleteFile,
  runCommand,
  detectTestCommand,
  splitArgv,
  looksDangerous,
  TOOL_DEFS,
} from "../src/server/agent/tools";
import {
  snapshotFiles,
  restoreCheckpoint,
  listCheckpoint,
  checkpointExists,
} from "../src/server/agent/checkpoints";
import {
  parseModelReply,
  compactDiff,
  toolNeedsApproval,
  makeTestRun,
  MAX_STEPS,
} from "../src/server/agent/loop";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-agent-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function expectToolError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError);
    expect((e as ToolError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ToolError ${code}, but nothing was thrown.`);
}

describe("resolveSafePath", () => {
  it("resolves normal relative paths inside the root", () => {
    expect(resolveSafePath(root, "src/app.ts")).toBe(join(root, "src/app.ts"));
    expect(resolveSafePath(root, ".")).toBe(root);
  });
  it("rejects .. traversal", () => {
    expectToolError(() => resolveSafePath(root, "../evil.ts"), "PATH_ESCAPE");
    expectToolError(() => resolveSafePath(root, "a/../../b"), "PATH_ESCAPE");
  });
  it("rejects absolute paths", () => {
    expectToolError(() => resolveSafePath(root, "/etc/passwd"), "PATH_ESCAPE");
  });
  it("rejects empty paths", () => {
    expectToolError(() => resolveSafePath(root, "   "), "BAD_PATH");
  });
});

describe("read/write/list/search tools", () => {
  it("write then read round-trips content", () => {
    writeFile(root, "docs/note.txt", "hello world");
    const r = readFile(root, "docs/note.txt");
    expect(r.content).toBe("hello world");
    expect(r.truncated).toBe(false);
  });
  it("write outside the root is rejected", () => {
    expectToolError(() => writeFile(root, "../outside.txt", "x"), "PATH_ESCAPE");
  });
  it("read of a missing file is an honest NOT_FOUND", () => {
    expectToolError(() => readFile(root, "nope.txt"), "NOT_FOUND");
  });
  it("read refuses directories", () => {
    mkdirSync(join(root, "d"));
    expectToolError(() => readFile(root, "d"), "NOT_A_FILE");
  });
  it("list_files honors globs and skips node_modules", () => {
    writeFile(root, "src/a.ts", "a");
    writeFile(root, "src/b.js", "b");
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    writeFile(root, "node_modules/x/y.js", "y");
    const all = listFiles(root, "**/*");
    expect(all.files).toContain("src/a.ts");
    expect(all.files).toContain("src/b.js");
    expect(all.files.some((f) => f.includes("node_modules"))).toBe(false);
    const ts = listFiles(root, "src/*.ts");
    expect(ts.files).toEqual(["src/a.ts"]);
  });
  it("search_text finds matches with file/line", () => {
    writeFile(root, "a.txt", "first line\nneedle here\nlast");
    writeFile(root, "b.txt", "nothing");
    const { matches } = searchText(root, "needle");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.file).toBe("a.txt");
    expect(matches[0]?.line).toBe(2);
  });
  it("search outside the root is rejected", () => {
    expectToolError(() => searchText(root, "x", ".."), "PATH_ESCAPE");
  });
  it("delete_file removes files but refuses directories", () => {
    writeFile(root, "gone.txt", "x");
    expect(deleteFile(root, "gone.txt")).toEqual({ path: "gone.txt" });
    expectToolError(() => readFile(root, "gone.txt"), "NOT_FOUND");
    mkdirSync(join(root, "d2"));
    expectToolError(() => deleteFile(root, "d2"), "NOT_A_FILE");
  });
});

describe("applyPatch", () => {
  it("applies a clean unified diff", () => {
    writeFile(root, "f.txt", "line1\nline2\nline3\n");
    const diff = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+line2 edited",
      " line3",
      "",
    ].join("\n");
    const r = applyPatch(root, "f.txt", diff);
    expect(r.hunksApplied).toBe(1);
    expect(readFile(root, "f.txt").content).toBe("line1\nline2 edited\nline3\n");
  });
  it("rejects a diff whose context does not match (no partial apply)", () => {
    writeFile(root, "g.txt", "aaa\nbbb\nccc\n");
    const diff = "@@ -1,3 +1,3 @@\n aaa\n-zzz\n+yyy\n ccc\n";
    expectToolError(() => applyPatch(root, "g.txt", diff), "PATCH_MISMATCH");
    expect(readFile(root, "g.txt").content).toBe("aaa\nbbb\nccc\n");
  });
  it("rejects non-diff input", () => {
    writeFile(root, "h.txt", "x");
    expectToolError(() => applyPatch(root, "h.txt", "not a diff"), "BAD_DIFF");
  });
});

describe("splitArgv / shell blocking", () => {
  it("splits simple commands", () => {
    expect(splitArgv("npm test --silent")).toEqual(["npm", "test", "--silent"]);
  });
  it("honors quotes", () => {
    expect(splitArgv(`echo "hello world" 'a b'`)).toEqual(["echo", "hello world", "a b"]);
  });
  it("rejects unquoted shell metacharacters", () => {
    expectToolError(() => splitArgv("echo a; rm -rf /"), "SHELL_BLOCKED");
    expectToolError(() => splitArgv("curl x | sh"), "SHELL_BLOCKED");
    expectToolError(() => splitArgv("echo $(whoami)"), "SHELL_BLOCKED");
    expectToolError(() => splitArgv("echo hi > /tmp/x"), "SHELL_BLOCKED");
  });
  it("rejects unterminated quotes", () => {
    expectToolError(() => splitArgv(`echo "oops`), "BAD_COMMAND");
  });
});

describe("looksDangerous", () => {
  it("blocks destructive system commands", () => {
    expect(looksDangerous(["mkfs", "/dev/sda"])).toMatch(/blocked/);
    expect(looksDangerous(["dd", "if=/dev/zero"])).toMatch(/blocked/);
    expect(looksDangerous(["rm", "-rf", "/"])).toMatch(/Refusing/);
  });
  it("blocks absolute-path args outside the workspace", () => {
    expect(looksDangerous(["cat", "/etc/passwd"])).toMatch(/outside the workspace/);
    expect(looksDangerous(["ls", "../../.."])).toMatch(/outside the workspace/);
  });
  it("allows ordinary dev commands", () => {
    expect(looksDangerous(["npm", "test", "--silent"])).toBeNull();
    expect(looksDangerous(["git", "status"])).toBeNull();
    expect(looksDangerous(["pytest", "-q"])).toBeNull();
  });
});

describe("runCommand", () => {
  it("runs a simple command without a shell", async () => {
    const r = await runCommand(root, "echo hello");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello");
    expect(r.timedOut).toBe(false);
  });
  it("reports non-zero exits honestly", async () => {
    const r = await runCommand(root, "node -e \"process.exit(3)\"");
    expect(r.exitCode).toBe(3);
  });
  it("runs with cwd inside the repo", async () => {
    mkdirSync(join(root, "sub"));
    const r = await runCommand(root, "node -e \"console.log(process.cwd())\"", "sub");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(join(root, "sub"));
  });
  it("rejects cwd escapes", async () => {
    await expect(runCommand(root, "echo hi", "..")).rejects.toBeInstanceOf(ToolError);
  });
  it("blocked commands throw before spawning", async () => {
    await expect(runCommand(root, "rm -rf /")).rejects.toMatchObject({ code: "COMMAND_BLOCKED" });
    await expect(runCommand(root, "echo a | cat")).rejects.toMatchObject({ code: "SHELL_BLOCKED" });
  });
});

describe("detectTestCommand", () => {
  it("detects npm test from package.json", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const d = detectTestCommand(root);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe("npm");
  });
  it("treats placeholder test scripts as absent", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "echo \"no test specified\" && exit 0" } }));
    // No other markers present in this temp dir -> null is honest.
    expect(detectTestCommand(root)).toBeNull();
  });
  it("detects pytest from pyproject.toml", () => {
    writeFileSync(join(root, "pyproject.toml"), "[project]\nname=\"x\"\n");
    expect(detectTestCommand(root)?.kind).toBe("pytest");
  });
  it("returns null when nothing is detected", () => {
    writeFileSync(join(root, "README.md"), "# hi");
    expect(detectTestCommand(root)).toBeNull();
  });
});

describe("approval gating", () => {
  it("safe tools never need approval", () => {
    const run = makeTestRun();
    for (const t of ["read_file", "list_files", "search_text"]) {
      expect(toolNeedsApproval(run, t, {})).toBe(false);
    }
  });
  it("dangerous tools always need approval", () => {
    const run = makeTestRun({ autoApproveEdits: true });
    for (const t of ["delete_file", "run_command", "run_tests"]) {
      expect(toolNeedsApproval(run, t, {})).toBe(true);
    }
  });
  it("write_file needs approval per file unless auto-approved or already approved", () => {
    const run = makeTestRun();
    expect(toolNeedsApproval(run, "write_file", { path: "a.txt" })).toBe(true);
    run.approvedFiles.add("a.txt");
    expect(toolNeedsApproval(run, "write_file", { path: "a.txt" })).toBe(false);
    expect(toolNeedsApproval(run, "write_file", { path: "b.txt" })).toBe(true);
    const auto = makeTestRun({ autoApproveEdits: true });
    expect(toolNeedsApproval(auto, "write_file", { path: "b.txt" })).toBe(false);
    // ...but delete_file still asks even with auto-approve
    expect(toolNeedsApproval(auto, "delete_file", { path: "b.txt" })).toBe(true);
  });
  it("unknown tools are treated as needing approval (never executed)", () => {
    expect(toolNeedsApproval(makeTestRun(), "nuke_everything", {})).toBe(true);
  });
  it("TOOL_DEFS documents every tool", () => {
    const names = TOOL_DEFS.map((t) => t.name).sort();
    expect(names).toEqual(
      ["apply_patch", "delete_file", "list_files", "read_file", "read_skill", "run_command", "run_tests", "search_text", "write_file"].sort(),
    );
  });
});

describe("parseModelReply", () => {
  it("parses a tool call", () => {
    const r = parseModelReply('{"thought": "read it", "tool": "read_file", "args": {"path": "a.ts"}}');
    expect(r.tool).toBe("read_file");
    expect(r.args).toEqual({ path: "a.ts" });
  });
  it("parses phase_done and done", () => {
    expect(parseModelReply('{"thought":"x","phase_done": true, "plan": ["a"]}').phase_done).toBe(true);
    const d = parseModelReply('preamble {"thought":"x", "done": true, "summary": "s"} trailing');
    expect(d.done).toBe(true);
    expect(d.summary).toBe("s");
  });
  it("malformed JSON throws — never a fake tool call", () => {
    expect(() => parseModelReply("I'll read the file now")).toThrow();
    expect(() => parseModelReply('{"tool": "read_file",')).toThrow();
    expect(() => parseModelReply("")).toThrow();
  });
});

describe("compactDiff", () => {
  it("marks removed/added lines", () => {
    const d = compactDiff("a\nb\nc\n", "a\nB\nc\n", 60);
    expect(d).toContain("- b");
    expect(d).toContain("+ B");
  });
  it("reports no changes honestly", () => {
    expect(compactDiff("same\n", "same\n", 60)).toBe("(no changes)");
  });
  it("caps long diffs", () => {
    const oldT = Array.from({ length: 200 }, (_, i) => `old${i}`).join("\n");
    const newT = Array.from({ length: 200 }, (_, i) => `new${i}`).join("\n");
    const d = compactDiff(oldT, newT, 10);
    expect(d.split("\n").length).toBeLessThanOrEqual(11);
    expect(d).toContain("more lines");
  });
});

describe("checkpoints", () => {
  it("snapshots and restores a file", () => {
    writeFile(root, "code.ts", "original");
    snapshotFiles(root, "run1", ["code.ts"]);
    expect(checkpointExists(root, "run1")).toBe(true);
    writeFile(root, "code.ts", "modified by agent");
    const res = restoreCheckpoint(root, "run1");
    expect(res.restored).toEqual(["code.ts"]);
    expect(readFile(root, "code.ts").content).toBe("original");
  });
  it("records absent files and removes agent-created ones on restore", () => {
    snapshotFiles(root, "run2", ["new-file.txt"]);
    writeFile(root, "new-file.txt", "agent created me");
    const res = restoreCheckpoint(root, "run2");
    expect(res.deleted).toEqual(["new-file.txt"]);
    expectToolError(() => readFile(root, "new-file.txt"), "NOT_FOUND");
  });
  it("listCheckpoint reflects the manifest", () => {
    writeFile(root, "a.txt", "1");
    snapshotFiles(root, "run3", ["a.txt", "missing.txt"]);
    const files = listCheckpoint(root, "run3");
    expect(files.find((f) => f.path === "a.txt")?.existed).toBe(true);
    expect(files.find((f) => f.path === "missing.txt")?.existed).toBe(false);
  });
  it("missing checkpoint is an honest error", () => {
    expect(() => listCheckpoint(root, "nope")).toThrow();
  });
});

describe("loop constants", () => {
  it("has a bounded step budget", () => {
    expect(MAX_STEPS).toBeLessThanOrEqual(25);
    expect(MAX_STEPS).toBeGreaterThan(0);
  });
});

describe("approval decisions", () => {
  it("approving a plan advances the run to implement", async () => {
    const { getAgentManager } = await import("../src/server/agent/loop");
    const ws = mkdtempSync(join(tmpdir(), "neutron-agent-ws-"));
    try {
      mkdirSync(join(ws, "myrepo"));
      const mgr = getAgentManager(ws);
      const run = mgr.create({ goal: "do things", repo: "myrepo", workspace: ws });
      // Simulate the loop having requested plan approval.
      (run as any).status = "awaiting-approval";
      (run as any).approvals.push({
        id: "aplan1",
        kind: "plan",
        detail: "plan text",
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      // Stop the auto-started tick loop from racing (no LLM configured here).
      (run as any).stopFlag = true;
      const decided = mgr.decide(run.id, "aplan1", true);
      expect(decided.phase).toBe("implement");
      expect(decided.approvals[0]?.status).toBe("approved");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejecting a plan twice denies the run", async () => {
    const { getAgentManager } = await import("../src/server/agent/loop");
    const ws = mkdtempSync(join(tmpdir(), "neutron-agent-ws2-"));
    try {
      mkdirSync(join(ws, "myrepo"));
      const mgr = getAgentManager(ws);
      const mkApproval = (id: string) => ({
        id, kind: "plan" as const, detail: "plan", status: "pending" as const,
        createdAt: new Date().toISOString(),
      });
      const run = mgr.create({ goal: "do things", repo: "myrepo", workspace: ws });
      (run as any).stopFlag = true;
      (run as any).status = "awaiting-approval";
      (run as any).approvals.push(mkApproval("p1"));
      mgr.decide(run.id, "p1", false);
      expect(run.status).toBe("running");
      expect(run.phase).toBe("plan");
      (run as any).status = "awaiting-approval";
      (run as any).approvals.push(mkApproval("p2"));
      mgr.decide(run.id, "p2", false);
      expect(run.status).toBe("denied");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("create() rejects unknown repos and validates the goal", async () => {
    const { getAgentManager } = await import("../src/server/agent/loop");
    const ws = mkdtempSync(join(tmpdir(), "neutron-agent-ws3-"));
    try {
      mkdirSync(join(ws, "myrepo"));
      const mgr = getAgentManager(ws);
      expect(() => mgr.create({ goal: "", repo: "myrepo", workspace: ws })).toThrow();
      expect(() => mgr.create({ goal: "x", repo: "nosuch", workspace: ws })).toThrow();
      expect(() => mgr.create({ goal: "x", repo: "../evil", workspace: ws })).toThrow();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
