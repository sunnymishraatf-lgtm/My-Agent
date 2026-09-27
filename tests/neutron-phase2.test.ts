import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Phase 2 reliability fixes: bounded parallelism, per-task timeout, QA test
// command, approval decision persistence, change-list persistence.

const { seenCommands } = vi.hoisted(() => ({ seenCommands: [] as string[] }));

vi.mock("../src/terminal/terminal", () => {
  class FakeTerminal {
    constructor(_opts?: unknown) {}
    async run(cmd: string) {
      seenCommands.push(cmd);
      return {
        status: "ok" as const,
        stdout: "Test Files  1 passed (1)\nTests  5 passed (5)\n",
        stderr: "",
        exitCode: 0,
      };
    }
  }
  return { Terminal: FakeTerminal };
});

import { resolveMaxParallel, boundedChunks, detectFileChanges, implementPlan, DEFAULT_MAX_PARALLEL } from "../src/neutron/agents";
import {
  Orchestrator,
  resolveTaskTimeoutMs,
  withTimeout,
  TaskTimeoutError,
  DEFAULT_TASK_TIMEOUT_MS,
} from "../src/orchestrator/orchestrator";
import type { Agent, AgentResult, ReviewResult } from "../src/agents/agent";
import { freshTask } from "../src/scheduler/task";
import { QAAgent } from "../src/agents/qa";
import { Approver } from "../src/approval/approver";
import { RunRecorder, RunArchive } from "../src/neutron/record";
import { runFullWorkflow } from "../src/neutron/workflow";
import type { NeutronTask } from "../src/neutron/model";

let root: string;
let savedMaxParallel: string | undefined;
let savedTaskTimeout: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-phase2-"));
  savedMaxParallel = process.env.NEUTRON_MAX_PARALLEL;
  savedTaskTimeout = process.env.NEUTRON_TASK_TIMEOUT_MS;
  delete process.env.NEUTRON_MAX_PARALLEL;
  delete process.env.NEUTRON_TASK_TIMEOUT_MS;
  seenCommands.length = 0;
});

afterEach(() => {
  if (savedMaxParallel === undefined) delete process.env.NEUTRON_MAX_PARALLEL;
  else process.env.NEUTRON_MAX_PARALLEL = savedMaxParallel;
  if (savedTaskTimeout === undefined) delete process.env.NEUTRON_TASK_TIMEOUT_MS;
  else process.env.NEUTRON_TASK_TIMEOUT_MS = savedTaskTimeout;
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("bounded parallelism", () => {
  it("defaults to 4", () => {
    expect(resolveMaxParallel()).toBe(DEFAULT_MAX_PARALLEL);
    expect(DEFAULT_MAX_PARALLEL).toBe(4);
  });

  it("honours the NEUTRON_MAX_PARALLEL env var", () => {
    process.env.NEUTRON_MAX_PARALLEL = "2";
    expect(resolveMaxParallel()).toBe(2);
  });

  it("explicit option beats the env var", () => {
    process.env.NEUTRON_MAX_PARALLEL = "2";
    expect(resolveMaxParallel(7)).toBe(7);
  });

  it("falls back to the default on invalid values", () => {
    for (const bad of ["abc", "0", "-3", "2.5", ""]) {
      process.env.NEUTRON_MAX_PARALLEL = bad;
      expect(resolveMaxParallel()).toBe(DEFAULT_MAX_PARALLEL);
    }
    expect(resolveMaxParallel(0)).toBe(DEFAULT_MAX_PARALLEL);
    expect(resolveMaxParallel(-1)).toBe(DEFAULT_MAX_PARALLEL);
    expect(resolveMaxParallel(NaN)).toBe(DEFAULT_MAX_PARALLEL);
  });

  it("boundedChunks splits into chunks of at most cap, preserving order", () => {
    expect(boundedChunks([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
    expect(boundedChunks([1, 2], 5)).toEqual([[1, 2]]);
    expect(boundedChunks([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    expect(boundedChunks([1, 2], 0)).toEqual([[1], [2]]);
    expect(boundedChunks([], 4)).toEqual([]);
  });

  it("chunked execution never exceeds the cap in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = [1, 2, 3, 4, 5, 6, 7];
    for (const chunk of boundedChunks(tasks, 3)) {
      await Promise.all(
        chunk.map(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        }),
      );
    }
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBe(3);
  });
});

function fakeAgent(id: string, overrides: Partial<Pick<Agent, "execute" | "review">> = {}): Agent {
  return {
    id,
    role: "qa",
    label: id,
    canHandle: (task) => task.agent === id,
    execute: async (task): Promise<AgentResult> => ({
      status: "success",
      summary: `${id} did ${task.id}`,
      filesChanged: [],
      commandsRun: [],
      testsRun: [],
      issues: [],
      nextActions: [],
    }),
    review: async (): Promise<ReviewResult> => ({ passed: true, score: 100, issues: [], notes: [] }),
    ...overrides,
  };
}

describe("per-task timeout", () => {
  it("defaults to 10 minutes", () => {
    expect(resolveTaskTimeoutMs()).toBe(DEFAULT_TASK_TIMEOUT_MS);
    expect(DEFAULT_TASK_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it("honours config option, then NEUTRON_TASK_TIMEOUT_MS env var", () => {
    process.env.NEUTRON_TASK_TIMEOUT_MS = "30000";
    expect(resolveTaskTimeoutMs()).toBe(30000);
    expect(resolveTaskTimeoutMs(5000)).toBe(5000);
  });

  it("falls back to the default on invalid values", () => {
    process.env.NEUTRON_TASK_TIMEOUT_MS = "nope";
    expect(resolveTaskTimeoutMs()).toBe(DEFAULT_TASK_TIMEOUT_MS);
    expect(resolveTaskTimeoutMs(-10)).toBe(DEFAULT_TASK_TIMEOUT_MS);
  });

  it("withTimeout resolves fast promises", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "T-1")).resolves.toBe(42);
  });

  it("withTimeout rejects slow promises with TaskTimeoutError", async () => {
    const slow = new Promise<number>(() => {});
    await expect(withTimeout(slow, 30, "T-9")).rejects.toBeInstanceOf(TaskTimeoutError);
    await expect(withTimeout(slow, 30, "T-9")).rejects.toThrow(/T-9.*timed out/);
  });

  it("marks a timed-out task failed (not blocked) with a clear timeout error", async () => {
    const hanging = fakeAgent("qa", {
      execute: () => new Promise<AgentResult>(() => {}), // never settles
    });
    const orch = new Orchestrator({
      root,
      agents: [hanging],
      config: { maxConcurrentRequests: 1, maxIterations: 1, taskTimeoutMs: 60 },
      log: () => {},
    });
    const tasks = [freshTask({ id: "T-1", agent: "qa", description: "hang forever" })];
    await orch.runBatch(tasks);

    expect(tasks[0]!.status).toBe("failed");
    expect(tasks[0]!.status).not.toBe("blocked");
    expect(tasks[0]!.result?.summary).toMatch(/timed out/);
    expect(tasks[0]!.result?.issues[0]?.category).toBe("timeout");
    expect(tasks[0]!.result?.status).toBe("failed");
  });

  it("preserves failed-dependency semantics: a task whose dep failed is not run (and not marked failed by the timeout)", async () => {
    const flaky = fakeAgent("qa", {
      execute: async (task): Promise<AgentResult> =>
        task.id === "T-A"
          ? { status: "failed", summary: "boom", filesChanged: [], commandsRun: [], testsRun: [], issues: [], nextActions: [] }
          : { status: "success", summary: "ok", filesChanged: [], commandsRun: [], testsRun: [], issues: [], nextActions: [] },
    });
    const orch = new Orchestrator({
      root,
      agents: [flaky],
      config: { maxConcurrentRequests: 1, maxIterations: 1, taskTimeoutMs: 60000 },
      log: () => {},
    });
    const tasks = [
      freshTask({ id: "T-A", agent: "qa", description: "fails" }),
      freshTask({ id: "T-B", agent: "qa", description: "depends on failed", dependencies: ["T-A"] }),
    ];
    await orch.runBatch(tasks);
    expect(tasks[0]!.status).toBe("failed");
    // runBatch leaves T-B pending; the execute() loop marks it blocked later.
    expect(tasks[1]!.status).toBe("pending");
  });

  it("a timed-out review does not fail the task", async () => {
    const slowReview = fakeAgent("qa", {
      review: () => new Promise<ReviewResult>(() => {}), // review hangs
    });
    const orch = new Orchestrator({
      root,
      agents: [slowReview],
      config: { maxConcurrentRequests: 1, maxIterations: 1, taskTimeoutMs: 60 },
      log: () => {},
    });
    const tasks = [freshTask({ id: "T-3", agent: "qa", description: "ok task, slow review" })];
    const { completed } = await orch.runBatch(tasks);
    expect(tasks[0]!.status).toBe("completed");
    expect(completed).toBe(1);
  });
});

describe("QA agent test command", () => {
  function qaContext() {
    return {
      root,
      api: undefined as never,
      log: () => {},
      run: async () => ({ status: "ok" as const, stdout: "", stderr: "", exitCode: 0 }),
      readFile: () => undefined,
      writeFile: () => false,
      listDir: () => ["package.json", "vitest.config.ts"],
      getApproval: async () => false,
    };
  }

  it("uses the suggested vitest command instead of hardcoded npm test", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "qa-vitest", scripts: {} }), "utf8");
    writeFileSync(join(root, "vitest.config.ts"), "export default {};\n", "utf8");
    mkdirSync(join(root, "node_modules"), { recursive: true });

    const agent = new QAAgent();
    const task = freshTask({ id: "QA-1", agent: "qa", description: "run tests" });
    const result = await agent.execute(task, qaContext());

    expect(seenCommands).toContain("npx vitest run --concurrency 1");
    expect(seenCommands.some((c) => c === "npm test -- --run")).toBe(false);
    expect(result.commandsRun).toContain("npx vitest run --concurrency 1");
    expect(result.status).toBe("success");
  });

  it("falls back to npm test when no smarter command is suggested", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "qa-npm" }), "utf8");
    mkdirSync(join(root, "node_modules"), { recursive: true });

    const agent = new QAAgent();
    const task = freshTask({ id: "QA-2", agent: "qa", description: "run tests" });
    const ctx = { ...qaContext(), listDir: () => ["package.json"] };
    const result = await agent.execute(task, ctx);

    expect(seenCommands).toContain("npm test -- --run");
    expect(result.status).toBe("success");
  });

  it("still reports honestly when the test run is blocked", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "qa-blocked" }), "utf8");
    // no node_modules -> blocked

    const agent = new QAAgent();
    const task = freshTask({ id: "QA-3", agent: "qa", description: "run tests" });
    const ctx = { ...qaContext(), listDir: () => ["package.json"] };
    const result = await agent.execute(task, ctx);

    expect(result.status).toBe("blocked");
    expect(seenCommands).toHaveLength(0);
  });
});

describe("approval decision persistence", () => {
  it("recordApproval persists timestamp, decision, title and source", () => {
    const recorder = new RunRecorder(root, { id: "run-approval" });
    recorder.recordApproval({ approved: true, title: "NEUTRON Implementation Plan Approval", source: "interactive", reason: "looks good" });

    const rec = recorder.get();
    expect(rec.approvals).toHaveLength(1);
    const d = rec.approvals[0]!;
    expect(d.approved).toBe(true);
    expect(d.title).toBe("NEUTRON Implementation Plan Approval");
    expect(d.source).toBe("interactive");
    expect(d.reason).toBe("looks good");
    expect(typeof d.ts).toBe("string");
    expect(new Date(d.ts).getTime()).not.toBeNaN();
    expect(rec.metrics.humanApprovals).toBe(1);

    const auditEvent = rec.events.find((e) => e.action === "approval decision");
    expect(auditEvent).toBeDefined();
    expect(auditEvent!.detail).toMatch(/APPROVED/);
    expect(auditEvent!.detail).toMatch(/source=interactive/);
    expect(auditEvent!.detail).toMatch(/NEUTRON Implementation Plan Approval/);
  });

  it("recordApproval persists denials without incrementing the approval counter", () => {
    const recorder = new RunRecorder(root, { id: "run-denial" });
    recorder.recordApproval({ approved: false, title: "NEUTRON Implementation Plan Approval", source: "non-tty", reason: "non-interactive" });

    const rec = recorder.get();
    expect(rec.approvals).toHaveLength(1);
    expect(rec.approvals[0]!.approved).toBe(false);
    expect(rec.approvals[0]!.source).toBe("non-tty");
    expect(rec.metrics.humanApprovals).toBe(0);
    const auditEvent = rec.events.find((e) => e.action === "approval decision");
    expect(auditEvent!.detail).toMatch(/DENIED/);
  });

  it("Approver.askWithSource reports -y for auto-approve", async () => {
    const approver = new Approver({ autoApprove: true, print: () => {} });
    const decision = await approver.askWithSource({
      message: "m",
      reason: "destructive",
      onApprove: async () => {},
      onDeny: async () => {},
    });
    expect(decision).toEqual({ approved: true, source: "-y" });
  });

  it("runFullWorkflow persists the full decision on denial", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "wf-test" }), "utf8");
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

    const record = new RunArchive(root).load(result.runId!);
    expect(record).toBeDefined();
    expect(record!.status).toBe("plan-denied");
    expect(record!.approvals).toHaveLength(1);
    expect(record!.approvals[0]!.approved).toBe(false);
    expect(record!.approvals[0]!.title).toBe("NEUTRON Implementation Plan Approval");
    expect(typeof record!.approvals[0]!.ts).toBe("string");
    expect(record!.events.some((e) => e.action === "approval decision" && /DENIED/.test(e.detail ?? ""))).toBe(true);
  });

  it("runFullWorkflow persists the full decision on approval (plan-only)", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "wf-test" }), "utf8");
    const result = await runFullWorkflow({
      root,
      autoApprove: false,
      invokeApproval: async () => ({ approved: true, source: "interactive" as const, reason: "yes" }),
      request: {
        request: "add a widget",
        repository: "wf-test",
        branch: "main",
        riskTolerance: "safe",
        execution: "plan-only",
      },
    });

    const record = new RunArchive(root).load(result.runId!);
    expect(record).toBeDefined();
    expect(record!.status).toBe("planned");
    expect(record!.approvals).toHaveLength(1);
    expect(record!.approvals[0]).toMatchObject({
      approved: true,
      source: "interactive",
      title: "NEUTRON Implementation Plan Approval",
      reason: "yes",
    });
    expect(record!.metrics.humanApprovals).toBe(1);
  });
});

describe("change-list persistence", () => {
  const task: NeutronTask = {
    id: "T-1",
    label: "update config",
    agent: "backend",
    files: ["a.ts"],
    dependencies: [],
    risk: "low",
    reason: "test",
    status: "pending",
  };

  it("setChanges persists the per-file change list and the count", () => {
    const recorder = new RunRecorder(root, { id: "run-changes" });
    const changes = detectFileChanges(root, [task], [
      { path: "a.ts", before: "const x = 1;\n", after: "const x = 2;\n" },
      { path: "b.ts", before: undefined, after: "new file\n" },
    ]);
    recorder.setChanges(changes);

    const rec = recorder.get();
    expect(rec.changeCount).toBe(2);
    expect(rec.changes).toHaveLength(2);
    expect(rec.changes[0]).toMatchObject({ path: "a.ts", kind: "modified" });
    expect(rec.changes[1]).toMatchObject({ path: "b.ts", kind: "added" });

    recorder.save();
    const loaded = new RunArchive(root).load("run-changes");
    expect(loaded).toBeDefined();
    expect(loaded!.changeCount).toBe(2);
    expect(loaded!.changes.map((c) => c.path).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("implementPlan persists the change list into the run record", async () => {
    const recorder = new RunRecorder(root, { id: "run-impl" });
    const spy = vi.spyOn(recorder, "setChanges");
    // No providers configured in the test env -> no-LLM path (no fabricated changes).
    const outcome = await implementPlan({ root, log: () => {}, recorder }, [task]);
    expect(outcome.noLlm).toBe(true);
    expect(spy).toHaveBeenCalledWith([]);
    expect(recorder.get().changeCount).toBe(0);
    expect(recorder.get().changes).toEqual([]);
  });
});
