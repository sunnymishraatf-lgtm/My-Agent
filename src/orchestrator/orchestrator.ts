import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentContext, AgentResult } from "../agents/agent";
import type { Task, Issue } from "../scheduler/task";
import type { Agent } from "../agents/agent";
import { findAgentForTask } from "../agents/registry";
import { ManagerAgent } from "../agents/manager";
import { Terminal } from "../terminal/terminal";
import { Approver } from "../approval/approver";
import { StateStore } from "../store";
import { parseDesignSystem, toDesignSystemJson } from "../design/parser";
import type { DesignSystem } from "../design/design";
import { writeProjectFile, readProjectFile } from "../files/project-files";
import type { ApiSystem } from "../api/api-manager";

export interface OrchestratorOptions {
  root: string;
  agents: Agent[];
  config: {
    maxConcurrentRequests: number;
    maxIterations: number;
    autoApprove?: boolean;
    noGit?: boolean;
    /** Per-task execution timeout in ms. Defaults to 10 minutes (NEUTRON_TASK_TIMEOUT_MS). */
    taskTimeoutMs?: number;
  };
  run?: (cmd: string, opts?: { timeoutMs?: number }) => Promise<{ status: "ok" | "error"; stdout: string; stderr: string; exitCode: number }>;
  log?: (msg: string) => void;
  onTaskStatus?: (task: Task, agent: Agent) => void;
  store?: StateStore;
  api?: ApiSystem;
}

export interface PlanResult {
  ok: boolean;
  tasks: Task[];
  design?: DesignSystem;
  reasons: string[];
}

export interface RunSummary {
  ok: boolean;
  iterations: number;
  tasksCompleted: number;
  issues: Issue[];
}

/** Default per-task execution timeout: 10 minutes. */
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolve the per-task timeout: explicit option first, then the
 * NEUTRON_TASK_TIMEOUT_MS env var, then the default. Invalid values fall back
 * to the default; the resolved timeout is always a positive integer.
 */
export function resolveTaskTimeoutMs(explicit?: number): number {
  const envRaw = process.env.NEUTRON_TASK_TIMEOUT_MS;
  // Strict numeric parse: a fractional or non-numeric value is a misconfiguration
  // and must fall back to the default rather than being silently truncated.
  const envVal = envRaw !== undefined && envRaw.trim() !== "" ? Number(envRaw) : NaN;
  const candidate = explicit ?? (Number.isInteger(envVal) && envVal > 0 ? envVal : NaN);
  if (Number.isInteger(candidate) && candidate > 0) return candidate as number;
  return DEFAULT_TASK_TIMEOUT_MS;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export class TaskTimeoutError extends Error {
  readonly taskId: string;
  readonly timeoutMs: number;
  constructor(taskId: string, timeoutMs: number) {
    super(`Task ${taskId} timed out after ${formatDurationMs(timeoutMs)}`);
    this.name = "TaskTimeoutError";
    this.taskId = taskId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race a promise against a timeout. The underlying work is not cancellable, so
 * on timeout the task is marked failed while the attempt may still settle in
 * the background — its late result is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, taskId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TaskTimeoutError(taskId, ms)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class Orchestrator {
  readonly root: string;
  private agents: Agent[];
  private options: OrchestratorOptions;
  private store: StateStore;
  private api: ApiSystem | undefined;
  private log: (msg: string) => void;
  private terminate = false;

  constructor(opts: OrchestratorOptions) {
    this.root = opts.root;
    this.agents = opts.agents;
    this.options = opts;
    this.store = opts.store ?? new StateStore(opts.root);
    this.api = opts.api;
    this.log = opts.log ?? (() => {});
  }

  stop(): void {
    this.terminate = true;
  }

  private stopFlagged(): boolean {
    return existsSync(join(this.root, ".agent", "stop.flag"));
  }

  get design(): DesignSystem | undefined {
    const text = readProjectFile(this.root, "design.md");
    if (!text) return undefined;
    return parseDesignSystem(text);
  }

  get storedTasks(): Task[] {
    return this.store.getTasks();
  }

  async plan(): Promise<PlanResult> {
    const designText = readProjectFile(this.root, "design.md");
    const design = designText ? parseDesignSystem(designText) : undefined;
    const reasons: string[] = [];

    if (!designText) {
      reasons.push("design.md not found");
      return { ok: false, tasks: [], design, reasons };
    }

    const manager = this.agents.find((a) => a.id === "manager");
    if (manager instanceof ManagerAgent) {
      const ctx = this.buildContextFor(manager);
      const tasks = await manager.buildTaskGraph(ctx);
      return { ok: tasks.length > 0, tasks, design, reasons };
    }

    if (design) {
      const tasks = createFallbackTasks(design);
      return { ok: tasks.length > 0, tasks, design, reasons };
    }
    return { ok: false, tasks: [], design, reasons };
  }

  async execute(taskList?: Task[], opts?: { resume?: boolean }): Promise<RunSummary> {
    const tasks = taskList ?? (opts?.resume ? this.store.getTasks() : []);
    if (tasks.length === 0) {
      throw new Error("No tasks to run. Run `neutron plan` first or ensure design.md exists.");
    }

    for (const t of tasks) {
      if (t.status === "running" || t.status === "queued" || t.status === "ready") {
        t.status = "pending";
      }
    }

    const maxIterations = this.options.config.maxIterations;
    const allIssues: Issue[] = [];
    let iterations = 0;

    this.store.setTasks(tasks);
    this.store.setMeta({ status: "running" });

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      iterations = iteration + 1;
      if (this.terminate || this.stopFlagged()) {
        this.terminate = true;
        this.log("stopped by user");
        break;
      }

      const batch = await this.runBatch(tasks);
      allIssues.push(...batch.issues);

      this.store.setTasks(tasks);
      this.store.setMeta({ status: this.terminate ? "paused" : "running" });

      if (this.terminate) break;

      const pendingTasks = tasks.filter((t) => t.status === "pending");
      if (pendingTasks.length === 0) break;

      const retriable = tasks.filter((t) => t.status === "failed" && (t.retries ?? 0) < 2);
      if (retriable.length > 0) {
        for (const t of retriable) {
          t.status = "pending";
          t.retries = (t.retries ?? 0) + 1;
        }
        this.log(`iteration ${iterations}: retrying ${retriable.length} failed task(s)`);
        continue;
      }

      const anyRunnable = pendingTasks.some((t) =>
        t.dependencies.every((d) => {
          const dt = tasks.find((x) => x.id === d);
          return !dt || dt.status === "completed" || dt.status === "skipped";
        }),
      );
      if (!anyRunnable) {
        for (const t of pendingTasks) {
          t.status = "blocked";
          allIssues.push({
            severity: "medium",
            category: "scheduler",
            title: `Task ${t.id} blocked: dependencies not satisfiable`,
          });
        }
        this.log(`iteration ${iterations}: ${pendingTasks.length} task(s) blocked by failed dependencies`);
        this.store.setTasks(tasks);
        break;
      }
    }

    const finalIssues = allIssues.filter((i) => i.severity === "high" || i.severity === "critical");
    const failedTasks = tasks.filter((t) => t.status === "failed");
    const blockedTasks = tasks.filter((t) => t.status === "blocked");
    const ok = !this.terminate && finalIssues.length === 0 && failedTasks.length === 0 && blockedTasks.length === 0;
    this.store.setMeta({ status: this.terminate ? "paused" : ok ? "completed" : "failed" });
    if (!ok && failedTasks.length + blockedTasks.length > 0) {
      this.log(
        `${failedTasks.length} failed and ${blockedTasks.length} blocked task(s); run \`neutron fix\` then \`neutron run --resume\` to retry them.`,
      );
    }

    return {
      ok,
      iterations,
      tasksCompleted: tasks.filter((t) => t.status === "completed").length,
      issues: allIssues,
    };
  }

  async runBatch(tasks: Task[]): Promise<{ issues: Issue[]; completed: number }> {
    const issues: Issue[] = [];
    let completed = 0;

    const runnable: Task[] = [];
    for (const task of tasks) {
      if (this.terminate) break;
      if (task.status === "completed" || task.status === "skipped") {
        continue;
      }
      if (task.status === "failed" || task.status === "blocked") {
        continue;
      }
      const depsReady = task.dependencies.every((d) => {
        const dt = tasks.find((t) => t.id === d);
        return !dt || dt.status === "completed" || dt.status === "skipped";
      });
      if (!depsReady) continue;
      runnable.push(task);
    }

    for (const task of runnable) {
      if (this.terminate) break;

      const agent = findAgentForTask(this.agents, task);
      if (!agent) {
        task.status = "blocked";
        issues.push({ severity: "high", category: "scheduler", title: `No agent found for ${task.agent}` });
        continue;
      }

      task.status = "running";
      task.updatedAt = new Date().toISOString();
      this.options.onTaskStatus?.(task, agent);
      this.store.setTasks(tasks);
      const timeoutMs = resolveTaskTimeoutMs(this.options.config.taskTimeoutMs);

      try {
        const result = await withTimeout(agent.execute(task, this.buildContextFor(agent)), timeoutMs, task.id);
        task.result = result;
        task.status = result.status === "success" ? "completed" : result.status === "blocked" ? "blocked" : "failed";
        if (result.status === "success") {
          try {
            const review = await withTimeout(agent.review(result, this.buildContextFor(agent)), timeoutMs, task.id);
            if (!review.passed) {
              task.status = "failed";
              task.result = {
                ...result,
                status: "failed",
                issues: [...result.issues, ...review.issues],
                summary: review.notes.length > 0 ? `${result.summary}\nReview rejected: ${review.notes.join("; ")}` : result.summary,
              };
              issues.push(...review.issues);
              this.log(`review rejected ${task.id}: ${review.notes.join("; ")}`);
            } else {
              completed++;
            }
          } catch (reviewErr) {
            // Review failure must not fail the task.
            if (reviewErr instanceof TaskTimeoutError) {
              this.log(`review of ${task.id} timed out after ${formatDurationMs(timeoutMs)}; treating as passed`);
            }
            completed++;
          }
        } else {
          issues.push(...result.issues);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = err instanceof TaskTimeoutError;
        task.status = "failed";
        const issue: Issue = timedOut
          ? {
              severity: "high",
              category: "timeout",
              title: `Task ${task.id} timed out after ${formatDurationMs(timeoutMs)} — marked failed (not blocked)`,
              detail: `The agent did not finish within the per-task timeout (${formatDurationMs(timeoutMs)}). Increase it with the NEUTRON_TASK_TIMEOUT_MS env var or the taskTimeoutMs config option, then retry with \`neutron run --resume\`.`,
              fixRecommendation: "neutron fix && neutron run --resume",
            }
          : {
              severity: "high",
              category: "agent",
              title: `Agent ${agent.label} crashed: ${message}`,
            };
        task.result = {
          status: "failed",
          summary: timedOut ? issue.title : message,
          filesChanged: [],
          commandsRun: [],
          testsRun: [],
          issues: [issue],
          nextActions: [],
        };
        issues.push(issue);
      }
      task.updatedAt = new Date().toISOString();
      this.options.onTaskStatus?.(task, agent);
      this.store.setTasks(tasks);
    }

    return { issues, completed };
  }

  private buildContextFor(agent: Agent): AgentContext {
    const root = this.root;
    const designText = readProjectFile(root, "design.md");
    const design = designText ? parseDesignSystem(designText) : undefined;
    const designJson = design ? toDesignSystemJson(design) : undefined;
    const autoApprove = this.options.config.autoApprove === true;
    const approver = new Approver({ autoApprove });
    const term = new Terminal({
      cwd: root,
      approve: (req) => approver.ask(req),
    });
    const logger = this.log;
    const injectedRun = this.options.run;

    return {
      root,
      design,
      designJson,
      api: this.api ?? (undefined as unknown as ApiSystem),
      log: (msg) => logger(msg),
      run: async (cmd: string) =>
        injectedRun ? injectedRun(cmd) : term.run(cmd),
      readFile: (p) => readProjectFile(root, p),
      writeFile: (p, c) => writeProjectFile(root, p, c),
      listDir: (dir) => {
        try {
          return readdirSync(dir ?? root);
        } catch {
          return [];
        }
      },
      getApproval: (req) =>
        approver.ask({
          message: req.message,
          command: req.command,
          reason: req.reason,
          onApprove: async () => {},
          onDeny: async () => {},
        }),
    };
  }
}

export function createFallbackTasks(design: DesignSystem): Task[] {
  const tasks: Task[] = [];
  let n = 1;
  const PREFIX: Record<string, string> = {
    requirements: "REQ",
    design: "DSN",
    frontend: "FE",
    backend: "BE",
    database: "DB",
    security: "SEC",
    devops: "DEV",
    qa: "QA",
    reviewer: "REV",
    manager: "MGR",
  };
  const add = (agent: string, description: string, deps: string[], priority: Task["priority"]) => {
    const id = `${PREFIX[agent] ?? agent.toUpperCase().slice(0, 3)}-${String(n++).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const task: Task = { id, agent, description, dependencies: deps, priority, status: "pending", createdAt: now, updatedAt: now };
    tasks.push(task);
    return id;
  };
  const rid = add("requirements", "Write requirements.md", [], "high");
  const did = add("design", "Write design-system.json", [rid], "high");
  add("frontend", "Implement frontend", [did], "high");
  add("backend", "Implement backend", [rid], "high");
  add("security", "Security audit", [rid], "high");
  add("qa", "Run tests", [rid], "high");
  return tasks;
}