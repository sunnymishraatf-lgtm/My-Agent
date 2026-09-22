import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/store";
import { freshTask } from "../src/scheduler/task";
import { Orchestrator, createFallbackTasks } from "../src/orchestrator/orchestrator";
import { parseDesignSystem } from "../src/design/parser";
import type { Agent, AgentContext, AgentResult, ReviewResult } from "../src/agents/agent";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neutron-test-"));
});

describe("StateStore", () => {
  it("persists and reloads tasks and meta", () => {
    const store = new StateStore(dir);
    store.ensure();
    const task = freshTask({ id: "T-001", agent: "qa", description: "run tests" });
    store.setTasks([task]);
    store.setMeta({ name: "demo", status: "running" });

    const reloaded = new StateStore(dir);
    expect(reloaded.getTasks()).toHaveLength(1);
    expect(reloaded.getTasks()[0]?.id).toBe("T-001");
    expect(reloaded.getMeta().name).toBe("demo");
    expect(reloaded.getMeta().status).toBe("running");
  });

  it("stores and reloads review markdown", () => {
    const store = new StateStore(dir);
    store.setReview("# Review\n\nAll good");
    expect(new StateStore(dir).getReview()).toContain("All good");
  });
});

function fakeAgent(id: string, behavior: (task: string) => Partial<AgentResult>): Agent {
  return {
    id,
    role: "qa",
    label: id,
    canHandle: (task) => task.agent === id,
    execute: async (task) => ({
      status: "success",
      summary: `${id} did ${task.id}`,
      filesChanged: [],
      commandsRun: [],
      testsRun: [],
      issues: [],
      nextActions: [],
      ...behavior(task.id),
    }),
    review: async (): Promise<ReviewResult> => ({ passed: true, score: 100, issues: [], notes: [] }),
  };
}

describe("Orchestrator", () => {
  it("creates fallback tasks with unique ids", () => {
    const design = parseDesignSystem("# Design\n\n## Colors\n\n### Primary\n\n#000000\n");
    const tasks = createFallbackTasks(design);
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respects dependencies and runs independent tasks", async () => {
    const order: string[] = [];
    const recorder = (id: string): Agent =>
      ({
        id,
        role: "qa",
        label: id,
        canHandle: (t) => t.agent === id,
        execute: async (task) => {
          order.push(task.id);
          return {
            status: "success",
            summary: `${id} did ${task.id}`,
            filesChanged: [],
            commandsRun: [],
            testsRun: [],
            issues: [],
            nextActions: [],
          };
        },
        review: async (): Promise<ReviewResult> => ({ passed: true, score: 100, issues: [], notes: [] }),
      }) as Agent;

    const t1 = freshTask({ id: "T1", agent: "a", description: "first" });
    const t2 = freshTask({ id: "T2", agent: "b", description: "second", dependencies: ["T1"] });
    const t3 = freshTask({ id: "T3", agent: "c", description: "third", dependencies: ["T2"] });

    const orch = new Orchestrator({
      root: dir,
      agents: [recorder("a"), recorder("b"), recorder("c")],
      config: { maxConcurrentRequests: 2, maxIterations: 3 },
      log: () => {},
    });
    const summary = await orch.execute([t1, t2, t3]);
    expect(order).toEqual(["T1", "T2", "T3"]);
    expect(summary.ok).toBe(true);
    expect(summary.tasksCompleted).toBe(3);
  });

  it("isolates agent crashes instead of failing the whole run", async () => {
    const crasher: Agent = {
      id: "crasher",
      role: "backend",
      label: "Crasher",
      canHandle: (t) => t.agent === "crasher",
      execute: async () => {
        throw new Error("kaboom");
      },
      review: async () => ({ passed: true, score: 100, issues: [], notes: [] }),
    };
    const healthy = fakeAgent("healthy", () => ({}));
    const t1 = freshTask({ id: "T1", agent: "crasher", description: "will crash" });
    const t2 = freshTask({ id: "T2", agent: "healthy", description: "fine" });

    const orch = new Orchestrator({
      root: dir,
      agents: [crasher, healthy],
      config: { maxConcurrentRequests: 2, maxIterations: 1 },
      log: () => {},
    });
    const summary = await orch.execute([t1, t2]);
    expect(t1.status).toBe("failed");
    expect(t2.status).toBe("completed");
    expect(summary.ok).toBe(false);
    expect(summary.issues.some((i) => i.title.includes("kaboom"))).toBe(true);
  });

  it("blocks dependents of failed tasks instead of looping forever", async () => {
    const failer = fakeAgent("failer", () => ({
      status: "failed",
      issues: [{ severity: "high", category: "test", title: "broken" }],
    }));
    const never = fakeAgent("never", () => ({}));
    const t1 = freshTask({ id: "T1", agent: "failer", description: "fails" });
    const t2 = freshTask({ id: "T2", agent: "never", description: "depends on T1", dependencies: ["T1"] });

    const orch = new Orchestrator({
      root: dir,
      agents: [failer, never],
      config: { maxConcurrentRequests: 2, maxIterations: 5 },
      log: () => {},
    });
    const summary = await orch.execute([t1, t2]);
    expect(t1.status).toBe("failed");
    expect(t2.status).toBe("blocked");
    expect(summary.iterations).toBeLessThan(5);
  });

  it("does not claim success when resuming a run with failed tasks", async () => {
    const failer = fakeAgent("failer", () => ({
      status: "failed",
      issues: [{ severity: "high", category: "test", title: "broken" }],
    }));
    const t1 = freshTask({ id: "T1", agent: "failer", description: "fails" });
    t1.status = "failed";
    t1.retries = 2;

    const orch = new Orchestrator({
      root: dir,
      agents: [failer],
      config: { maxConcurrentRequests: 1, maxIterations: 3 },
      log: () => {},
    });
    const summary = await orch.execute([t1], { resume: true });
    expect(summary.ok).toBe(false);
    expect(summary.tasksCompleted).toBe(0);
  });

  it("marks review-rejected tasks as failed", async () => {
    const agent: Agent = {
      id: "picky",
      role: "design",
      label: "Picky",
      canHandle: (t) => t.agent === "picky",
      execute: async () => ({
        status: "success",
        summary: "done",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: [],
      }),
      review: async () => ({
        passed: false,
        score: 40,
        issues: [{ severity: "high", category: "design", title: "does not match design.md" }],
        notes: ["colors off"],
      }),
    };
    const t1 = freshTask({ id: "T1", agent: "picky", description: "work" });
    const orch = new Orchestrator({
      root: dir,
      agents: [agent],
      config: { maxConcurrentRequests: 1, maxIterations: 1 },
      log: () => {},
    });
    await orch.execute([t1]);
    expect(t1.status).toBe("failed");
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});