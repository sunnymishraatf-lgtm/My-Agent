/**
 * NEUTRON web demo backend.
 *
 * A thin, security-hardened HTTP layer around the EXISTING NEUTRON workflow
 * (src/neutron/*). Nothing here re-implements analysis, planning, execution,
 * testing, security scanning, review or release gating — every stage calls the
 * same functions the CLI uses (`neutron maintain`).
 *
 * Demo flow:
 *   POST /api/demo/prepare  -> scaffold (or reuse) the controlled TaskFlow demo repo
 *   POST /api/demo/analyze  -> real analyzeRepository + analyzeImpact + buildPlan
 *   POST /api/demo/approve  -> server-side, single-use plan approval
 *   POST /api/demo/reject   -> deny the plan (fail-closed)
 *   POST /api/demo/execute  -> start a background job (409 unless approved)
 *   GET  /api/demo/jobs/:id -> live stage/event status (poll from the UI)
 *   GET  /api/demo/jobs/:id/result -> sanitized final result
 *   GET  /api/demo/status  -> capability banner (LLM configured or not)
 *
 * Security properties:
 * - Repository roots are always contained inside the demo workspace
 *   (NEUTRON_DEMO_WORKSPACE). Path traversal is rejected; nothing outside the
 *   workspace is ever read or written.
 * - GitHub URL cloning is OFF unless NEUTRON_DEMO_ALLOW_CLONE=1, uses a strict
 *   URL allow-list, shallow clones via execFile (no shell), and a timeout.
 * - Plan approvals live only in server memory, are single-use, and are consumed
 *   before execution. Client flags can never approve anything.
 * - In the web context every non-plan approval (terminal commands, etc.) is
 *   denied; allow-listed read-only commands keep working through the existing
 *   Terminal allow-list. A server restart invalidates pending approvals.
 * - API keys stay server-side: responses never include env vars or secrets.
 * - Bounded: per-IP rate limit, max concurrent jobs, capped payloads.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { analyzeRepository } from "../neutron/analyzer";
import { analyzeImpact } from "../neutron/impact";
import { buildPlan } from "../neutron/planner";
import { createNeutronWorkflow, type NeutronResult } from "../neutron/workflow";
import { NeutronStore } from "../neutron/store";
import { RunRecorder } from "../neutron/record";
import { scaffoldDemoProject, DEMO_REQUESTS, DEMO_DESCRIPTIONS } from "../neutron/demo";
import { hasProviderConfigured } from "../neutron/agents";
import { loadConfig, registerSecrets } from "../config";
import { ApiSystem } from "../api/api-manager";
import type {
  ImpactGraph,
  MaintenanceRequest,
  NeutronPlan,
  RepoAnalysis,
} from "../neutron/model";

/* ------------------------------------------------------------------ */
/* Workspace + repository resolution                                   */
/* ------------------------------------------------------------------ */

const DEMO_PROJECT = "taskflow" as const;

export function resolveDemoWorkspace(explicit?: string): string {
  const fromEnv = process.env.NEUTRON_DEMO_WORKSPACE?.trim();
  const dir = explicit?.trim() || fromEnv || join(process.cwd(), "neutron-demo-workspace");
  const abs = resolve(dir);
  mkdirSync(abs, { recursive: true });
  return abs;
}

export interface ResolvedRepo {
  /** Absolute, workspace-contained directory of the target repository. */
  dir: string;
  /** Short display name (never an absolute server path). */
  name: string;
  /** True when this is the bundled demo repository. */
  isDemo: boolean;
}

const REPO_INPUT_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-\\/]{0,119}$/;

/**
 * Resolve a user-supplied repository reference to a workspace-contained
 * directory. Accepts the literal "demo" (bundled TaskFlow project) or a
 * workspace-relative path. Rejects absolute paths, traversal, URLs and
 * anything that does not already exist as a directory.
 */
export function resolveRepoDir(workspace: string, input: string): ResolvedRepo {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "demo") {
    return { dir: join(workspace, DEMO_PROJECT), name: DEMO_PROJECT, isDemo: true };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new DemoError(
      "Repository URL cloning is disabled on this demo deployment. Use the demo repository or a path inside the demo workspace.",
      400,
    );
  }
  if (!REPO_INPUT_RE.test(trimmed)) {
    throw new DemoError("Invalid repository reference. Use \"demo\" or a workspace-relative path.", 400);
  }
  const abs = normalize(resolve(workspace, trimmed));
  if (abs !== workspace && !abs.startsWith(workspace + sep)) {
    throw new DemoError("Repository path escapes the demo workspace.", 400);
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new DemoError(`Repository not found in the demo workspace: ${trimmed}`, 404);
  }
  return { dir: abs, name: relative(workspace, abs) || trimmed, isDemo: false };
}

/** Error with an explicit HTTP status for the demo API. */
export class DemoError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Optional GitHub cloning (opt-in, strict)                            */
/* ------------------------------------------------------------------ */

const GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/;

export function cloneAllowed(): boolean {
  return process.env.NEUTRON_DEMO_ALLOW_CLONE === "1";
}

/**
 * Shallow-clone a GitHub repo into the demo workspace. Disabled unless
 * NEUTRON_DEMO_ALLOW_CLONE=1. Strict URL allow-list, execFile (no shell),
 * 90s timeout, destination derived from owner/repo (sanitized).
 */
export function cloneRepo(workspace: string, url: string): Promise<ResolvedRepo> {
  return new Promise((resolvePromise, reject) => {
    if (!cloneAllowed()) {
      reject(new DemoError("Repository URL cloning is disabled on this demo deployment.", 400));
      return;
    }
    const m = GITHUB_URL_RE.exec(url.trim());
    if (!m) {
      reject(new DemoError("Only https://github.com/<owner>/<repo> URLs can be cloned.", 400));
      return;
    }
    const dest = join(workspace, `${m[1]}-${m[2]}`.slice(0, 80));
    if (existsSync(dest)) {
      reject(new DemoError("That repository is already cloned in the demo workspace.", 409));
      return;
    }
    execFile("git", ["clone", "--depth", "1", url.trim(), dest], { timeout: 90_000 }, (err) => {
      if (err) {
        reject(new DemoError(`Clone failed: ${shortErr(err)}`, 502));
        return;
      }
      resolvePromise({ dir: dest, name: `${m[1]}/${m[2]}`, isDemo: false });
    });
  });
}

function shortErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0]!.slice(0, 200);
}

/* ------------------------------------------------------------------ */
/* Demo repository preparation                                         */
/* ------------------------------------------------------------------ */

export interface PreparedDemo {
  repository: string;
  name: string;
  description: string;
  defaultRequest: string;
  reused: boolean;
  files: number;
}

export function prepareDemoRepo(workspace: string): PreparedDemo {
  const dir = join(workspace, DEMO_PROJECT);
  const reused = existsSync(join(dir, "package.json"));
  const files = reused ? [] : scaffoldDemoProject(dir, DEMO_PROJECT).files;
  return {
    repository: "demo",
    name: DEMO_PROJECT,
    description: DEMO_DESCRIPTIONS[DEMO_PROJECT],
    defaultRequest: DEMO_REQUESTS[DEMO_PROJECT],
    reused,
    files: reused ? countFilesHint(dir) : files.length,
  };
}

function countFilesHint(_dir: string): number {
  // Reused repos: report the scaffold size constant instead of re-walking.
  return 23;
}

/* ------------------------------------------------------------------ */
/* Analysis records + single-use approvals                             */
/* ------------------------------------------------------------------ */

export interface AnalysisRecord {
  id: string;
  repoDir: string;
  repository: string;
  isDemo: boolean;
  request: string;
  riskTolerance: MaintenanceRequest["riskTolerance"];
  analysis: RepoAnalysis;
  graph: ImpactGraph;
  plan: NeutronPlan;
  createdAt: string;
}

export type DemoStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface DemoStage {
  key: string;
  label: string;
  status: DemoStageStatus;
  detail?: string;
}

export interface DemoEvent {
  ts: string;
  stage: string;
  message: string;
}

export type DemoJobStatus =
  | "queued"
  | "running"
  | "awaiting-approval"
  | "completed"
  | "failed"
  | "denied";

export interface DemoJob {
  id: string;
  status: DemoJobStatus;
  request: string;
  repository: string;
  isDemo: boolean;
  stages: DemoStage[];
  events: DemoEvent[];
  createdAt: string;
  finishedAt?: string;
  error?: string;
  noLlm?: boolean;
  result?: SanitizedResult;
}

/** Client-safe subset of NeutronResult: real data, capped sizes, no secrets. */
export interface SanitizedResult {
  runId: string;
  noLlm: boolean;
  llmNote?: string;
  analysis: {
    filesAnalyzed: number;
    nodeCount: number;
    languages: string[];
    frameworks: string[];
    packageManagers: string[];
    entryPoints: string[];
    health: number;
    warnings: string[];
    analyzedAt: string;
  };
  impact: {
    files: number;
    apis: number;
    database: number;
    frontend: number;
    backend: number;
    tests: number;
    whatCouldBreak: string[];
    lowRisk: string[];
    nodesTruncated: boolean;
    nodes: Array<{
      path: string;
      category: string;
      impact: string;
      confidence: number;
      reasons: string[];
      dependents: string[];
    }>;
  };
  plan: NeutronPlan;
  execution?: {
    completed: number;
    failed: number;
    blocked: number;
    noLlm: boolean;
    changes: Array<{
      path: string;
      kind: string;
      linesAdded: number;
      linesRemoved: number;
      agent: string;
      reason: string;
      risk: string;
    }>;
  };
  tests?: {
    command: string;
    after?: { total: number; passed: number; failed: number };
    regression: boolean;
    failedTests: string[];
    stdoutTail: string;
  };
  security?: {
    blocked: boolean;
    summary: string;
    findings: Array<{ severity: string; title: string; file?: string; category: string }>;
    findingsTruncated: boolean;
  };
  codeReview?: {
    score: number;
    passed: boolean;
    summary: string;
    findings: Array<{ severity: string; title: string; file?: string }>;
    findingsTruncated: boolean;
  };
  release?: {
    status: string;
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
    blockedBy: string[];
  };
  deviations: string[];
  errors: string[];
}

const STAGE_DEFS: Array<[string, string]> = [
  ["repository-analysis", "Repository Analysis"],
  ["impact-analysis", "Impact Analysis"],
  ["implementation-plan", "Implementation Plan"],
  ["human-approval", "Human Approval"],
  ["agent-execution", "Agent Execution"],
  ["testing", "Testing"],
  ["security", "Security"],
  ["code-review", "Code Review"],
  ["release-readiness", "Release Readiness"],
];

function freshStages(): DemoStage[] {
  return STAGE_DEFS.map(([key, label]) => ({ key, label, status: "pending" as DemoStageStatus }));
}

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function buildApi(): { api?: ApiSystem } {
  if (!hasProviderConfigured()) return {};
  const config = loadConfig();
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));
  return { api: new ApiSystem({ config, logger: silentLogger }) };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ------------------------------------------------------------------ */
/* Demo manager: analyses, approvals, jobs                             */
/* ------------------------------------------------------------------ */

export interface DemoManagerOptions {
  maxJobs?: number;
}

export class DemoManager {
  readonly workspace: string;
  private analyses = new Map<string, AnalysisRecord>();
  /** Single-use plan approvals: analysisId -> approval timestamp. In-memory only. */
  private approvals = new Map<string, string>();
  private jobs = new Map<string, DemoJob>();
  private maxJobs: number;

  constructor(workspace: string, opts: DemoManagerOptions = {}) {
    this.workspace = workspace;
    this.maxJobs = Number(process.env.NEUTRON_DEMO_MAX_JOBS ?? opts.maxJobs ?? 2) || 2;
  }

  /* ---------------- analyze ---------------- */

  analyze(repoInput: string, request: string, riskTolerance: MaintenanceRequest["riskTolerance"]): AnalysisRecord {
    if (!request || !request.trim()) throw new DemoError("A maintenance request is required.", 400);
    if (request.trim().length > 2000) throw new DemoError("Maintenance request is too long (max 2000 chars).", 400);
    const repo = resolveRepoDir(this.workspace, repoInput);
    // The real NEUTRON pipeline: static analysis -> impact graph -> plan.
    const analysis = analyzeRepository(repo.dir);
    const maintRequest: MaintenanceRequest = {
      request: request.trim(),
      repository: repo.name,
      branch: "main",
      riskTolerance,
      execution: "implement-and-test",
    };
    const graph = analyzeImpact(analysis, maintRequest);
    const plan = buildPlan(graph);

    const store = new NeutronStore(repo.dir);
    try {
      store.ensure();
      const prev = store.load();
      store.save({ ...prev, request: maintRequest.request, repository: repo.name, branch: "main", riskTolerance, execution: "implement-and-test", analysis, graph, plan });
    } catch {
      /* persistence is best-effort; the analysis record below is authoritative */
    }

    const record: AnalysisRecord = {
      id: nextId("analysis"),
      repoDir: repo.dir,
      repository: repo.name,
      isDemo: repo.isDemo,
      request: maintRequest.request,
      riskTolerance,
      analysis,
      graph,
      plan,
      createdAt: new Date().toISOString(),
    };
    this.analyses.set(record.id, record);
    // A fresh analysis invalidates any prior approval for older analyses of this repo.
    for (const [aid, rec] of this.analyses) {
      if (aid !== record.id && rec.repoDir === repo.dir) this.approvals.delete(aid);
    }
    return record;
  }

  getAnalysis(id: string): AnalysisRecord {
    const rec = this.analyses.get(id);
    if (!rec) throw new DemoError("Analysis not found. Run the analysis step first.", 404);
    return rec;
  }

  /* ---------------- approve / reject ---------------- */

  approve(analysisId: string): { approved: true; analysisId: string } {
    const rec = this.getAnalysis(analysisId);
    if (!rec.plan || rec.plan.tasks.length === 0) {
      throw new DemoError("No plan to approve for this analysis.", 409);
    }
    this.approvals.set(analysisId, new Date().toISOString());
    return { approved: true, analysisId };
  }

  reject(analysisId: string): { rejected: true; analysisId: string } {
    this.getAnalysis(analysisId);
    this.approvals.delete(analysisId);
    return { rejected: true, analysisId };
  }

  /* ---------------- execute (background job) ---------------- */

  activeJobCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "queued" || j.status === "running" || j.status === "awaiting-approval") n += 1;
    }
    return n;
  }

  execute(analysisId: string): DemoJob {
    const rec = this.getAnalysis(analysisId);
    const approvalAt = this.approvals.get(analysisId);
    if (!approvalAt) {
      throw new DemoError("Plan approval required. Review the plan and approve it before execution.", 409);
    }
    // Single-use: consume BEFORE starting so it can never authorize a second run.
    this.approvals.delete(analysisId);
    if (this.activeJobCount() >= this.maxJobs) {
      throw new DemoError(`Too many demo jobs running (max ${this.maxJobs}). Try again shortly.`, 429);
    }
    const job: DemoJob = {
      id: nextId("job"),
      status: "queued",
      request: rec.request,
      repository: rec.repository,
      isDemo: rec.isDemo,
      stages: freshStages(),
      events: [],
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    // Fire and forget: completion/failure is recorded on the job itself.
    void this.runJob(job, rec).catch((err) => {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
      pushEvent(job, "job", `Job failed: ${job.error}`);
    });
    return job;
  }

  getJob(id: string): DemoJob {
    const job = this.jobs.get(id);
    if (!job) throw new DemoError("Job not found.", 404);
    return job;
  }

  /* ---------------- job runner: the real NEUTRON stages ---------------- */

  private async runJob(job: DemoJob, rec: AnalysisRecord): Promise<void> {
    const { api } = buildApi();
    const noLlm = !api;
    job.noLlm = noLlm;
    job.status = "running";
    pushEvent(job, "job", `Starting NEUTRON workflow on "${rec.repository}"${noLlm ? " (no LLM provider configured — implementation will be honestly skipped)" : ""}.`);

    const recorder = new RunRecorder(rec.repoDir, {
      id: job.id,
      request: rec.request,
      repository: rec.repository,
      branch: "main",
    });
    const wf = createNeutronWorkflow({
      root: rec.repoDir,
      ...(api ? { api } : {}),
      autoApprove: false,
      log: (m) => pushEvent(job, "activity", m),
      // Only the already-granted plan approval passes here. Every other approval
      // (terminal commands, etc.) is denied: fail-closed in the web context.
      invokeApproval: async ({ metadata }) =>
        metadata?.kind === "plan-approval"
          ? { approved: true, reason: "plan approved in the NEUTRON web demo", source: "interactive" as const }
          : { approved: false, reason: "interactive approval is not available in the web demo", source: "non-tty" as const },
    });

    const deviations: string[] = [];
    const errors: string[] = [];
    const setStage = (key: string, status: DemoStageStatus, detail?: string) => {
      const s = job.stages.find((x) => x.key === key);
      if (s) {
        s.status = status;
        if (detail !== undefined) s.detail = detail;
      }
      pushEvent(job, key, `${labelOf(key)}: ${status}${detail ? ` — ${detail}` : ""}`);
    };
    const step = async (key: string, fn: () => Promise<void>) => {
      setStage(key, "running");
      try {
        await fn();
        setStage(key, "completed");
        recorder.stage(key, "done");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStage(key, "failed", message);
        recorder.stage(key, "failed");
        errors.push(`${key}: ${message}`);
      }
    };

    let analysis: RepoAnalysis | undefined;
    let graph: ImpactGraph | undefined;
    let plan: NeutronPlan | undefined;
    let outcome: NeutronResult["outcome"];
    let testResult: NeutronResult["testResult"];
    let security: NeutronResult["security"];
    let codeReview: NeutronResult["codeReview"];
    let release: NeutronResult["release"];

    await step("repository-analysis", async () => {
      analysis = await wf.analyze();
      recorder.setMetrics({ repoFilesAnalyzed: analysis.filesAnalyzed });
    });
    await step("impact-analysis", async () => {
      const req: MaintenanceRequest = { request: rec.request, repository: rec.repository, branch: "main", riskTolerance: rec.riskTolerance, execution: "implement-and-test" };
      graph = await wf.impact(req, analysis!);
      recorder.setMetrics({ affectedFiles: graph.nodes.length });
    });
    await step("implementation-plan", async () => {
      plan = await wf.plan(graph!);
    });

    // Human approval gate. The UI approval was consumed before the job started;
    // this re-confirms through the workflow's own gate (fail-closed).
    setStage("human-approval", "running");
    const approval = await wf.requestApproval(plan!);
    recorder.recordApproval({
      approved: approval.approved,
      title: approval.title ?? "NEUTRON Implementation Plan Approval",
      source: approval.source,
      reason: approval.reason,
    });
    if (!approval.approved) {
      setStage("human-approval", "failed", "Plan was not approved — nothing was changed.");
      job.status = "denied";
      job.finishedAt = new Date().toISOString();
      recorder.setStatus("plan-denied");
      try { recorder.save(); } catch { /* best-effort */ }
      return;
    }
    setStage("human-approval", "completed", approval.reason ?? "approved");

    await step("agent-execution", async () => {
      outcome = await wf.implement(graph!, plan!, recorder);
      if (outcome.noLlm) {
        deviations.push("No LLM provider configured — implementation tasks were recorded as not-executed (nothing was fabricated).");
      } else if (outcome.failed > 0) {
        deviations.push(`Implementation: ${outcome.failed} task(s) failed.`);
      }
      recorder.setChanges(outcome.changes);
    });
    await step("testing", async () => {
      testResult = await wf.runTests(graph!, recorder);
      if (testResult?.regression) deviations.push("Regression detected in tests.");
    });
    await step("security", async () => {
      security = await wf.security(recorder);
      if (security?.blocked) deviations.push("Security review blocked the change.");
    });
    await step("code-review", async () => {
      codeReview = await wf.codeReview(recorder);
      if (codeReview && !codeReview.passed) deviations.push(`Code review not clean (score ${codeReview.score}).`);
    });
    await step("release-readiness", async () => {
      const implOk = outcome !== undefined && outcome.failed === 0 && outcome.blocked === 0;
      release = await wf.release(recorder, {
        implOk,
        tests: testResult?.after ? { failed: testResult.after.failed, passed: testResult.after.passed, total: testResult.after.total } : undefined,
        securityBlocked: security?.blocked,
        reviewPassed: codeReview?.passed,
      });
    });

    const failedStages = job.stages.filter((s) => s.status === "failed");
    job.status = failedStages.length > 0 ? "failed" : "completed";
    job.finishedAt = new Date().toISOString();
    job.result = sanitizeResult({
      analysis: analysis!,
      graph: graph!,
      plan: plan!,
      outcome,
      testResult,
      security,
      codeReview,
      release,
      runId: job.id,
      deviations,
      errors,
      noLlm: noLlm || outcome?.noLlm === true,
    });
    recorder.setStatus(job.status === "completed" ? "completed" : "failed");
    try { recorder.save(); } catch { /* best-effort */ }
    pushEvent(job, "job", `Workflow ${job.status}.`);
  }
}

function labelOf(key: string): string {
  return STAGE_DEFS.find(([k]) => k === key)?.[1] ?? key;
}

function pushEvent(job: DemoJob, stage: string, message: string): void {
  job.events.push({ ts: new Date().toISOString(), stage, message: message.slice(0, 2000) });
  // Bound the in-memory log; the full audit trail lives in the RunRecorder archive.
  if (job.events.length > 500) job.events.splice(0, job.events.length - 500);
}

/* ------------------------------------------------------------------ */
/* Result sanitization (real data, capped, no secrets)                  */
/* ------------------------------------------------------------------ */

const MAX_NODES = 200;
const MAX_FINDINGS = 50;

function sanitizeResult(r: NeutronResult): SanitizedResult {
  const a = r.analysis;
  const g = r.graph;
  return {
    runId: r.runId ?? "",
    noLlm: r.noLlm,
    ...(r.noLlm
      ? { llmNote: "No LLM provider is configured on this demo server, so the agent implementation step was honestly skipped — no code was fabricated. Repository analysis, impact analysis, planning, tests, security scan, code review and the release gate all ran for real." }
      : {}),
    analysis: {
      filesAnalyzed: a.filesAnalyzed,
      nodeCount: a.nodeCount,
      languages: a.languages,
      frameworks: a.frameworks,
      packageManagers: a.packageManagers,
      entryPoints: a.entryPoints.slice(0, 20),
      health: a.health,
      warnings: a.warnings.slice(0, 20),
      analyzedAt: a.analyzedAt,
    },
    impact: {
      files: g.summary.files,
      apis: g.summary.apis,
      database: g.summary.database,
      frontend: g.summary.frontend,
      backend: g.summary.backend,
      tests: g.summary.tests,
      whatCouldBreak: g.whatCouldBreak.slice(0, 30),
      lowRisk: g.lowRiskOnes.slice(0, 30),
      nodesTruncated: g.nodes.length > MAX_NODES,
      nodes: g.nodes.slice(0, MAX_NODES).map((n) => ({
        path: n.path,
        category: n.category,
        impact: n.impact,
        confidence: n.confidence,
        reasons: n.reasons.slice(0, 4),
        dependents: n.dependents.slice(0, 10),
      })),
    },
    plan: r.plan,
    ...(r.outcome
      ? {
          execution: {
            completed: r.outcome.completed,
            failed: r.outcome.failed,
            blocked: r.outcome.blocked,
            noLlm: r.outcome.noLlm,
            changes: r.outcome.changes.slice(0, 100).map((c) => ({
              path: c.path,
              kind: c.kind,
              linesAdded: c.linesAdded,
              linesRemoved: c.linesRemoved,
              agent: c.agent,
              reason: c.reason,
              risk: c.risk,
            })),
          },
        }
      : {}),
    ...(r.testResult
      ? {
          tests: {
            command: r.testResult.command,
            ...(r.testResult.after ? { after: r.testResult.after } : {}),
            regression: r.testResult.regression,
            failedTests: r.testResult.failedTests.slice(0, 20),
            stdoutTail: r.testResult.truncatedStdout.slice(-4000),
          },
        }
      : {}),
    ...(r.security
      ? {
          security: {
            blocked: r.security.blocked,
            summary: r.security.summary,
            findingsTruncated: r.security.findings.length > MAX_FINDINGS,
            findings: r.security.findings.slice(0, MAX_FINDINGS).map((f) => ({
              severity: f.severity,
              title: f.title,
              ...(f.file ? { file: f.file } : {}),
              category: f.category,
            })),
          },
        }
      : {}),
    ...(r.codeReview
      ? {
          codeReview: {
            score: r.codeReview.score,
            passed: r.codeReview.passed,
            summary: r.codeReview.summary,
            findingsTruncated: r.codeReview.findings.length > MAX_FINDINGS,
            findings: r.codeReview.findings.slice(0, MAX_FINDINGS).map((f) => ({
              severity: f.severity,
              title: f.title,
              ...(f.file ? { file: f.file } : {}),
            })),
          },
        }
      : {}),
    ...(r.release
      ? {
          release: {
            status: r.release.status,
            checks: r.release.checks,
            blockedBy: r.release.blockedBy,
          },
        }
      : {}),
    deviations: r.deviations,
    errors: r.errors,
  };
}

/* ------------------------------------------------------------------ */
/* Manager cache (one per workspace; jobs must survive across requests) */
/* ------------------------------------------------------------------ */

const managers = new Map<string, DemoManager>();

export function getDemoManager(workspace?: string): DemoManager {
  const dir = resolveDemoWorkspace(workspace);
  let m = managers.get(dir);
  if (!m) {
    m = new DemoManager(dir);
    managers.set(dir, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Capability status for the UI banner                                  */
/* ------------------------------------------------------------------ */

export interface DemoStatus {
  ok: true;
  demoRepository: string;
  demoDescription: string;
  defaultRequest: string;
  workspaceReady: boolean;
  providerConfigured: boolean;
  cloneEnabled: boolean;
  llmNote: string;
}

export function getDemoStatus(manager: DemoManager): DemoStatus {
  const providerConfigured = hasProviderConfigured();
  return {
    ok: true,
    demoRepository: DEMO_PROJECT,
    demoDescription: DEMO_DESCRIPTIONS[DEMO_PROJECT],
    defaultRequest: DEMO_REQUESTS[DEMO_PROJECT],
    workspaceReady: existsSync(manager.workspace),
    providerConfigured,
    cloneEnabled: cloneAllowed(),
    llmNote: providerConfigured
      ? "An LLM provider is configured on this server: approving the plan will run the real agent implementation."
      : "No LLM provider is configured on this server: the agent implementation step will be honestly skipped (nothing fabricated). Analysis, planning, tests, security, review and the release gate still run for real.",
  };
}

/* ------------------------------------------------------------------ */
/* Serializers for the API (strip server-local absolute paths)         */
/* ------------------------------------------------------------------ */

function publicAnalysis(rec: AnalysisRecord): Record<string, unknown> {
  const ws = dirname(rec.repoDir);
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") return v.split(rec.repoDir).join(`<workspace>/${rec.repository}`).split(ws).join("<workspace>");
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = scrub(val);
      return out;
    }
    return v;
  };
  return {
    analysisId: rec.id,
    repository: rec.repository,
    isDemo: rec.isDemo,
    request: rec.request,
    riskTolerance: rec.riskTolerance,
    createdAt: rec.createdAt,
    analysis: scrub({ ...rec.analysis, nodes: rec.analysis.nodes.slice(0, MAX_NODES) }),
    analysisTruncated: rec.analysis.nodes.length > MAX_NODES,
    impact: scrub(rec.graph),
    plan: scrub(rec.plan),
  };
}

export function serializeAnalysis(rec: AnalysisRecord): Record<string, unknown> {
  return publicAnalysis(rec);
}

export function serializeJob(job: DemoJob): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    request: job.request,
    repository: job.repository,
    isDemo: job.isDemo,
    stages: job.stages,
    events: job.events.slice(-120),
    eventCount: job.events.length,
    createdAt: job.createdAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.noLlm !== undefined ? { noLlm: job.noLlm } : {}),
  };
}
