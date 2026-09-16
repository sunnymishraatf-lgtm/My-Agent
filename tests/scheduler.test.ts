import { describe, it, expect } from "vitest";
import { TaskScheduler } from "../src/scheduler/scheduler";
import { freshTask, type Task } from "../src/scheduler/task";

function make(id: string, deps: string[], priority: Task["priority"] = "medium", status: Task["status"] = "pending"): Task {
  return freshTask({ id, agent: "frontend", description: id, dependencies: deps, priority, status });
}

describe("TaskScheduler", () => {
  it("only exposes tasks whose dependencies are satisfied", () => {
    const a = make("A", []);
    const b = make("B", ["A"]);
    const sch = new TaskScheduler({ maxConcurrent: 2 });
    sch.setTasks([a, b]);
    const ready = sch.readyTasks();
    expect(ready.map((t) => t.id)).toEqual(["A"]);
  });

  it("respects maxConcurrent", () => {
    const tasks = [make("A", []), make("B", []), make("C", [])];
    const sch = new TaskScheduler({ maxConcurrent: 2 });
    sch.setTasks(tasks);
    const first = sch.next();
    expect(first?.id).toBeDefined();
    sch.claim(first!.id);
    const second = sch.next();
    sch.claim(second!.id);
    expect(sch.next()).toBeUndefined();
  });

  it("completes a dependency chain", () => {
    const a = make("A", []);
    const b = make("B", ["A"]);
    const sch = new TaskScheduler({ maxConcurrent: 1 });
    sch.setTasks([a, b]);
    let next = sch.next();
    sch.claim(next!.id);
    sch.markDone(a);
    next = sch.next();
    expect(next?.id).toBe("B");
    sch.claim(next!.id);
    sch.markDone(b);
    expect(sch.isComplete()).toBe(true);
  });

  it("detects failed dependencies", () => {
    const a = make("A", []);
    const b = make("B", ["A"]);
    const sch = new TaskScheduler({ maxConcurrent: 1 });
    sch.setTasks([a, b]);
    sch.claim(a.id);
    sch.markFailed(a, "nope");
    expect(sch.next()?.id).toBe("B");
  });
});