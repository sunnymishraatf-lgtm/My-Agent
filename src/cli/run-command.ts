import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createAgentRegistry } from "../agents/registry";
import { loadConfig, registerSecrets } from "../config";
import { ApiSystem } from "../api/api-manager";
import { Orchestrator } from "../orchestrator/orchestrator";
import { stateCommand } from "./state-command";
import { StateStore } from "../store";
import { startTui, type LegacyTuiController as TuiController } from "../tui";
import { FileLogger } from "../logger";
import type { Task } from "../scheduler/task";

export interface RunCommandOptions {
  root: string;
  autoApprove?: boolean;
  resume?: boolean;
  interactive?: boolean;
  json?: boolean;
  noGit?: boolean;
}

export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const root = opts.root;
  const designPath = join(root, "design.md");

  const stopFlag = join(root, ".agent", "stop.flag");
  if (existsSync(stopFlag)) {
    try {
      unlinkSync(stopFlag);
    } catch {
      /* best effort */
    }
  }

  if (!existsSync(designPath)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: "design.md not found" }));
    } else {
      console.log("design.md not found.");
      console.log("Before I start the engineering team, please create design.md.");
      console.log("Run `neutron design --template` to generate a starter template, then fill it in.");
    }
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));

  const store = new StateStore(root);
  store.ensure();

  const logDir = join(root, ".agent", "logs");
  const managerLog = new FileLogger(logDir, "manager");
  const apiLog = new FileLogger(logDir, "api");

  const api = new ApiSystem({ config, logger: apiLog });
  const agents = createAgentRegistry();

  let tui: TuiController | null = null;
  const useTui = opts.interactive === true && !opts.json;
  let logFn: (msg: string) => void = useTui ? () => {} : (msg: string) => console.log(msg);
  const agentStates: Record<string, string> = {};

  if (useTui) {
    tui = await startTui({
      running: true,
      statusLine: "Reading design.md and preparing the engineering plan...",
      agentStates: {},
    });
    if (!tui) {
      // TUI unavailable (ink not installed or terminal unsupported): plain fallback
      logFn = (msg: string) => console.log(msg);
      logFn("Starting the engineering team...");
    }
  }

  const orchestrator = new Orchestrator({
    root,
    agents,
    config: {
      maxConcurrentRequests: config.api.maxConcurrentRequests,
      maxIterations: config.completion.maxIterations,
      autoApprove: opts.autoApprove,
      noGit: opts.noGit,
    },
    api,
    log: (msg) => {
      managerLog.info(msg);
      if (tui) tui.update({ statusLine: msg });
      else if (!opts.json) logFn(msg);
    },
    store,
    onTaskStatus: (task, agent) => {
      agentStates[task.agent] = task.status;
      store.appendLog(task.agent, `${task.status.toUpperCase()} ${task.id}: ${task.description}`);
      if (tui) {
        tui.update({
          currentTask: `${agent.label}: ${task.description}`,
          statusLine: `${task.id} -> ${task.status}`,
          agentStates: { ...agentStates },
        });
      } else if (!opts.json) {
        console.log(`[${task.status.toUpperCase()}] ${task.id} (${agent.label}) ${task.description}`);
      }
    },
  });

  try {
    let tasks;
    if (opts.resume) {
      const stored = store.getTasks();
      if (stored.length > 0) {
        tasks = stored;
        logFn(`Resuming ${stored.length} task(s) from saved state.`);
        const retryable = tasks.filter((t) => t.status === "failed" || t.status === "blocked");
        if (retryable.length > 0) {
          for (const t of retryable) {
            t.status = "pending";
            t.retries = (t.retries ?? 0) + 1;
          }
          store.setTasks(tasks);
          logFn(`Re-queued ${retryable.length} failed/blocked task(s) for retry.`);
        }
      }
    }
    if (!tasks) {
      const plan = await orchestrator.plan();
      if (!plan.ok || plan.tasks.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: plan.reasons.join("; ") }));
        } else {
          console.log("Could not build an engineering plan. Is design.md complete?");
        }
        process.exitCode = 1;
        return;
      }
      tasks = plan.tasks;
      if (!opts.json) {
        console.log(`\nEngineering plan: ${tasks.length} tasks`);
        for (const t of tasks) {
          const deps = t.dependencies.length ? ` (after ${t.dependencies.join(", ")})` : "";
          console.log(`  ${t.id} [${t.agent}] ${t.description}${deps}`);
        }
        console.log("");
      }
    }

    const summary = await orchestrator.execute(tasks, { resume: opts.resume });
    tui?.destroy();
    tui = null;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ok: summary.ok,
            iterations: summary.iterations,
            tasksCompleted: summary.tasksCompleted,
            issues: summary.issues.map((i) => ({ severity: i.severity, category: i.category, title: i.title })),
          },
          null,
          2,
        ),
      );
    } else {
      console.log("");
      printRunSummary(summary, store.getTasks(), api);
      stateCommand(store);
    }
    if (!summary.ok) process.exitCode = 1;
  } catch (err) {
    tui?.destroy();
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

function printRunSummary(
  summary: {
    ok: boolean;
    iterations: number;
    tasksCompleted: number;
    issues: { severity: string; category?: string; title: string }[];
  },
  tasks: Task[],
  api: ApiSystem,
) {
  const critical = summary.issues.filter((i) => i.severity === "critical").length;
  const high = summary.issues.filter((i) => i.severity === "high").length;
  console.log(`Iterations: ${summary.iterations}`);
  console.log(`Tasks completed: ${summary.tasksCompleted}`);
  console.log(`Issues: ${critical} critical, ${high} high`);
  console.log(summary.ok ? "\nPROJECT READY" : "\nPROJECT NOT READY");
  if (!summary.ok) {
    console.log("Blocking issues:");
    for (const i of summary.issues.filter((x) => x.severity === "critical" || x.severity === "high").slice(0, 10)) {
      console.log(`  ${i.severity}: ${i.title}`);
    }
    console.log("\nCheck .agent/review.md and .agent/test-results.md, then run `neutron fix`.");
  }

  const s = api.stats;
  const avgLatency = s.requests > 0 ? Math.round(s.latencyMs / s.requests) : 0;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const blockedTasks = tasks.filter((t) => t.status === "blocked").length;
  console.log("");
  console.log("PROJECT HEALTH");
  console.log("--------------");
  console.log(`Health: ${summary.ok ? "GOOD" : "NEEDS ATTENTION"}`);
  console.log(
    `Tasks: ${summary.tasksCompleted}/${tasks.length} completed, ${failedTasks} failed, ${blockedTasks} blocked`,
  );
  console.log(
    `API: ${s.requests} requests, ${s.failures} failures, ${s.failovers} failovers, ${avgLatency}ms avg latency`,
  );
  console.log(`Tokens: ${s.inputTokens.toLocaleString()} in / ${s.outputTokens.toLocaleString()} out`);
  for (const [id, ps] of s.providers) {
    console.log(
      `  ${id}: ${ps.totalRequests} requests, ${ps.failures} failures, ${ps.inputTokens.toLocaleString()}/${ps.outputTokens.toLocaleString()} tokens`,
    );
  }
}