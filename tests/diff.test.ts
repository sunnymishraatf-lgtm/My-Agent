import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTurn, formatDiff, unifiedDiff } from "../src/chat/diff";
import type { TurnSnapshot } from "../src/chat/snapshots";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-diff-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("unified diff", () => {
  it("returns nothing for identical input", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "f.txt")).toBe("");
  });

  it("produces a patch for a modification", () => {
    const patch = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "f.txt");
    expect(patch).toContain("--- a/f.txt");
    expect(patch).toContain("+++ b/f.txt");
    expect(patch).toContain("-b");
    expect(patch).toContain("+B");
  });
});

describe("diffTurn", () => {
  it("classifies added, modified and deleted files", () => {
    writeFileSync(join(root, "added.txt"), "brand new", "utf8");
    writeFileSync(join(root, "modified.txt"), "new content", "utf8");
    const turn: TurnSnapshot = {
      ts: new Date().toISOString(),
      files: {
        "added.txt": null,
        "modified.txt": "old content",
        "deleted.txt": "gone",
      },
    };
    const diffs = diffTurn(root, turn);
    const byPath = Object.fromEntries(diffs.map((d) => [d.path, d.kind]));
    expect(byPath["added.txt"]).toBe("added");
    expect(byPath["modified.txt"]).toBe("modified");
    expect(byPath["deleted.txt"]).toBe("deleted");
  });

  it("formats a combined patch", () => {
    writeFileSync(join(root, "a.txt"), "hello\n", "utf8");
    const turn: TurnSnapshot = { ts: new Date().toISOString(), files: { "a.txt": "hey\n" } };
    const patch = formatDiff(diffTurn(root, turn));
    expect(patch).toContain("-hey");
    expect(patch).toContain("+hello");
  });
});
