import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeTaskBatches, detectFileChanges, maxBatchWidth } from "../src/neutron/agents";
import type { NeutronTask } from "../src/neutron/model";

function task(id: string, dependencies: string[] = []): NeutronTask {
  return { id, label: id, agent: "backend", files: [], dependencies, risk: "low", reason: "", status: "pending" };
}

describe("detectFileChanges", () => {
  it("never reports changes outside the repository root", () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-repo-"));
    const outside = mkdtempSync(join(tmpdir(), "neutron-outside-"));
    try {
      const tasks: NeutronTask[] = [
        { ...task("t1"), files: ["src/a.ts", "../escape.txt", join(outside, "evil.txt"), "/etc/hostname"] },
      ];
      const changes = detectFileChanges(root, tasks, [
        { path: "src/a.ts", before: "const a = 1;\n", after: "const a = 2;\n" },
        { path: "../escape.txt", before: "a", after: "b" },
        { path: join(outside, "evil.txt"), before: "a", after: "b" },
        { path: "/etc/hostname", before: "a", after: "b" },
      ]);
      expect(changes.map((c) => c.path)).toEqual(["src/a.ts"]);
      expect(changes[0]!.kind).toBe("modified");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("classifies added / modified / deleted / unchanged files", () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-repo-"));
    try {
      const tasks: NeutronTask[] = [{ ...task("t1"), files: ["new.ts", "mod.ts", "del.ts", "same.ts"] }];
      const changes = detectFileChanges(root, tasks, [
        { path: "new.ts", before: undefined, after: "x\n" },
        { path: "mod.ts", before: "a\n", after: "b\n" },
        { path: "del.ts", before: "a\n", after: undefined },
        { path: "same.ts", before: "a\n", after: "a\n" },
      ]);
      expect(changes.map((c) => `${c.path}:${c.kind}`)).toEqual(["del.ts:deleted", "mod.ts:modified", "new.ts:added"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("parallel task width", () => {
  it("computeTaskBatches groups a known schedule into dependency-ordered batches", () => {
    const tasks = [task("a"), task("b"), task("c"), task("d", ["a", "b"]), task("e", ["d"])];
    const batches = computeTaskBatches(tasks);
    expect(batches.map((b) => b.map((t) => t.id).sort())).toEqual([["a", "b", "c"], ["d"], ["e"]]);
  });

  it("maxBatchWidth returns the maximum batch width, not a sum or total", () => {
    // widths [3, 1, 1]: sum/total would be 5, max is 3
    expect(maxBatchWidth([3, 1, 1])).toBe(3);
    expect(maxBatchWidth([1, 1, 1])).toBe(1);
    expect(maxBatchWidth([])).toBe(0);
  });

  it("measures the maximum concurrent width of a known schedule", () => {
    const tasks = [task("a"), task("b"), task("c"), task("d", ["a", "b"]), task("e", ["d"])];
    const widths = computeTaskBatches(tasks).map((b) => b.length);
    expect(widths).toEqual([3, 1, 1]);
    // 5 tasks total, but at most 3 ever run concurrently
    expect(maxBatchWidth(widths)).toBe(3);
    expect(maxBatchWidth(widths)).toBeLessThan(tasks.length);
  });
});
