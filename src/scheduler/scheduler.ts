import type { Task, TaskStatus } from "./task";
import { isTaskFinished } from "./task";

export interface SchedulerOptions {
  maxConcurrent?: number;
  onTaskComplete?: (task: Task) => void;
}

export interface ReadyTask {
  taskId: string;
}

export class TaskScheduler {
  private tasks: Map<string, Task> = new Map();
  private running = 0;
  private queue: string[] = [];
  private maxConcurrent: number;
  private doneSet = new Set<string>();
  private listeners: Array<() => void> = [];

  constructor(opts: SchedulerOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 1;
  }

  setTasks(tasks: Task[]): void {
    this.tasks = new Map(tasks.map((t) => [t.id, t]));
  }

  addTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  allTasks(): Task[] {
    return [...this.tasks.values()];
  }

  reset(): void {
    this.doneSet.clear();
    this.running = 0;
    this.queue = [];
    for (const t of this.tasks.values()) {
      if (t.status === "running" || t.status === "queued") {
        t.status = "pending";
      }
    }
  }

  onIdle(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emitIdle(): void {
    if (this.running === 0 && this.queue.length === 0) {
      for (const l of this.listeners) l();
    }
  }

  readyTasks(): Task[] {
    const result: Task[] = [];
    for (const t of this.tasks.values()) {
      if (t.status !== "pending") continue;
      const depsDone = t.dependencies.every((d) => {
        const dep = this.tasks.get(d);
        // A missing dependency is not something we can wait for; treat it as
        // satisfied so the task does not deadlock the scheduler.
        if (!dep) return true;
        // Any terminal state releases dependents — not just success.
        return this.doneSet.has(d) || isTaskFinished(dep.status);
      });
      if (depsDone) result.push(t);
    }
    return result;
  }

  next(): Task | undefined {
    if (this.running >= this.maxConcurrent) return undefined;
    const ready = this.readyTasks();
    if (ready.length === 0) return undefined;
    // Highest priority first.
    ready.sort((a, b) => prio(b) - prio(a));
    return ready[0];
  }

  claim(taskId: string): boolean {
    const t = this.tasks.get(taskId);
    if (!t) return false;
    if (t.status !== "pending") return false;
    t.status = "running";
    this.running++;
    return true;
  }

  release(task: Task): void {
    this.running = Math.max(0, this.running - 1);
    this.doneSet.add(task.id);
  }

  markDone(task: Task): void {
    task.status = "completed";
    task.updatedAt = new Date().toISOString();
    this.release(task);
    this.emitIdle();
  }

  markFailed(task: Task, reason: string): void {
    task.status = "failed";
    task.updatedAt = new Date().toISOString();
    task.metadata ??= {};
    task.metadata["error"] = reason;
    this.release(task);
    this.emitIdle();
  }

  isComplete(): boolean {
    for (const t of this.tasks.values()) {
      if (t.status === "pending" || t.status === "queued" || t.status === "running" || t.status === "ready") {
        return false;
      }
    }
    const allDone = [...this.tasks.values()].every((t) => this.doneSet.has(t.id));
    return allDone;
  }

  hasFailed(): boolean {
    return [...this.tasks.values()].some((t) => t.status === "failed" || t.status === "blocked");
  }
}

function prio(t: Task): number {
  const p: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return p[t.priority] ?? 2;
}