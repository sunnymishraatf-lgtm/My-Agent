/**
 * Generalized checkpoint service tests: manual checkpoints, safe restore,
 * compare, per-file restore, pruning, unified diffs, and the no-partial-
 * apply guarantee of applyPatch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyPatch,
  ToolError,
} from "../src/server/agent/tools";
import {
  compareCheckpoints,
  createManualCheckpoint,
  deleteCheckpoint,
  getCheckpoint,
  listCheckpoints,
  pruneManualCheckpoints,
  readCheckpointFile,
  restoreCheckpoint,
  restoreCheckpointFile,
  safeRestoreCheckpoint,
  snapshotFiles,
  unifiedDiff,
} from "../src/server/agent/checkpoints";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-cp-"));
  writeFileSync(join(root, "a.txt"), "line1\nline2\nline3\n");
  writeFileSync(join(root, "b.txt"), "hello\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function read(p: string): string {
  return readFileSync(join(root, p), "utf8");
}

describe("unifiedDiff", () => {
  it("returns empty string for identical texts", () => {
    expect(unifiedDiff("x\ny\n", "x\ny\n", "f.txt")).toBe("");
  });
  it("produces a real unified diff with @@ header", () => {
    const d = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "f.txt");
    expect(d).toContain("--- a/f.txt");
    expect(d).toContain("+++ b/f.txt");
    expect(d).toMatch(/@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
    expect(d).toContain("-b");
    expect(d).toContain("+B");
    expect(d).toContain(" a");
  });
  it("handles added and removed files", () => {
    const added = unifiedDiff("", "new\n", "n.txt");
    expect(added).toContain("+new");
    const addedHunks = added.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(addedHunks.length).toBe(0);
    const removed = unifiedDiff("old\n", "", "n.txt");
    expect(removed).toContain("-old");
  });
  it("caps long diffs with a truncation marker", () => {
    const big = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
    const d = unifiedDiff(big, big + "\nextra\n".repeat(50), "f.txt", { maxLines: 10 });
    expect(d).toContain("... (diff truncated");
  });
});

describe("manual checkpoints", () => {
  it("snapshots and restores the repo round-trip", () => {
    const cp = createManualCheckpoint(root, "before work");
    expect(cp.fileCount).toBe(2);
    expect(cp.label).toBe("before work");
    writeFileSync(join(root, "a.txt"), "CHANGED\n");
    writeFileSync(join(root, "c.txt"), "new file\n");
    rmSync(join(root, "b.txt"));
    const res = restoreCheckpoint(root, cp.id);
    expect(res.restored).toContain("a.txt");
    expect(res.restored).toContain("b.txt");
    expect(read("a.txt")).toBe("line1\nline2\nline3\n");
    expect(read("b.txt")).toBe("hello\n");
    // Files created after the snapshot are outside the checkpoint's scope:
    // restore leaves them in place (never silently destroys new work).
    expect(read("c.txt")).toBe("new file\n");
  });

  it("rejects an empty label", () => {
    expect(() => createManualCheckpoint(root, "   ")).toThrowError(ToolError);
  });

  it("rejects traversal-style ids", () => {
    expect(() => getCheckpoint(root, "../evil")).toThrowError(ToolError);
    expect(() => getCheckpoint(root, "a/b")).toThrowError(ToolError);
  });

  it("lists newest first and reads legacy run manifests", () => {
    snapshotFiles(root, "run-legacy-1", ["a.txt"]);
    const cp = createManualCheckpoint(root, "second");
    const list = listCheckpoints(root);
    expect(list.length).toBe(2);
    expect(list[0]!.id).toBe(cp.id);
    expect(list[1]!.kind).toBe("run");
  });

  it("deletes a checkpoint", () => {
    const cp = createManualCheckpoint(root, "temp");
    deleteCheckpoint(root, cp.id);
    expect(() => getCheckpoint(root, cp.id)).toThrowError(ToolError);
    expect(listCheckpoints(root).length).toBe(0);
  });

  it("prunes manual checkpoints to 20 but never run checkpoints", () => {
    for (let i = 0; i < 22; i++) createManualCheckpoint(root, `cp-${i}`);
    snapshotFiles(root, "run-keep-me", ["a.txt"]);
    const list = listCheckpoints(root);
    expect(list.filter((m) => m.kind === "manual").length).toBe(20);
    expect(list.some((m) => m.id === "run-keep-me")).toBe(true);
  });
});

describe("safeRestoreCheckpoint", () => {
  it("snapshots a pre-restore checkpoint and restores", () => {
    const cp = createManualCheckpoint(root, "baseline");
    writeFileSync(join(root, "a.txt"), "MODIFIED\n");
    const res = safeRestoreCheckpoint(root, cp.id);
    expect(read("a.txt")).toBe("line1\nline2\nline3\n");
    expect(res.preRestoreId).toBeTruthy();
    // The pre-restore checkpoint holds the modified state.
    const pre = readCheckpointFile(root, res.preRestoreId, "a.txt");
    expect(pre.content).toBe("MODIFIED\n");
    expect(res.preRestoreLabel).toContain("pre-restore");
  });

  it("restore-then-restore-again returns to the intermediate state", () => {
    const cp = createManualCheckpoint(root, "baseline");
    writeFileSync(join(root, "a.txt"), "MODIFIED\n");
    const first = safeRestoreCheckpoint(root, cp.id);
    expect(read("a.txt")).toBe("line1\nline2\nline3\n");
    // Restore the pre-restore checkpoint: back to MODIFIED. That restore
    // itself snapshots another pre-restore (the baseline state).
    const second = safeRestoreCheckpoint(root, first.preRestoreId);
    expect(read("a.txt")).toBe("MODIFIED\n");
    expect(second.preRestoreId).not.toBe(first.preRestoreId);
  });
});

describe("compareCheckpoints", () => {
  it("produces real diffs for changed files and omits unchanged ones", () => {
    const c1 = createManualCheckpoint(root, "v1");
    writeFileSync(join(root, "a.txt"), "line1\nCHANGED\nline3\n");
    const c2 = createManualCheckpoint(root, "v2");
    const cmp = compareCheckpoints(root, c1.id, c2.id);
    expect(cmp.a.id).toBe(c1.id);
    expect(cmp.b.id).toBe(c2.id);
    expect(cmp.diffs.length).toBe(1);
    const d = cmp.diffs[0]!;
    expect(d.path).toBe("a.txt");
    expect(d.status).toBe("modified");
    expect(d.diff).toContain("-line2");
    expect(d.diff).toContain("+CHANGED");
  });

  it("reports added and removed files", () => {
    const c1 = createManualCheckpoint(root, "v1");
    rmSync(join(root, "b.txt"));
    writeFileSync(join(root, "new.txt"), "brand new\n");
    const c2 = createManualCheckpoint(root, "v2");
    const cmp = compareCheckpoints(root, c1.id, c2.id);
    const byPath = new Map(cmp.diffs.map((d) => [d.path, d]));
    expect(byPath.get("b.txt")!.status).toBe("removed");
    expect(byPath.get("new.txt")!.status).toBe("added");
    expect(byPath.get("new.txt")!.diff).toContain("+brand new");
  });

  it("throws NO_CHECKPOINT for unknown ids", () => {
    const c1 = createManualCheckpoint(root, "v1");
    expect(() => compareCheckpoints(root, c1.id, "cp-deadbeefdeadbeef12")).toThrowError(ToolError);
  });
});

describe("restoreCheckpointFile", () => {
  it("reverts only the requested file", () => {
    const cp = createManualCheckpoint(root, "v1");
    writeFileSync(join(root, "a.txt"), "CHANGED A\n");
    writeFileSync(join(root, "b.txt"), "CHANGED B\n");
    const out = restoreCheckpointFile(root, cp.id, "a.txt");
    expect(out.reverted).toBe(true);
    expect(read("a.txt")).toBe("line1\nline2\nline3\n");
    expect(read("b.txt")).toBe("CHANGED B\n");
  });

  it("deletes files that did not exist at snapshot time", () => {
    // Explicit absent-path snapshot (the agent's lazy-checkpoint pattern).
    snapshotFiles(root, "run-with-ghost", ["ghost.txt"]);
    writeFileSync(join(root, "ghost.txt"), "late\n");
    const out = restoreCheckpointFile(root, "run-with-ghost", "ghost.txt");
    expect(out.deleted).toBe(true);
    expect(() => read("ghost.txt")).toThrow();
  });

  it("rejects paths outside the checkpoint", () => {
    const cp = createManualCheckpoint(root, "v1");
    expect(() => restoreCheckpointFile(root, cp.id, "../escape.txt")).toThrowError(ToolError);
    expect(() => restoreCheckpointFile(root, cp.id, "nope.txt")).toThrowError(ToolError);
  });
});

describe("applyPatch no-partial-apply guarantee", () => {
  it("applies nothing when a later hunk mismatches", () => {
    mkdirSync(join(root, "sub"), { recursive: true });
    const p = "sub/f.txt";
    const original = "one\ntwo\nthree\nfour\nfive\nsix\n";
    writeFileSync(join(root, p), original);
    const diff = [
      "--- a/sub/f.txt",
      "+++ b/sub/f.txt",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+TWO",
      "@@ -5,2 +5,2 @@",
      " five",
      "-six",
      "+SIX-CHANGED-EXPECTATION",
    ].join("\n");
    // Corrupt the file so the SECOND hunk mismatches (first still matches).
    writeFileSync(join(root, p), "one\ntwo\nthree\nfour\nfive\nSIX-DIFFERENT\n");
    let code = "";
    try {
      applyPatch(root, p, diff);
    } catch (e) {
      code = e instanceof ToolError ? e.code : String(e);
    }
    expect(code).toBe("PATCH_MISMATCH");
    // Nothing was applied — not even the matching first hunk.
    expect(read(p)).toBe("one\ntwo\nthree\nfour\nfive\nSIX-DIFFERENT\n");
  });
});

/* ------------------------------------------------------------------ */
/* HTTP API (real server via startServer)                               */
/* ------------------------------------------------------------------ */

import { startServer, resetCheckpointRateLimit } from "../src/server/server";

describe("checkpoint HTTP API", () => {
  it("full lifecycle over HTTP", async () => {
    const ws = mkdtempSync(join(tmpdir(), "neutron-cp-http-"));
    const repoDir = join(ws, "myrepo");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "app.txt"), "v1\n");
    const running = await startServer({ root: ws, demoWorkspace: ws, port: 0, host: "127.0.0.1" });
    try {
      const base = `http://127.0.0.1:${running.port}`;
      const post = (p: string, body: unknown) =>
        fetch(base + p, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => r.json() as Promise<any>);
      const get = (p: string) => fetch(base + p).then((r) => r.json() as Promise<any>);

      // Unknown repo → honest 400.
      expect((await get("/api/checkpoints?repo=nope")).ok).toBe(false);

      const c1 = await post("/api/checkpoints", { repo: "myrepo", label: "baseline" });
      expect(c1.ok).toBe(true);
      expect(c1.checkpoint.id).toMatch(/^cp-/);

      const listed = await get("/api/checkpoints?repo=myrepo");
      expect(listed.ok).toBe(true);
      expect(listed.checkpoints).toHaveLength(1);

      const detail = await get(`/api/checkpoints/${c1.checkpoint.id}?repo=myrepo`);
      expect(detail.checkpoint.files.map((f: any) => f.path)).toContain("app.txt");

      writeFileSync(join(repoDir, "app.txt"), "v2\n");
      const c2 = await post("/api/checkpoints", { repo: "myrepo", label: "second" });
      expect(c2.ok).toBe(true);

      const cmp = await get(`/api/checkpoints/${c1.checkpoint.id}/compare/${c2.checkpoint.id}?repo=myrepo`);
      expect(cmp.ok).toBe(true);
      expect(cmp.diffs).toHaveLength(1);
      expect(cmp.diffs[0].diff).toContain("-v1");
      expect(cmp.diffs[0].diff).toContain("+v2");

      // Per-file revert.
      const rf = await post(`/api/checkpoints/${c2.checkpoint.id}/restore-file`, { repo: "myrepo", path: "app.txt" });
      expect(rf.ok).toBe(true);
      expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("v2\n"); // c2 holds v2

      writeFileSync(join(repoDir, "app.txt"), "v3\n");
      const rf2 = await post(`/api/checkpoints/${c1.checkpoint.id}/restore-file`, { repo: "myrepo", path: "app.txt" });
      expect(rf2.ok).toBe(true);
      expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("v1\n");

      // Safe restore creates a pre-restore checkpoint.
      writeFileSync(join(repoDir, "app.txt"), "v3\n");
      const rs = await post(`/api/checkpoints/${c1.checkpoint.id}/restore`, { repo: "myrepo" });
      expect(rs.ok).toBe(true);
      expect(rs.preRestoreId).toMatch(/^cp-/);
      expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("v1\n");
      const listed2 = await get("/api/checkpoints?repo=myrepo");
      expect(listed2.checkpoints.some((c: any) => c.id === rs.preRestoreId)).toBe(true);

      // Delete.
      const del = await fetch(base + `/api/checkpoints/${c2.checkpoint.id}?repo=myrepo`, { method: "DELETE" })
        .then((r) => r.json() as Promise<any>);
      expect(del.ok).toBe(true);
      expect((await get(`/api/checkpoints/${c2.checkpoint.id}?repo=myrepo`)).ok).toBe(false);

      // Traversal-style id → 400, not a filesystem escape.
      expect((await get("/api/checkpoints/..%2F..%2Fx?repo=myrepo")).ok).toBe(false);
    } finally {
      await running.close();
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rate-limits checkpoint endpoints per IP", async () => {
    resetCheckpointRateLimit();
    const ws = mkdtempSync(join(tmpdir(), "neutron-cp-rl-"));
    const repoDir = join(ws, "myrepo");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "f.txt"), "x\n");
    const running = await startServer({ root: ws, demoWorkspace: ws, port: 0, host: "127.0.0.1" });
    try {
      const base = `http://127.0.0.1:${running.port}`;
      let lastStatus = 0;
      for (let i = 0; i < 65; i++) {
        const r = await fetch(base + "/api/checkpoints?repo=myrepo");
        lastStatus = r.status;
        await r.json();
      }
      expect(lastStatus).toBe(429);
    } finally {
      resetCheckpointRateLimit();
      await running.close();
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
