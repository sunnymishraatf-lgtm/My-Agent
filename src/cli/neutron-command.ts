import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadConfig, registerSecrets } from "../config";
import { ApiSystem } from "../api/api-manager";
import { runFullWorkflow, whatCouldBreakExplanation, formatWorkflowResult } from "../neutron/workflow";
import { formatImpactGraph } from "../neutron/impact";
import { formatPlan } from "../neutron/planner";
import { formatSecurityReview } from "../neutron/security-scanner";
import { formatTestResult } from "../neutron/test-runner";
import { formatRelease } from "../neutron/review";
import { formatMemory } from "../neutron/memory";
import { collectBobActivity } from "../neutron/bob";
import { formatHistory, formatAudit, formatMetrics, RunArchive } from "../neutron/record";
import { NeutronStore } from "../neutron/store";
import { scaffoldDemoProject, DEMO_REQUESTS, DEMO_DESCRIPTIONS } from "../neutron/demo";
import { analyzeRepository, toRepoMap } from "../neutron/analyzer";
import { analyzeImpact } from "../neutron/impact";
import { selectTests } from "../neutron/test-runner";
import { hasProviderConfigured } from "../neutron/agents";
import { Approver } from "../approval/approver";
import type { MaintenanceRequest } from "../neutron/model";

const APPROVAL_REASONS: Record<string, string> = {
  "dangerous-command": "the command may be destructive",
  destructive: "this operation is destructive",
  "outside-workspace": "operates outside the workspace",
  "contains-secret": "looks like it contains a secret",
  "large-delete": "large delete",
  "public-exposure": "may expose to the public",
  "package-install": "installs a package",
};

function buildApi(): { api: ApiSystem; configured: boolean } {
  const config = loadConfig();
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));
  const api = new ApiSystem({ config, logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
  return { api, configured: hasProviderConfigured() };
}

async function askApproval(title: string, lines: string[]): Promise<{ approved: boolean; source: "interactive" | "-y" | "non-tty" }> {
  const approver = new Approver({ autoApprove: false });
  const message = [title, ...lines].join("\n");
  const { approved, source } = await approver.askWithSource({
    message,
    reason: "destructive" as never,
    onApprove: async () => {},
    onDeny: async () => {},
  });
  return { approved, source };
}

export async function neutronCommand(request?: string, opts?: Record<string, unknown>): Promise<void> {
  const root = process.cwd();
  const execution = typeof opts?.execution === "string" ? (opts.execution as MaintenanceRequest["execution"]) : "implement-and-test";
  const riskTolerance = typeof opts?.risk === "string" ? (opts.risk as MaintenanceRequest["riskTolerance"]) : "balanced";
  const branch = typeof opts?.branch === "string" ? (opts.branch) : currentBranch(root);
  const planOnly = execution === "plan-only";
  const repository = readRepositoryName(root);

  const store = new NeutronStore(root);
  store.ensure();

  const req: MaintenanceRequest = {
    request: request ?? store.load().request ?? "",
    repository,
    branch,
    riskTolerance,
    execution,
  };
  if (!req.request) {
    console.log("Please provide a maintenance request. Example:");
    console.log('  neutron maintain "Add Google OAuth while preserving the existing login"');
    process.exitCode = 1;
    return;
  }

  const { api, configured } = buildApi();

  const doApprove = opts?.yes === true;

  const result = await runFullWorkflow({
    root,
    api: configured ? api : undefined,
    autoApprove: doApprove,
    log: (m) => console.log(`[neutron] ${m}`),
    store,
    request: req,
    invokeApproval: async ({ lines }) => {
      if (doApprove) return { approved: true, source: "-y" as const };
      console.log("\n" + lines.join("\n"));
      return askApproval("Approve?", []);
    },
  });

  console.log("");
  if (req.execution === "plan-only") {
    console.log(formatImpactGraph(result.graph));
    console.log("");
    console.log(formatPlan(result.plan));
    return;
  }

  console.log(formatImpactGraph(result.graph));
  console.log("");
  console.log(formatPlan(result.plan));
  console.log("");
  if (result.outcome?.noLlm) {
    console.log("No LLM provider configured — implementation tasks were recorded as FAKE-FREE failures:");
    for (const t of result.plan.tasks) console.log(`  ${t.id} [${t.agent}] ${t.label} -> not executed (no provider)`);
    console.log("");
    console.log("Configure a provider with `neutron config` then re-run to execute the agents.");
  } else if (result.outcome) {
    console.log("REAL CHANGES");
    for (const c of result.outcome.changes) {
      console.log(`  ${c.kind.padEnd(9)} ${c.path} (+${c.linesAdded}/-${c.linesRemoved}) [${c.agent}]`);
    }
  }
  if (result.testResult) {
    console.log("");
    console.log(formatTestResult(result.testResult));
  }
  if (result.security) {
    console.log("");
    console.log(formatSecurityReview(result.security));
  }
  if (result.codeReview) {
    console.log("");
    console.log(`CODE REVIEW`);
    console.log(`Score: ${result.codeReview.score}/100 ${result.codeReview.passed ? "PASS" : "FAIL"}`);
    for (const f of result.codeReview.findings) console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
  }
  if (result.release) {
    console.log("");
    console.log(formatRelease(result.release));
  }

  console.log("");
  console.log(formatWorkflowResult(result));
}

export async function neutronReportCommand(opts?: { json?: boolean; mem?: boolean; bob?: boolean; history?: boolean; audit?: boolean; metrics?: boolean }): Promise<void> {
  const root = process.cwd();
  const store = new NeutronStore(root);
  const state = store.load();
  const archive = new RunArchive(root);

  if (opts?.json) {
    console.log(JSON.stringify({ state, runs: archive.list() }, null, 2));
    return;
  }

  const analysis = state.analysis ?? analyzeRepository(root);
  console.log("NEUTRON WORKSPACE REPORT");
  console.log("---------------------");
  console.log(`Repository: ${analysis.filesAnalyzed} files analyzed, ${analysis.nodeCount} nodes, health ${analysis.health}%`);
  console.log(`Stack: ${analysis.languages.join(", ")} | ${analysis.frameworks.join(", ")} | ${analysis.packageManagers.join(", ")}`);
  console.log("");
  console.log("REPOSITORY MAP");
  for (const group of toRepoMap(analysis)) {
    console.log(`  ${group.name} (${group.children.length})`);
    for (const child of group.children.slice(0, 12)) {
      const tests = child.tests.length > 0 ? ` tests=${child.tests.length}` : "";
      const deps = child.dependerCount > 0 ? ` used-by=${child.dependerCount}` : "";
      console.log(`    ${child.path}${deps}${tests}`);
    }
    if (group.children.length > 12) console.log(`    ... ${group.children.length - 12} more`);
  }

  const bob = collectBobActivity(root);
  console.log("");
  console.log("IBM BOB 2.0");
  if (bob.hasActivity) {
    console.log(`  Repository context: Analyzed ✓`);
    console.log(`  Sessions: ${bob.sessionCount}`);
    console.log(`  Tasks: ${bob.taskCount}`);
    console.log(`  Files analyzed: ${bob.filesAnalyzed}`);
    console.log(`  Files modified: ${bob.filesModified}`);
    console.log(`  Tests assisted: ${bob.testsAssisted}`);
  } else {
    console.log("  No Bob activity yet. Drop session exports into .agent/bob/ to connect.");
  }

  if (opts?.mem) {
    console.log("");
    console.log(formatMemory(deriveMemoryEntries(analysis)));
  }
  if (opts?.history) {
    const runs = archive.list();
    console.log("");
    console.log("MAINTENANCE HISTORY");
    for (const r of runs.slice(0, 10)) {
      console.log(`  ${new Date(r.createdAt).toLocaleString()} ${r.request} [${r.status}]`);
    }
  }
  if (opts?.audit) {
    const runs = archive.list();
    const events = runs.flatMap((r) => r.events);
    if (events.length > 0) {
      console.log("");
      console.log(formatAudit(events.slice(-40)));
    }
  }
  if (opts?.metrics) {
    const runs = archive.list();
    const latest = runs[0];
    if (latest) {
      console.log("");
      console.log(formatMetrics(latest.metrics));
    }
  }
}

import { deriveProjectMemory } from "../neutron/memory";
function deriveMemoryEntries(analysis: ReturnType<typeof analyzeRepository>) {
  return deriveProjectMemory(analysis);
}

export async function neutronDemoCommand(name: string, opts?: { dir?: string; dryRun?: boolean }): Promise<void> {
  const key = name as "taskflow";
  const target = opts?.dir ? resolve(process.cwd(), opts.dir) : resolve(process.cwd(), name);
  if (existsSync(join(target, "package.json")) && !opts?.dryRun) {
    console.log(`Directory ${target} already has a package.json. Pass --dir to choose another.`);
    process.exitCode = 1;
    return;
  }
  if (opts?.dryRun) {
    console.log(`Would scaffold demo project "${name}" into ${target}`);
    console.log(DEMO_DESCRIPTIONS[key] ?? "Demo project");
    return;
  }
  const result = scaffoldDemoProject(target, key);
  console.log(`Scaffolded demo project "${name}" into ${target}`);
  console.log(`${result.files.length} files written.`);
  console.log("");
  console.log("Next:");
  console.log(`  cd ${target}`);
  console.log(`  neutron maintain "${DEMO_REQUESTS[key] ?? ""}"`);
}

export async function neutronWhatBreaksCommand(opts?: Record<string, unknown>): Promise<void> {
  const root = process.cwd();
  const store = new NeutronStore(root);
  const state = store.load();
  if (!state.graph) {
    console.log("No impact graph yet. Run `neutron maintain \"<request>\" --execution plan-only` first to analyze.");
    process.exitCode = 1;
    return;
  }
  console.log(whatCouldBreakExplanation(state.graph));
}

function currentBranch(root: string): string {
  // read from git if present
  try {
    const gitDir = join(root, ".git");
    if (existsSync(gitDir)) {
      const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
      if (head.startsWith("ref: ")) return head.slice(5).split("/").pop() ?? "main";
    }
  } catch {
    /* ignore */
  }
  return "main";
}

function readRepositoryName(root: string): string {
  try {
    const pkg = join(root, "package.json");
    if (existsSync(pkg)) {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
      if (data.name) return data.name;
    }
  } catch {
    /* ignore */
  }
  return root.split(/[\\/]/).pop() ?? "repository";
}

function addMaintenanceSubcommands(group: Command): void {
  group
    .command("report")
    .description("Show the NEUTRON workspace report (analysis, memory, Bob, history).")
    .option("--json", "Machine-readable JSON")
    .option("--mem", "Include project memory")
    .option("--bob", "Include IBM Bob activity")
    .option("--history", "Include maintenance history")
    .option("--audit", "Include audit log")
    .option("--metrics", "Include latest metrics")
    .action(async (opts: Record<string, unknown>) => {
      await neutronReportCommand(opts as { json?: boolean; mem?: boolean; bob?: boolean; history?: boolean; audit?: boolean; metrics?: boolean });
    });

  group
    .command("demo [name]")
    .description("Scaffold a sample repository for the demo (taskflow).")
    .option("--dir <path>", "Target directory")
    .option("--dry-run", "Only describe what would be created")
    .action(async (name: string | undefined, opts: { dir?: string; dryRun?: boolean }) => {
      await neutronDemoCommand(name ?? "taskflow", opts);
    });

  group
    .command("what-breaks")
    .description('Given the cached impact graph, show "What could break?".')
    .action(async () => {
      await neutronWhatBreaksCommand();
    });

  group
    .command("history")
    .description("Show a timeline of past NEUTRON maintenance runs.")
    .action(() => {
      const archive = new RunArchive(process.cwd());
      const runs = archive.list();
      if (runs.length === 0) {
        console.log("No NEUTRON runs yet.");
        return;
      }
      for (const r of runs.slice(0, 20)) {
        const time = new Date(r.createdAt).toLocaleString();
        console.log(`${time} [${r.status}] ${r.request}`);
        for (const h of r.history.slice(0, 12)) {
          const t = new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          console.log(`    ${t} ${h.event}${h.detail ? " \u2014 " + h.detail : ""}`);
        }
      }
    });
}

function addMaintenanceOptions(cmd: Command): Command {
  return cmd
    .argument("[request]", "Maintenance request (natural language)")
    .option("-y, --yes", "Auto-approve the plan and release gates (use with care)")
    .option("--execution <mode>", "plan-only | implement | implement-and-test", "implement-and-test")
    .option("--risk <level>", "safe | balanced | aggressive", "balanced")
    .option("--branch <name>", "Base branch to protect", "main");
}

export function registerNeutronCommand(program: Command): void {
  const maintain = addMaintenanceOptions(
    program
      .command("maintain")
      .description("Run the NEUTRON maintenance workflow: impact analysis -> plan -> agents -> tests -> security -> review -> release."),
  ).action(async (req: string | undefined, opts: Record<string, unknown>) => {
    await neutronCommand(req, opts);
  });
  addMaintenanceSubcommands(maintain);

  // Deprecated: the pre-rename `sun` command group. Hidden from help, kept so existing scripts keep working.
  const legacy = addMaintenanceOptions(program.command("sun", { hidden: true })).action(
    async (req: string | undefined, opts: Record<string, unknown>) => {
      console.error("`neutron sun` is deprecated; use `neutron maintain`.");
      await neutronCommand(req, opts);
    },
  );
  addMaintenanceSubcommands(legacy);
}
