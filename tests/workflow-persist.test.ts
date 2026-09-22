import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecorder, RunArchive } from "../src/neutron/record";
import { runFullWorkflow } from "../src/neutron/workflow";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-workflow-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "wf-test" }), "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("RunRecorder.save", () => {
  it("persists the record so it can be loaded from the archive", () => {
    const recorder = new RunRecorder(root, { id: "run-abc", request: "do things" });
    recorder.stage("repository-analysis", "done");
    recorder.setStatus("planned");
    recorder.save();

    const loaded = new RunArchive(root).load("run-abc");
    expect(loaded).toBeDefined();
    expect(loaded!.request).toBe("do things");
    expect(loaded!.status).toBe("planned");
    expect(loaded!.stages.map((s) => `${s.name}:${s.status}`)).toEqual(["repository-analysis:done"]);
  });
});

describe("runFullWorkflow persistence", () => {
  it("denied plans return a runId and persist a plan-denied record", async () => {
    const result = await runFullWorkflow({
      root,
      autoApprove: false,
      invokeApproval: async () => ({ approved: false, reason: "no" }),
      request: {
        request: "add a widget",
        repository: "wf-test",
        branch: "main",
        riskTolerance: "safe",
        execution: "plan-only",
      },
    });

    expect(result.runId).toBeDefined();
    const record = new RunArchive(root).load(result.runId!);
    expect(record).toBeDefined();
    expect(record!.status).toBe("plan-denied");
    // Stages are marked done only after their step succeeded (correct timing).
    const stages = Object.fromEntries(record!.stages.map((s) => [s.name, s.status]));
    expect(stages["repository-analysis"]).toBe("done");
    expect(stages["impact-analysis"]).toBe("done");
    expect(stages["change-plan"]).toBe("done");
  });

  it("plan-only runs persist a planned record with a runId", async () => {
    const result = await runFullWorkflow({
      root,
      autoApprove: false,
      invokeApproval: async () => ({ approved: true }),
      request: {
        request: "add a widget",
        repository: "wf-test",
        branch: "main",
        riskTolerance: "safe",
        execution: "plan-only",
      },
    });

    expect(result.runId).toBeDefined();
    const record = new RunArchive(root).load(result.runId!);
    expect(record?.status).toBe("planned");
  });
});
