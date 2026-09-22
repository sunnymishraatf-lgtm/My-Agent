import type { Agent, AgentContext, AgentResult } from "../agents/agent";
import { createAgentRegistry } from "../agents/registry";
import type { Task } from "../scheduler/task";
import {
  isWithinWorkspace,
  readProjectFile,
  writeProjectFile,
} from "../files/project-files";
import { resolve } from "node:path";
import { Terminal } from "../terminal/terminal";
import { Approver } from "../approval/approver";
import { analyzeRepository } from "./analyzer";
import type { FileChange, ImpactLevel, NeutronTask } from "./model";
import { unifiedDiff } from "../chat/diff";
import type { RunRecorder } from "./record";
import { deriveProjectMemory } from "./memory";
import { readGlobalProviders } from "../config";

const AGENT_MAP: Record<string, string> = {
  frontend: "frontend",
  backend: "backend",
  database: "database",
  testing: "qa",
  devops: "devops",
  other: "backend",
};

export interface ImplementOptions {
  root: string;
  api?: import("../api/api-manager").ApiSystem;
  autoApprove?: boolean;
  log?: (msg: string) => void;
  recorder?: RunRecorder;
  preserveFileContents?: boolean;
  /** Max concurrent maintain tasks within a dependency batch. Defaults to 4 (NEUTRON_MAX_PARALLEL). */
  maxParallel?: number;
}

export interface ExtendedTask {
  task: NeutronTask;
  result: AgentResult | undefined;
  error?: string;
}

export interface ImplementOutcome {
  completed: number;
  failed: number;
  blocked: number;
  changes: FileChange[];
  extended: ExtendedTask[];
  tasksWithResults: number;
  noLlm: boolean;
}

/** A before/after content snapshot for one planned file. */
export interface ChangeSnapshot {
  /** Repo-relative path as recorded in the task plan. */
  path: string;
  before: string | undefined;
  after: string | undefined;
}

/**
 * Turn before/after snapshots into FileChange records.
 *
 * Change detection is bounded to repository state: any path that resolves
 * outside the repository root (absolute paths elsewhere on the filesystem,
 * `..` traversals) is ignored, so changes outside the repo are never reported.
 */
export function detectFileChanges(
  root: string,
  tasks: NeutronTask[],
  snapshots: ChangeSnapshot[],
): FileChange[] {
  const changes: FileChange[] = [];
  for (const s of snapshots) {
    if (!isWithinWorkspace(root, resolve(root, s.path))) continue;
    const entry = tasks.find((t) => t.files.includes(s.path));
    const agent = entry?.agent ?? "backend";
    const risk = entry?.risk ?? "low";
    if (s.after === undefined && s.before !== undefined) {
      changes.push({
        path: s.path,
        kind: "deleted",
        linesAdded: 0,
        linesRemoved: lineCount(s.before),
        agent: agentLabel(agent),
        reason: entry?.reason ?? "Removed as part of the maintenance task",
        taskId: entry?.id,
        risk,
      });
    } else if (s.after !== undefined && s.before === undefined) {
      changes.push({
        path: s.path,
        kind: "added",
        linesAdded: lineCount(s.after),
        linesRemoved: 0,
        agent: agentLabel(agent),
        reason: entry?.reason ?? "Created as part of the maintenance task",
        taskId: entry?.id,
        risk,
        after: s.after,
      });
    } else if (
      s.after !== undefined &&
      s.before !== undefined &&
      s.after !== s.before
    ) {
      const patch = unifiedDiff(s.before, s.after, s.path);
      const minuses = (patch.match(/(?:^|\n)-(?!-)/g) ?? []).length;
      const pluses = (patch.match(/(?:^|\n)\+(?!\+)/g) ?? []).length;
      changes.push({
        path: s.path,
        kind: "modified",
        linesAdded: pluses,
        linesRemoved: minuses,
        agent: agentLabel(agent),
        reason: entry?.reason ?? "Modified as part of the maintenance task",
        taskId: entry?.id,
        risk,
        before: s.before,
        after: s.after,
      });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes;
}

/**
 * Group tasks into dependency-ordered execution batches: each batch holds the
 * tasks whose dependencies are all satisfied by earlier batches. Tasks with
 * unsatisfiable dependencies (deadlock) are left unbatched.
 */
export function computeTaskBatches(tasks: NeutronTask[]): NeutronTask[][] {
  const remaining = new Set(tasks.map((t) => t.id));
  const done = new Set<string>();
  const batches: NeutronTask[][] = [];
  let guard = 0;
  while (remaining.size > 0 && guard++ < 1000) {
    const batch: NeutronTask[] = [];
    for (const t of tasks) {
      if (!remaining.has(t.id)) continue;
      if (t.dependencies.every((d) => done.has(d))) batch.push(t);
    }
    if (batch.length === 0) break;
    for (const t of batch) {
      remaining.delete(t.id);
      done.add(t.id);
    }
    batches.push(batch);
  }
  return batches;
}

/**
 * Maximum number of concurrently-running tasks in any batch (parallel width).
 * This is a max over batch widths — not a sum and not a total task count.
 */
export function maxBatchWidth(widths: number[]): number {
  return widths.reduce((m, w) => Math.max(m, w), 0);
}

/** Default cap on concurrent maintain tasks within a dependency batch. */
export const DEFAULT_MAX_PARALLEL = 4;

/**
 * Resolve the concurrency cap for implementPlan(): explicit option first, then
 * the NEUTRON_MAX_PARALLEL env var, then the default. Invalid values fall back
 * to the default; the cap is always at least 1.
 */
export function resolveMaxParallel(explicit?: number): number {
  const envRaw = process.env.NEUTRON_MAX_PARALLEL;
  // Strict numeric parse: a fractional or non-numeric value is a misconfiguration
  // and must fall back to the default rather than being silently truncated.
  const envVal =
    envRaw !== undefined && envRaw.trim() !== "" ? Number(envRaw) : NaN;
  const candidate =
    explicit ?? (Number.isInteger(envVal) && envVal > 0 ? envVal : NaN);
  if (Number.isInteger(candidate) && candidate > 0) return candidate as number;
  return DEFAULT_MAX_PARALLEL;
}

/**
 * Split items into consecutive chunks of at most `cap` items, preserving
 * dependency-batch semantics: every chunk holds independent tasks, so chunks
 * can run sequentially while each chunk runs concurrently.
 */
export function boundedChunks<T>(items: T[], cap: number): T[][] {
  const width = Math.max(1, Math.floor(cap));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += width) {
    chunks.push(items.slice(i, i + width));
  }
  return chunks;
}

function orderFor(task: NeutronTask): number {
  return (
    {
      config: 0,
      backend: 1,
      database: 1,
      frontend: 2,
      tests: 3,
      infrastructure: 4,
    }[task.agent] ?? 1
  );
}

export function hasProviderConfigured(): boolean {
  return readGlobalProviders().some((p) => p.enabled && p.baseUrl);
}

export async function implementPlan(
  opts: ImplementOptions,
  tasks: NeutronTask[],
): Promise<ImplementOutcome> {
  const log = opts.log ?? (() => {});
  const root = opts.root;
  const outcome: ImplementOutcome = {
    completed: 0,
    failed: 0,
    blocked: 0,
    changes: [],
    extended: [],
    tasksWithResults: 0,
    noLlm: false,
  };

  const providers = readGlobalProviders();
  const canRun = providers.some((p) => p.enabled && p.baseUrl) && !!opts.api;

  // Pre-snapshot every file that may be touched (to compute real diffs).
  const beforeMap = new Map<string, string>();
  const touchSet = new Set<string>();
  for (const t of tasks) for (const f of t.files) touchSet.add(f);
  for (const f of touchSet) {
    const content = readProjectFile(root, f);
    if (content !== undefined) beforeMap.set(f, content);
  }

  if (!canRun) {
    outcome.noLlm = true;
    for (const t of tasks) {
      const task: Task = {
        id: t.id,
        agent: AGENT_MAP[t.agent] ?? "backend",
        description: `${t.label}. ${t.reason}`,
        dependencies: t.dependencies,
        priority: riskToPriority(t.risk),
        status: "failed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retries: 0,
      };
      const result: AgentResult = {
        status: "failed",
        summary:
          "No LLM provider configured. Cannot fabricate an implementation.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [
          {
            severity: "critical",
            category: "provider",
            title: "No LLM provider configured — implementation not possible",
            detail:
              "Run `neutron config` to add an OpenAI-compatible provider, then retry. NEUTRON will not fabricate code changes or test results.",
            fixRecommendation:
              "neutron config && neutron maintain run --resume",
          },
        ],
        nextActions: [
          "Retry",
          "Reassign",
          "Inspect Logs",
          "Continue Without Agent",
        ],
      };
      outcome.failed++;
      outcome.extended.push({ task: t, result });
      log(
        `[FAILED] ${t.id} (${t.agent}) ${t.label} — no LLM provider configured`,
      );
      opts.recorder?.audit(
        agentLabel(t.agent),
        `Blocked task ${t.id}`,
        "no LLM provider configured",
      );
    }
    // No changes were made; still persist the (empty) change list for uniformity.
    opts.recorder?.setChanges(outcome.changes);
    return outcome;
  }

  // Build the real agent context once
  const approver = new Approver({ autoApprove: opts.autoApprove === true });
  const term = new Terminal({
    cwd: root,
    approve: (req) => approver.ask(req),
  });
  const ctx: AgentContext = {
    root,
    design: undefined,
    designJson: undefined,
    api: opts.api!,
    log: (m) => {
      log(m);
      opts.recorder?.audit("orchestrator", m);
    },
    run: async (cmd: string) =>
      term.run(cmd, { timeoutMs: 240_000 }).then((r) => ({
        status: r.status as "ok" | "error",
        stdout: r.stdout as string,
        stderr: r.stderr as string,
        exitCode: r.exitCode ?? 1,
      })),
    readFile: (p) => readProjectFile(root, p),
    writeFile: (p, c) => writeProjectFile(root, p, c),
    listDir: () => [],
    getApproval: async (req) =>
      approver.ask(req as Parameters<typeof approver.ask>[0]),
  };

  const agents = createAgentRegistry();
  const byAgent = new Map<string, Agent>();
  for (const a of agents) byAgent.set(a.id, a);

  const done = new Map<string, Task | undefined>();
  outcome.extended = tasks.map((t) => ({ task: t, result: undefined }));

  const runnable = new Set(tasks.map((t) => t.id));
  const batchWidths: number[] = [];
  // Bounded parallelism: at most `cap` tasks from a dependency batch run
  // concurrently, so file/LLM activity stays bounded even for wide batches.
  const cap = resolveMaxParallel(opts.maxParallel);
  const observedWidths: number[] = [];
  let guard = 0;
  while (runnable.size > 0 && guard++ < 100) {
    // independent tasks run in parallel batches
    const batch: NeutronTask[] = [];
    for (const t of tasks) {
      if (!runnable.has(t.id)) continue;
      if (done.has(t.id)) continue;
      const depsReady = t.dependencies.every((d) => done.has(d));
      if (depsReady) batch.push(t);
    }
    batchWidths.push(batch.length);
    if (batch.length === 0) {
      // deadlock → mark remaining as blocked
      for (const t of tasks) {
        if (!done.has(t.id)) {
          outcome.blocked++;
          done.set(t.id, undefined);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Blocked task ${t.id}`,
            "dependency not satisfiable",
          );
        }
      }
      break;
    }

    // Bounded parallelism: tasks inside a batch are independent; run them in
    // chunks of at most `cap` so concurrency stays bounded.
    const runTask = async (t: NeutronTask): Promise<void> => {
      runnable.delete(t.id);
      const agentMeta = byAgent.get(AGENT_MAP[t.agent] ?? "backend");
      const task: Task = {
        id: t.id,
        agent: AGENT_MAP[t.agent] ?? "backend",
        description: `${t.label}. ${t.reason}`,
        dependencies: t.dependencies,
        priority: riskToPriority(t.risk),
        status: "running",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retries: 0,
      };
      opts.recorder?.audit(
        agentLabel(t.agent),
        `Started task ${t.id}`,
        t.label,
      );
      try {
        if (!agentMeta) {
          throw new Error(`No agent available for ${t.agent}`);
        }
        const result = await agentMeta.execute(task, ctx);
        outcome.tasksWithResults++;
        const entry = outcome.extended.find((e) => e.task.id === t.id);
        if (entry) entry.result = result;
        if (result.status === "success") {
          outcome.completed++;
          done.set(t.id, task);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Completed task ${t.id}`,
            `modified ${result.filesChanged.length} file(s)`,
          );
        } else if (result.status === "blocked") {
          outcome.blocked++;
          done.set(t.id, undefined);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Blocked task ${t.id}`,
            result.summary,
          );
        } else {
          outcome.failed++;
          done.set(t.id, undefined);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Failed task ${t.id}`,
            result.summary,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome.failed++;
        const result: AgentResult = {
          status: "failed",
          summary: message,
          filesChanged: [],
          commandsRun: [],
          testsRun: [],
          issues: [
            {
              severity: "high",
              category: "agent",
              title: `Agent crashed: ${message}`,
            },
          ],
          nextActions: [
            "Retry",
            "Reassign",
            "Inspect Logs",
            "Continue Without Agent",
          ],
        };
        const entry = outcome.extended.find((e) => e.task.id === t.id);
        if (entry) {
          entry.result = result;
          entry.error = message;
        }
        done.set(t.id, undefined);
        opts.recorder?.audit(
          agentLabel(t.agent),
          `Failed task ${t.id}`,
          message,
        );
      }
    };

    for (const chunk of boundedChunks(batch, cap)) {
      observedWidths.push(chunk.length);
      await Promise.all(chunk.map(runTask));
    }
  }

  // Compute real changes: compare before/after snapshots of every planned file.
  // Change detection is bounded to the repository root (see detectFileChanges):
  // files outside the repo are never reported.
  const touched = [...new Set(tasks.flatMap((t) => t.files))];
  outcome.changes = detectFileChanges(
    root,
    tasks,
    touched.map((f) => ({
      path: f,
      before: beforeMap.get(f),
      after: readProjectFile(root, f),
    })),
  );

  // Persist the per-file change list (and changeCount) into the run record.
  opts.recorder?.setChanges(outcome.changes);

  opts.recorder?.setMetrics({
    agentsExecuted: outcome.extended.length,
    parallelTasks: maxBatchWidth(observedWidths),
    maxParallelTasks: cap,
    modifiedFiles: outcome.changes.length,
  });

  return outcome;
}

function lineCount(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function agentLabel(agent: string): string {
  const map: Record<string, string> = {
    frontend: "Frontend Agent",
    backend: "Backend Agent",
    database: "Database Agent",
    testing: "Testing Agent",
    devops: "DevOps Agent",
    other: "Backend Agent",
    orchestrator: "NEUTRON",
  };
  return map[agent] ?? agent;
}

function riskToPriority(risk: ImpactLevel): Task["priority"] {
  return risk === "critical"
    ? "critical"
    : risk === "high"
      ? "high"
      : risk === "medium"
        ? "medium"
        : "low";
}
