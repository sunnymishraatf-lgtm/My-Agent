import { describe, it, expect } from "vitest";
import { parsePorcelainStatus, parseWorktreeList, shq } from "../src/git/git";

describe("parsePorcelainStatus", () => {
  it("preserves X/Y columns without trimming", () => {
    const items = parsePorcelainStatus(" M src/a.ts\nM  src/b.ts\nA  src/c.ts\n?? src/d.ts\n");
    expect(items).toHaveLength(4);
    // " M": unstaged modification — X is blank, must NOT count as staged.
    expect(items[0]).toMatchObject({ path: "src/a.ts", staged: false, index: " ", worktree: "M" });
    // "M ": staged modification.
    expect(items[1]).toMatchObject({ path: "src/b.ts", staged: true, index: "M", worktree: " " });
    expect(items[2]).toMatchObject({ path: "src/c.ts", staged: true, index: "A", worktree: " " });
    expect(items[3]).toMatchObject({ path: "src/d.ts", staged: false, index: "?", worktree: "?" });
  });

  it("does not mangle paths with leading spaces trimmed", () => {
    const items = parsePorcelainStatus(" M file with spaces.ts\n");
    expect(items[0]!.path).toBe("file with spaces.ts");
  });

  it("ignores blank lines", () => {
    expect(parsePorcelainStatus("\n")).toEqual([]);
  });
});

describe("parseWorktreeList", () => {
  it("parses porcelain worktree entries", () => {
    const out = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/wt",
      "HEAD def456",
      "branch refs/heads/feature",
      "detached",
      "",
    ].join("\n");
    const entries = parseWorktreeList(out);
    expect(entries).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo/wt", branch: "feature" },
    ]);
  });
});

describe("shq", () => {
  it("shell-quotes arguments safely", () => {
    expect(shq("simple")).toBe("'simple'");
    expect(shq("a b")).toBe("'a b'");
    expect(shq("it's")).toBe(`'it'\\''s'`);
    expect(shq("$(evil)")).toBe("'$(evil)'");
    expect(shq("")).toBe("''");
  });
});
