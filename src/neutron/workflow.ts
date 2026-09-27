import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { ApprovalResult, Checkpoint, CodeReview, ImpactGraph, ImpactNode, MaintenanceRequest, ReleaseGate, RepoAnalysis, SecurityReview, NeutronPlan, TestResult } from "./model";
import { analyzeRepository } from "./analyzer";
import { analyzeImpact } from "./impact";
import { buildPlan } from "./planner";
import { scanSecurity } from "./security-scanner";
import { runSelectedTests, validateBuild } from "./test-runner";
import { buildCodeReview, evaluateRelease } from "./review";
import { implementPlan, type ImplementOutcome } from "./agents";
import { NeutronStore } from "./store";
import { RunRecorder } from "./record";
import { Git } from "../git";
import { deriveProjectMemory } from "./memory";
import { Terminal } from "../terminal/terminal";

export interface NeutronWorkflowOptions {
  root: string;
  api?: import("../api/api-manager").ApiSystem;
  autoApprove?: boolean;
  log?: (msg: string) => void;
  invokeApproval?: (args: { title: string; lines: string[]; metadata?: Record<string, unknown> }) => Promise<ApprovalResult>;
  store?: NeutronStore;
}

export interface NeutronResult {
  analysis: RepoAnalysis;
  graph: ImpactGraph;
  plan: NeutronPlan;
  outcome?: ImplementOutcome;
  testResult?: TestResult;
  security?: SecurityReview;
  codeReview?: CodeReview;
  release?: ReleaseGate;
  checkpoint?: Checkpoint;
  runId?: string;
  deviations: string[];
  errors: string[];
  noLlm: boolean;
}

/**
 * Safe default: with no interactive approver wired in, nothing is approved unless the caller
 * explicitly opted in with `autoApprove`. (This used to approve everything unconditionally.)
 */
function defaultApprover(autoApprove?: boolean): (a: { title: string; lines: string[]; metadata?: Record<string, unknown> }) => Promise<ApprovalResult> {
  return async () =>
    autoApprove
      ? { approved: true, reason: "auto-approved (explicit --yes / autoApprove)", source: "-y" }
      : { approved: false, reason: "human approval required; no approver available in this context", source: "non-tty" };
}

export function createNeutronWorkflow(opts: NeutronWorkflowOptions) {
  const log = opts.log ?? (() => {});
  const root = opts.root;
  const store = opts.store ?? new NeutronStore(root);
  const approve = opts.invokeApproval ?? defaultApprover(opts.autoApprove);
  const git = new Git(root);
  const term = new Terminal({
    cwd: root,
    approve: async (req) => {
      const r = await approve({ title: "NEUTRON command approval", lines: [req.message, req.command ? `Command: ${req.command}` : ""].filter(Boolean) });
      return r.approved;
    },
  });

  return {
    root,
    store,
    log,

    async analyze(): Promise<RepoAnalysis> {
      log("Analyzing repository...");
      const analysis = analyzeRepository(root);
      store.update({ repository: packageName(root), analysis });
      return analysis;
    },

    async impact(req: MaintenanceRequest, analysis: RepoAnalysis): Promise<ImpactGraph> {
      log("Computing impact...");
      const graph = analyzeImpact(analysis, req);
      store.update({ request: req.request, branch: req.branch, riskTolerance: req.riskTolerance, execution: req.execution, graph });
      return graph;
    },

    async plan(graph: ImpactGraph): Promise<NeutronPlan> {
      log("Building implementation plan...");
      const plan = buildPlan(graph);
      store.update({ plan });
      return plan;
    },

    async requestApproval(plan: NeutronPlan): Promise<ApprovalResult> {
      const lines = [
        "IMPLEMENTATION PLAN",
        "",
        `${plan.affectedFiles.length} files affected`,
        `${plan.affectedServices.length} services affected`,
        `${plan.databaseMigrations} database migration(s)`,
        `${plan.affectedTests.length} tests affected`,
        "",
        `Risk: ${plan.overallRisk.toUpperCase()}`,
      ];
      const result = await approve({ title: "NEUTRON Implementation Plan Approval", lines, metadata: { kind: "plan-approval" } });
      return { ...result, title: "NEUTRON Implementation Plan Approval" };
    },

    async prepareCheckpoint(): Promise<Checkpoint | undefined> {
      if (!git.isRepo()) return undefined;
      const current = await git.currentBranch();
      if (current === "main") {
        const id = `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 5)}`;
        const branch = `neutron/maintenance/${id}`;
        const created = await git.createBranch(branch);
        if (!created) {
          log(`[checkpoint] warning: could not create branch ${branch}`);
          return undefined;
        }
        const checkpoint: Checkpoint = { id, createdAt: new Date().toISOString(), repository: packageName(root), branch, status: "created" };
        store.update({ checkpointId: id });
        return checkpoint;
      }
      return undefined;
    },

    async implement(graph: ImpactGraph, plan: NeutronPlan, recorder: RunRecorder): Promise<ImplementOutcome> {
      log(`Implementing ${plan.tasks.length} tasks (parallel where possible)...`);
      recorder.audit("NEUTRON", "implementation started");
      try {
        const outcome = await implementPlan(
          {
            root,
            api: opts.api,
            autoApprove: opts.autoApprove,
            log: (m) => log(m),
            recorder,
          },
          plan.tasks,
        );
        recorder.stage("implementation", "done");
        return outcome;
      } catch (err) {
        recorder.stage("implementation", "failed");
        throw err;
      }
    },

    async runTests(graph: ImpactGraph, recorder: RunRecorder): Promise<TestResult | undefined> {
      const touched = graph.nodes.map((n) => n.path);
      const analysis = analyzeRepository(root);
      const result = await runSelectedTests({ root, touchedPaths: touched, analysis });
      recorder.setTestResult(result);
      return result;
    },

    async security(recorder: RunRecorder): Promise<SecurityReview> {
      const review = scanSecurity(root);
      recorder.setSecurity(review);
      return review;
    },

    async codeReview(recorder: RunRecorder): Promise<CodeReview> {
      const analysis = analyzeRepository(root);
      const review = buildCodeReview(analysis);
      recorder.setCodeReview(review);
      return review;
    },

    async release(
      recorder: RunRecorder,
      checks?: {
        implOk?: boolean;
        tests?: { failed: number; passed: number; total?: number };
        securityBlocked?: boolean;
        reviewPassed?: boolean;
      },
    ): Promise<ReleaseGate> {
      const analysis = analyzeRepository(root);
      const build = await validateBuild(root);
      const gate = evaluateRelease({
        repoAnalysis: analysis,
        implementationDone: checks?.implOk ?? true,
        buildOk: build.ok,
        buildDetail:
          build.reason === "missing-node-modules"
            ? "blocked: node_modules not found"
            : build.reason === "build-failed"
              ? `failed: ${build.command ?? "build"}`
              : build.command
                ? `passed: ${build.command}`
                : "no build configured",
        tests: checks?.tests,
        security: checks?.securityBlocked !== undefined ? { blocked: checks.securityBlocked } : undefined,
        codeReview: checks?.reviewPassed !== undefined ? { passed: checks.reviewPassed, score: checks.reviewPassed ? 100 : 50 } : undefined,
      });
      recorder.setRelease(gate);
      return gate;
    },

    memory(): string {
      const analysis = analyzeRepository(root);
      return deriveProjectMemory(analysis).map((e) => `${e.category}: ${e.title} -> ${e.value}`).join("\n");
    },
  };
}

export interface FullWorkflowOptions extends NeutronWorkflowOptions {
  request: MaintenanceRequest;
}

export async function runFullWorkflow(opts: FullWorkflowOptions): Promise<NeutronResult> {
  const wf = createNeutronWorkflow(opts);
  const log = opts.log ?? (() => {});
  const root = opts.root;
  const runId = `run-${Date.now().toString(36)}`;
  const recorder = new RunRecorder(root, {
    id: runId,
    request: opts.request.request,
    repository: opts.request.repository,
    branch: opts.request.branch,
  });
  const start = Date.now();
  const errors: string[] = [];
  const deviations: string[] = [];

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      recorder.stage(name, "done");
      recorder.history({ ts: new Date().toISOString(), event: `${name} complete`, stage: name });
    } catch (err) {
      recorder.stage(name, "failed");
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${message}`);
      recorder.history({ ts: new Date().toISOString(), event: `${name} failed`, stage: name, detail: message });
      recorder.audit("NEUTRON", `${name} failed`, message);
    }
  };

  let analysis: RepoAnalysis | undefined;
  let graph: ImpactGraph | undefined;
  let plan: NeutronPlan | undefined;
  let outcome: ImplementOutcome | undefined;
  let testResult: TestResult | undefined;
  let security: SecurityReview | undefined;
  let codeReview: CodeReview | undefined;
  let release: ReleaseGate | undefined;
  let checkpoint: Checkpoint | undefined;
  let noLlm = false;

  try {
  await step("repository-analysis", async () => {
    analysis = await wf.analyze();
  });
  if (!analysis) throw new Error("Repository analysis failed.");
  recorder.setMetrics({ repoFilesAnalyzed: analysis.filesAnalyzed });

  await step("impact-analysis", async () => {
    graph = await wf.impact(opts.request, analysis!);
  });
  if (!graph) throw new Error("Impact analysis failed.");
  recorder.setMetrics({ affectedFiles: graph.nodes.length });

  await step("change-plan", async () => {
    plan = await wf.plan(graph!);
  });
  if (!plan) throw new Error("Plan generation failed.");

  const planApproval = await wf.requestApproval(plan);
  // Persist the full decision (timestamp, decision, gate title, source) and emit a detailed audit event.
  recorder.recordApproval({
    approved: planApproval.approved,
    title: planApproval.title ?? "NEUTRON Implementation Plan Approval",
    source: planApproval.source,
    reason: planApproval.reason,
  });
  if (!planApproval.approved) {
    log("Plan not approved. Nothing was changed. Refine the request and run `neutron maintain` again.");
    recorder.setStatus("plan-denied");
    return { analysis, graph, plan, runId, deviations, errors, noLlm };
  }

  if (opts.request.execution === "plan-only") {
    recorder.setStatus("planned");
    recorder.setMetrics({ executionDurationMs: Date.now() - start });
    return { analysis, graph, plan, runId, deviations, errors, noLlm };
  }

  checkpoint = await wf.prepareCheckpoint();
  if (checkpoint) recorder.setCheckpoint(checkpoint);

  await step("implementation", async () => {
    outcome = await wf.implement(graph!, plan!, recorder);
    if (outcome.noLlm) noLlm = true;
    if (outcome.failed > 0) deviations.push(`Implementation: ${outcome.failed} task(s) failed.`);
    recorder.history({ ts: new Date().toISOString(), event: `implementation: ${outcome.completed} completed, ${outcome.failed} failed`, stage: "implementation" });
  });

  if (opts.request.execution === "implement-and-test") {
    await step("testing", async () => {
      testResult = await wf.runTests(graph!, recorder);
      if (testResult?.regression) deviations.push("Regression detected in tests.");
    });
    await step("security", async () => {
      security = await wf.security(recorder);
      if (security?.blocked) deviations.push(`Security review blocked (${security.findings.filter((f) => (f.severity as string) === "high" || (f.severity as string) === "critical").length} high/critical finding(s)).`);
    });
    await step("code-review", async () => {
      codeReview = await wf.codeReview(recorder);
      if (codeReview && !codeReview.passed) deviations.push(`Code review not clean (score ${codeReview.score}).`);
    });
    await step("release-gate", async () => {
      const implOk = outcome !== undefined && outcome.failed === 0 && outcome.blocked === 0;
      release = await wf.release(recorder, {
        implOk,
        tests: testResult?.after ? { failed: testResult.after.failed, passed: testResult.after.passed, total: testResult.after.total } : undefined,
        securityBlocked: security?.blocked,
        reviewPassed: codeReview?.passed,
      });
      recorder.history({ ts: new Date().toISOString(), event: `release: ${release!.status}`, stage: "release-gate" });
    });
  }

  recorder.setStatus("completed");
  recorder.setMetrics({ executionDurationMs: Date.now() - start, startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString() });
  const result: NeutronResult = { analysis, graph, plan, outcome, testResult, security, codeReview, release, checkpoint, runId, deviations, errors, noLlm };
  return result;
  } catch (err) {
    recorder.setStatus("failed");
    recorder.audit("NEUTRON", "workflow failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    try {
      recorder.save();
    } catch (saveErr) {
      log(`[run] warning: could not persist run record: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
    }
  }
}

function packageName(root: string): string {
  const pkg = `${root.replace(/[\\/]+$/, "/")}package.json`;
  if (existsSync(pkg)) {
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
      return data.name ?? basename(root);
    } catch {
      /* ignore */
    }
  }
  return basename(root) ?? "repository";
}

export function formatWorkflowResult(result: NeutronResult): string {
  const lines: string[] = [];
  lines.push("NEUTRON MAINTENANCE RESULT");
  lines.push("----------------------");
  if (result.graph) {
    lines.push(`Impact: ${result.graph.summary.files} files, ${result.graph.summary.apis} APIs, ${result.graph.summary.database} database, ${result.graph.summary.tests} tests`);
  }
  if (result.plan) {
    lines.push(`Plan: ${result.plan.tasks.length} task(s), risk ${result.plan.overallRisk.toUpperCase()}`);
  }
  if (result.outcome) {
    lines.push(`Implementation: ${result.outcome.completed} completed, ${result.outcome.failed} failed, ${result.outcome.blocked} blocked`);
    if (result.outcome.noLlm) lines.push("  No LLM provider configured — tasks were not executed (no fabricated changes).");
    else if (result.outcome.changes.length > 0) lines.push(`  ${result.outcome.changes.length} real file change(s):`);
    for (const c of result.outcome.changes.slice(0, 12)) {
      lines.push(`    ${c.kind.padEnd(9)} ${c.path} (+${c.linesAdded}/-${c.linesRemoved}) [${c.agent}]`);
    }
  }
  if (result.testResult) {
    const t = result.testResult;
    lines.push(`Tests: ${t.after ? `${t.after.passed}/${t.after.total} passed, ${t.after.failed} failed` : "not run"}${t.regression ? " — REGRESSION" : ""}`);
  }
  if (result.security) lines.push(`Security: ${result.security.findings.length} finding(s)${result.security.blocked ? " — BLOCKED" : ""}`);
  if (result.codeReview) lines.push(`Code review: score ${result.codeReview.score}/100${result.codeReview.passed ? " (pass)" : " (fail)"}`);
  if (result.release) lines.push(`Release: ${result.release.status.toUpperCase()}`);
  if (result.checkpoint) lines.push(`Checkpoint: ${result.checkpoint.branch}`);
  if (result.deviations.length > 0) {
    lines.push("");
    lines.push("DEVIATIONS");
    for (const d of result.deviations) lines.push(`  ⚠ ${d}`);
  }
  if (result.errors.length > 0) {
    lines.push("");
    lines.push("ERRORS");
    for (const e of result.errors) lines.push(`  ✗ ${e}`);
  }
  return lines.join("\n");
}

const SECURITY_SENSITIVE = /(auth|token|password|passwd|secret|session|crypto|oauth|jwt|payment|permission|acl|login)/i;

/**
 * Human-readable "What could break?" derived from the computed impact graph (no canned data).
 * Every entry shows WHY it is listed: keyword match, dependents (files that import it) and tests.
 */
export function whatCouldBreakExplanation(graph: ImpactGraph): string {
  const lines: string[] = [];
  lines.push("WHAT COULD BREAK?");
  lines.push("------------------");
  const atRisk = graph.nodes
    .filter((n) => n.impact !== "low")
    .sort((a, b) => b.dependents.length - a.dependents.length || a.path.localeCompare(b.path));
  const s = graph.summary;
  lines.push(`Scope: ${graph.nodes.length} affected file(s) - ${s.apis} API, ${s.database} database, ${s.frontend} frontend, ${s.backend} backend, ${s.tests} test(s).`);
  lines.push("");

  const groups: Array<[string, (n: ImpactNode) => boolean]> = [
    ["APIs / routes", (n) => n.category === "backend" && /(route|api|controller|endpoint|handler)/i.test(n.path)],
    ["Database & data model", (n) => n.category === "database"],
    ["Frontend dependencies", (n) => n.category === "frontend"],
    ["Backend services", (n) => n.category === "backend"],
    ["Tests that may need updating", (n) => n.category === "tests"],
    ["Configuration / infrastructure", (n) => n.category === "config" || n.category === "infrastructure"],
  ];
  const seen = new Set<string>();
  for (const [title, pred] of groups) {
    const items = atRisk.filter((n) => !seen.has(n.id) && pred(n));
    if (items.length === 0) continue;
    lines.push(`${title}:`);
    for (const n of items) {
      seen.add(n.id);
      lines.push(`  ! ${n.path} [${n.impact.toUpperCase()}, ${(n.confidence * 100).toFixed(0)}% confidence]`);
      for (const r of n.reasons.slice(0, 2)) lines.push(`      why: ${r}`);
      if (n.dependents.length > 0) lines.push(`      used by: ${n.dependents.slice(0, 5).join(", ")}${n.dependents.length > 5 ? ` (+${n.dependents.length - 5} more)` : ""}`);
    }
    lines.push("");
  }
  for (const n of atRisk) {
    if (seen.has(n.id)) continue;
    lines.push(`  ! ${n.path} [${n.impact.toUpperCase()}]`);
  }

  const sensitive = graph.nodes.filter((n) => SECURITY_SENSITIVE.test(n.path));
  if (sensitive.length > 0) {
    lines.push("Security-sensitive components in scope (get extra review):");
    for (const n of sensitive) lines.push(`  ! ${n.path}`);
    lines.push("");
  }
  if (atRisk.length === 0) lines.push("No medium/high/critical impact found for this request.");
  const low = graph.nodes.filter((n) => n.impact === "low").map((n) => n.path);
  if (low.length > 0) {
    lines.push("Low impact (unlikely to break):");
    for (const p of low.slice(0, 8)) lines.push(`  ok ${p}`);
  }
  return lines.join("\n");
}
