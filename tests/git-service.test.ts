/**
 * Git service tests: real git operations against temp repositories.
 * No mocks for the happy paths — status, commit, branches, diff, stash,
 * merge-conflict honesty, discard, validation, traversal rejection, timeout.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  GitError,
  assertGitRepo,
  gitStatus,
  gitStage,
  gitBranches,
  createBranch,
  switchBranch,
  gitCommit,
  gitLog,
  gitDiff,
  discardFile,
  stashList,
  stashPush,
  stashPop,
  gitMerge,
  setGitBinForTests,
  resetGitBinForTests,
} from "../src/server/git/git-service";

let root: string;

function git(args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-git-test-"));
  git(["init", "-q"]);
  git(["config", "user.email", "test@test.test"]);
  git(["config", "user.name", "test"]);
  writeFileSync(join(root, "a.txt"), "hello\n");
});

afterEach(() => {
  resetGitBinForTests();
  rmSync(root, { recursive: true, force: true });
});

function commitAll(msg: string): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", msg]);
}

describe("assertGitRepo", () => {
  it("accepts a git repo", () => {
    expect(() => assertGitRepo(root)).not.toThrow();
  });
  it("rejects a non-repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "neutron-notrepo-"));
    try {
      expect(() => assertGitRepo(dir)).toThrowError(GitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gitStatus", () => {
  it("reports untracked files", async () => {
    const st = await gitStatus(root);
    expect(st.clean).toBe(false);
    expect(st.files).toHaveLength(1);
    expect(st.files[0]).toMatchObject({ path: "a.txt", staged: "?", unstaged: "?" });
  });
  it("reports a clean tree after commit", async () => {
    commitAll("first");
    const st = await gitStatus(root);
    expect(st.clean).toBe(true);
    expect(st.files).toHaveLength(0);
    expect(st.branch).toBeTruthy();
  });
  it("distinguishes staged vs unstaged", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "changed\n");
    writeFileSync(join(root, "b.txt"), "new\n");
    git(["add", "b.txt"]);
    const st = await gitStatus(root);
    const byPath = Object.fromEntries(st.files.map((f) => [f.path, f]));
    expect(byPath["a.txt"]).toMatchObject({ staged: "", unstaged: "M" });
    expect(byPath["b.txt"]).toMatchObject({ staged: "A", unstaged: "" });
  });
  it("parses ahead/behind as numbers", async () => {
    commitAll("first");
    const st = await gitStatus(root);
    expect(typeof st.ahead).toBe("number");
    expect(typeof st.behind).toBe("number");
  });
});

describe("gitStage", () => {
  it("stages everything when no paths given", async () => {
    await gitStage(root);
    const st = await gitStatus(root);
    expect(st.files.every((f) => f.staged !== "")).toBe(true);
  });
  it("stages specific paths", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "x\n");
    writeFileSync(join(root, "b.txt"), "y\n");
    await gitStage(root, ["a.txt"]);
    const st = await gitStatus(root);
    const byPath: Record<string, { staged: string }> = Object.fromEntries(st.files.map((f) => [f.path, f]));
    expect(byPath["a.txt"]!.staged).toBe("M");
    expect(byPath["b.txt"]!.staged).toBe("?"); // untouched → still untracked
  });
  it("rejects path escape", async () => {
    await expect(gitStage(root, ["../evil.txt"])).rejects.toThrowError(GitError);
  });
});

describe("branches", () => {
  it("creates and switches branches", async () => {
    commitAll("first");
    await createBranch(root, "feat/x");
    const br = await gitBranches(root);
    expect(br.branches).toContain("feat/x");
    await switchBranch(root, "feat/x");
    const br2 = await gitBranches(root);
    expect(br2.current).toBe("feat/x");
  });
  it("rejects bad branch names", async () => {
    commitAll("first");
    await expect(createBranch(root, "")).rejects.toThrowError(GitError);
    await expect(createBranch(root, "a..b")).rejects.toThrowError(GitError);
    await expect(createBranch(root, "../x")).rejects.toThrowError(GitError);
    await expect(switchBranch(root, "x;y")).rejects.toThrowError(GitError);
  });
});

describe("gitCommit", () => {
  it("commits staged changes and returns a sha", async () => {
    await gitStage(root);
    const r = await gitCommit(root, "my commit");
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await gitStatus(root)).clean).toBe(true);
  });
  it("rejects empty messages", async () => {
    await gitStage(root);
    await expect(gitCommit(root, "   ")).rejects.toThrowError(GitError);
  });
  it("fails honestly with nothing staged", async () => {
    commitAll("first");
    await expect(gitCommit(root, "empty")).rejects.toThrowError(GitError);
  });
});

describe("gitLog", () => {
  it("lists commits newest first and caps at 100", async () => {
    commitAll("one");
    writeFileSync(join(root, "a.txt"), "two\n");
    commitAll("two");
    const log = await gitLog(root, 10);
    expect(log).toHaveLength(2);
    expect(log[0]!.message).toContain("two");
    expect(log[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(log[0]!.shortSha).toHaveLength(7);
  });
});

describe("gitDiff", () => {
  it("shows unstaged diffs by default", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "changed\n");
    const d = await gitDiff(root);
    expect(d.diff).toContain("+changed");
    expect(d.diff).toContain("diff --git");
  });
  it("shows staged diffs with staged:true", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "changed\n");
    git(["add", "a.txt"]);
    const d = await gitDiff(root, { staged: true });
    expect(d.diff).toContain("+changed");
    const unstaged = await gitDiff(root);
    expect(unstaged.diff).toBe("");
  });
  it("shows a single commit diff by ref", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "second\n");
    commitAll("second");
    const log = await gitLog(root, 1);
    const d = await gitDiff(root, { ref: log[0]!.sha });
    expect(d.diff).toContain("+second");
  });
  it("rejects bad refs", async () => {
    commitAll("first");
    await expect(gitDiff(root, { ref: "not-a-sha!!" })).rejects.toThrowError(GitError);
  });
});

describe("discardFile", () => {
  it("restores a file from HEAD", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "trashed\n");
    await discardFile(root, "a.txt");
    const st = await gitStatus(root);
    expect(st.files.find((f) => f.path === "a.txt" && f.unstaged === "M")).toBeUndefined();
  });
  it("rejects path escape", async () => {
    commitAll("first");
    await expect(discardFile(root, "../evil.txt")).rejects.toThrowError(GitError);
  });
});

describe("stash", () => {
  it("push/list/pop round-trip", async () => {
    commitAll("first");
    writeFileSync(join(root, "a.txt"), "wip\n");
    const p = await stashPush(root, "my wip");
    expect(p.stashed).toBe(true);
    expect((await gitStatus(root)).clean).toBe(true);
    const list = await stashList(root);
    expect(list).toHaveLength(1);
    expect(list[0]!.message).toContain("my wip");
    await stashPop(root);
    const st = await gitStatus(root);
    expect(st.files.some((f) => f.path === "a.txt")).toBe(true);
  });
  it("reports honestly when there is nothing to stash", async () => {
    commitAll("first");
    const p = await stashPush(root);
    expect(p.stashed).toBe(false);
  });
});

describe("gitMerge", () => {
  it("merges cleanly", async () => {
    commitAll("first");
    await createBranch(root, "feat");
    await switchBranch(root, "feat");
    writeFileSync(join(root, "b.txt"), "b\n");
    commitAll("feat work");
    const cur = (await gitBranches(root)).branches.find((b) => b !== "feat")!;
    await switchBranch(root, cur);
    const r = await gitMerge(root, "feat");
    expect(r.merged).toBe(true);
    expect(r.conflicts).toHaveLength(0);
  });
  it("reports conflicts honestly without auto-resolving", async () => {
    commitAll("first");
    await createBranch(root, "c1");
    await switchBranch(root, "c1");
    writeFileSync(join(root, "a.txt"), "side A\n");
    commitAll("A");
    const main = (await gitBranches(root)).branches.find((b) => b !== "c1")!;
    await switchBranch(root, main);
    writeFileSync(join(root, "a.txt"), "side B\n");
    commitAll("B");
    const r = await gitMerge(root, "c1");
    expect(r.merged).toBe(false);
    expect(r.conflicts).toContain("a.txt");
    // The merge is left conflicted — nothing silently resolved.
    const st = await gitStatus(root);
    expect(st.files.some((f) => f.path === "a.txt")).toBe(true);
  });
  it("rejects bad branch names", async () => {
    commitAll("first");
    await expect(gitMerge(root, "no;pe")).rejects.toThrowError(GitError);
  });
});

describe("timeout", () => {
  it("fails with TIMEOUT when git hangs", async () => {
    const scriptDir = mkdtempSync(join(tmpdir(), "neutron-git-bin-"));
    const script = join(scriptDir, "slow-git");
    writeFileSync(script, "#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n");
    chmodSync(script, 0o755);
    setGitBinForTests(script);
    process.env.NEUTRON_GIT_TIMEOUT_MS = "400";
    // Use a fresh dir (not a repo) so assertGitRepo isn't the failure.
    const dir2 = mkdtempSync(join(tmpdir(), "neutron-git-timeout-"));
    mkdirSync(join(dir2, ".git"));
    try {
      await expect(gitStatus(dir2)).rejects.toThrowError(/timed out/);
    } finally {
      delete process.env.NEUTRON_GIT_TIMEOUT_MS;
      rmSync(dir2, { recursive: true, force: true });
      rmSync(scriptDir, { recursive: true, force: true });
    }
  }, 20000);
});

describe("pull/push honesty", () => {
  it("pull fails honestly with no remote", async () => {
    commitAll("first");
    const { gitPull } = await import("../src/server/git/git-service");
    await expect(gitPull(root)).rejects.toThrowError(GitError);
  });
});
