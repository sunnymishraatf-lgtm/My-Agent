/**
 * Autonomous AI agent — ReAct loop (Node server only).
 *
 * Flow: UNDERSTAND → ANALYZE → PLAN → (plan approval) → IMPLEMENT
 *       → RUN TESTS → FIX (bounded) → REVIEW → FINAL REPORT
 *
 * The loop prompts the user's chosen LLM through the existing BYOK plumbing
 * (ApiSystem with the request-scoped key — never stored, never logged).
 * The model replies with strict JSON tool calls; the server executes them
 * through the sandboxed tools, pausing for approval on dangerous operations.
 */

import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiSystem } from "../../api/api-manager";
import { configForRequest } from "../byok";
import { listWorkspaceRepos, resolveDemoWorkspace } from "../demo";
import type { Logger } from "../../logger";

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
import {
  TOOL_DEFS,
  ToolError,
  applyPatch,
  deleteFile,
  listFiles,
  readFile,
  runCommand,
  runTests,
  searchText,
  writeFile,
  resolveSafePath,
  type CommandResult,
} from "./tools";
import {
  checkpointExists,
  checkpointFiles,
  listCheckpoint,
  pruneCheckpoint,
  safeRestoreCheckpoint,
  snapshotFiles,
} from "./checkpoints";
import { readSkill, renderSkillIndex } from "./skills";

export type AgentPhase =
  | "understand" | "analyze" | "plan" | "implement"
  | "test" | "fix" | "review" | "report";

export type AgentStatus =
  | "running" | "awaiting-approval" | "completed" | "failed" | "stopped" | "denied";

export interface AgentStep {
  n: number;
  ts: string;
  phase: AgentPhase;
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  resultSummary?: string;
  approvalId?: string;
  error?: string;
}

export interface AgentApproval {
  id: string;
  kind: "plan" | "tool";
  tool?: string;
  args?: Record<string, unknown>;
  detail: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
}

export interface FileChange {
  path: string;
  kind: "created" | "modified" | "deleted";
  diff?: string;
}

export interface AgentReport {
  summary: string;
  filesChanged: FileChange[];
  tests?: { detected: string | null; exitCode: number | null; tail: string };
  checkpointId: string | null;
  checkpointFiles: string[];
  stepsUsed: number;
  honestNotes: string[];
}

export interface AgentRun {
  id: string;
  goal: string;
  repo: string;
  workspace: string;
  repoRoot: string;
  status: AgentStatus;
  phase: AgentPhase;
  steps: AgentStep[];
  approvals: AgentApproval[];
  createdAt: string;
  finishedAt?: string;
  error?: string;
  report?: AgentReport;
  projectContext?: string;
  autoApproveEdits: boolean;
  // In-memory only — never serialized, never logged:
  apiKey?: string;
  provider?: string;
  model?: string;
  approvedFiles: Set<string>;
  stopFlag: boolean;
  ticking: boolean;
  startedAtMs: number;
  checkpointed: boolean;
  testRounds: number;
  planRejections: number;
  changes: FileChange[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  malformedStrikes: number;
  testNudgeSent: boolean;
  activeChild?: ChildProcess;
}

export const MAX_STEPS = 25;
export const MAX_RUN_MS = 30 * 60 * 1000;
export const MAX_FIX_ROUNDS = 3;
const MAX_CONCURRENT_RUNS = 2;

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

class AgentManager {
  readonly workspace: string;
  private runs = new Map<string, AgentRun>();

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  create(opts: {
    goal: string;
    repo: string;
    workspace: string;
    apiKey?: string;
    provider?: string;
    model?: string;
    projectContext?: string;
    autoApproveEdits?: boolean;
  }): AgentRun {
    const goal = (opts.goal || "").trim();
    if (!goal) throw new AgentHttpError(400, "A goal is required.");
    if (goal.length > 4000) throw new AgentHttpError(400, "Goal is too long (max 4000 chars).");
    const repos = listWorkspaceRepos(opts.workspace);
    const match = repos.find((r) => r.name === opts.repo);
    if (!match) throw new AgentHttpError(400, `Unknown repository: ${opts.repo}`);
    let active = 0;
    for (const r of this.runs.values()) {
      if (r.status === "running" || r.status === "awaiting-approval") active++;
    }
    if (active >= MAX_CONCURRENT_RUNS) {
      throw new AgentHttpError(429, `Too many agent runs active (max ${MAX_CONCURRENT_RUNS}). Try again shortly.`);
    }
    const run: AgentRun = {
      id: randomUUID(),
      goal,
      repo: match.name,
      workspace: opts.workspace,
      repoRoot: resolveSafePath(opts.workspace, match.name),
      status: "running",
      phase: "understand",
      steps: [],
      approvals: [],
      createdAt: new Date().toISOString(),
      autoApproveEdits: opts.autoApproveEdits === true,
      apiKey: opts.apiKey,
      provider: opts.provider,
      model: opts.model,
      projectContext: (opts.projectContext || "").slice(0, 6000) || undefined,
      approvedFiles: new Set(),
      stopFlag: false,
      ticking: false,
      startedAtMs: Date.now(),
      checkpointed: false,
      testRounds: 0,
      planRejections: 0,
      changes: [],
      history: [],
      malformedStrikes: 0,
      testNudgeSent: false,
    };
    this.runs.set(run.id, run);
    if (this.runs.size > 50) {
      // Prune oldest terminal runs; the live map is bounded.
      const terminal = [...this.runs.values()].filter((r) => isTerminal(r.status));
      terminal.sort((a, b) => (a.finishedAt || "").localeCompare(b.finishedAt || ""));
      for (const t of terminal.slice(0, terminal.length - 20)) {
        pruneCheckpoint(t.repoRoot, t.id);
        this.runs.delete(t.id);
      }
    }
    void tickLoop(run).catch((e) => failRun(run, e instanceof Error ? e.message : String(e)));
    return run;
  }

  get(id: string): AgentRun {
    const run = this.runs.get(id);
    if (!run) throw new AgentHttpError(404, "Agent run not found.");
    return run;
  }

  /** Newest-first run summaries for the universal search palette. Bounded. */
  list(): Array<{ id: string; goal: string; repo: string; status: string; createdAt: string; finishedAt: string | null }> {
    return [...this.runs.values()]
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 50)
      .map((r) => ({
        id: r.id,
        goal: r.goal,
        repo: r.repo,
        status: r.status,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt ?? null,
      }));
  }

  stop(id: string): AgentRun {
    const run = this.get(id);
    if (!isTerminal(run.status)) {
      run.stopFlag = true;
      try { run.activeChild?.kill("SIGKILL"); } catch { /* best-effort */ }
      if (!run.ticking) {
        run.status = "stopped";
        run.finishedAt = new Date().toISOString();
        pushStep(run, { phase: run.phase, thought: "Stopped by the user." });
      }
    }
    return run;
  }

  decide(id: string, approvalId: string, approved: boolean): AgentRun {
    const run = this.get(id);
    const ap = run.approvals.find((a) => a.id === approvalId);
    if (!ap) throw new AgentHttpError(404, "Approval not found.");
    if (ap.status !== "pending") throw new AgentHttpError(409, "Approval already decided.");
    if (run.status !== "awaiting-approval") throw new AgentHttpError(409, "Run is not awaiting approval.");
    ap.status = approved ? "approved" : "rejected";
    ap.decidedAt = new Date().toISOString();
    pushStep(run, {
      phase: run.phase,
      thought: approved ? `Approved: ${ap.detail}` : `Rejected by user: ${ap.detail}`,
    });
    run.history.push({
      role: "user",
      content: approved
        ? `APPROVAL GRANTED for: ${ap.detail}. Continue.`
        : `APPROVAL DENIED for: ${ap.detail}. Do not attempt it again; find another way or revise the plan.`,
    });
    if (ap.kind === "plan" && !approved) {
      run.planRejections++;
      if (run.planRejections > 1) {
        run.status = "denied";
        run.finishedAt = new Date().toISOString();
        run.error = "Plan rejected twice by the user. Run ended.";
        return run;
      }
      run.phase = "plan"; // revise and ask again
    }
    if (ap.kind === "plan" && approved) {
      // Plan approved → enter IMPLEMENT. The checkpoint was snapshotted when
      // the plan was proposed; lazy per-file snapshotting covers the rest.
      run.phase = "implement";
      run.history.push({
        role: "user",
        content: "Plan approved. Now IMPLEMENT: make small incremental edits with write_file/apply_patch.",
      });
      pushStep(run, { phase: "implement", thought: "Plan approved — starting implementation." });
    }
    if (ap.kind === "tool" && approved && ap.tool && (ap.tool === "write_file" || ap.tool === "apply_patch")) {
      const p = typeof ap.args?.path === "string" ? ap.args.path : null;
      if (p) run.approvedFiles.add(p);
    }
    run.status = "running";
    void tickLoop(run).catch((e) => failRun(run, e instanceof Error ? e.message : String(e)));
    return run;
  }
}

const managers = new Map<string, AgentManager>();
export function getAgentManager(workspace?: string): AgentManager {
  const dir = resolveDemoWorkspace(workspace);
  let m = managers.get(dir);
  if (!m) {
    m = new AgentManager(dir);
    managers.set(dir, m);
  }
  return m;
}

export type { AgentManager };

export class AgentHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentHttpError";
    this.status = status;
  }
}

function isTerminal(s: AgentStatus): boolean {
  return s === "completed" || s === "failed" || s === "stopped" || s === "denied";
}

function pushStep(run: AgentRun, s: Omit<AgentStep, "n" | "ts">): AgentStep {
  const step: AgentStep = { n: run.steps.length + 1, ts: new Date().toISOString(), ...s };
  run.steps.push(step);
  return step;
}

function failRun(run: AgentRun, message: string): void {
  if (isTerminal(run.status)) return;
  run.status = "failed";
  run.error = message.slice(0, 2000);
  run.finishedAt = new Date().toISOString();
  pushStep(run, { phase: run.phase, error: run.error });
}

/* ------------------------------------------------------------------ */
/* Serialization (client-safe: no key, capped outputs)                 */
/* ------------------------------------------------------------------ */

const STEP_SUMMARY_CAP = 600;

export function serializeRun(run: AgentRun): Record<string, unknown> {
  return {
    id: run.id,
    goal: run.goal,
    repo: run.repo,
    status: run.status,
    phase: run.phase,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? null,
    error: run.error ?? null,
    stepsUsed: run.steps.length,
    maxSteps: MAX_STEPS,
    elapsedMs: Date.now() - run.startedAtMs,
    autoApproveEdits: run.autoApproveEdits,
    steps: run.steps.slice(-60).map((s) => ({
      n: s.n,
      ts: s.ts,
      phase: s.phase,
      thought: s.thought,
      tool: s.tool,
      args: s.args ? sanitizeArgs(s.args) : undefined,
      resultSummary: s.resultSummary ? s.resultSummary.slice(0, STEP_SUMMARY_CAP) : undefined,
      approvalId: s.approvalId,
      error: s.error,
    })),
    approvals: run.approvals.map((a) => ({
      id: a.id,
      kind: a.kind,
      tool: a.tool,
      args: a.args ? sanitizeArgs(a.args) : undefined,
      detail: a.detail,
      status: a.status,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt ?? null,
    })),
    report: run.report ?? null,
  };
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(args)) {
    const v = args[k];
    if (typeof v === "string" && v.length > 2000) out[k] = v.slice(0, 2000) + "…[truncated]";
    else out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ReAct loop                                                          */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(run: AgentRun): string {
  const tools = TOOL_DEFS.map(
    (t) => `- ${t.name}${t.args}: ${t.description}`,
  ).join("\n");
  const skillIndex = renderSkillIndex();
  return [
    `You are NEUTRON Agent, an autonomous coding agent. Repository: "${run.repo}".`,
    `Goal: ${run.goal}`,
    run.projectContext ? `Project context:\n${run.projectContext}` : "",
    "",
    "Work in phases: understand → analyze → plan → implement → test → fix → review → report.",
    `Current phase: ${run.phase}. Phase rules:`,
    "- understand/analyze: ONLY read_file, list_files, search_text. Build a mental model.",
    "- plan: produce a concrete numbered plan, then reply phase_done with {\"plan\": [...], \"files\": [\"paths you will touch\"]}.",
    "- implement: make small incremental edits with write_file/apply_patch. Do not refactor unrelated code.",
    "- test: call run_tests once. fix: address failures (max 3 rounds), then test again.",
    "- review: re-read your diffs (use read_file on changed files) and check for mistakes.",
    "- report: reply done with a summary.",
    "",
    "Tools:",
    tools,
    "",
    ...(skillIndex
      ? [
          skillIndex,
          "",
          "When a task matches a listed skill, call read_skill with {\"name\": \"<skill-name>\"} first and follow its playbook.",
          "",
        ]
      : []),
    "Reply with EXACTLY ONE JSON object per message, no markdown fences, no prose:",
    `{"thought": "short reasoning", "tool": "<name>", "args": {...}}`,
    `{"thought": "...", "phase_done": true, "plan": [...], "files": [...]}`,
    `{"thought": "...", "done": true, "summary": "..."}`,
    "Keep thoughts to one sentence. Never invent tool results.",
  ].filter(Boolean).join("\n");
}

interface ModelReply {
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  phase_done?: boolean;
  plan?: unknown;
  files?: unknown;
  done?: boolean;
  summary?: string;
}

export function parseModelReply(text: string): ModelReply {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ToolError("BAD_REPLY", "Model reply contained no JSON object.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ToolError("BAD_REPLY", "Model reply was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new ToolError("BAD_REPLY", "Model reply was not a JSON object.");
  return parsed as ModelReply;
}

async function callModel(run: AgentRun): Promise<string> {
  const api = new ApiSystem({ config: configForRequest(run.apiKey, run.provider), logger: silentLogger });
  const messages = [
    { role: "system" as const, content: buildSystemPrompt(run) },
    ...run.history.slice(-12).map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 8000) })),
  ];
  const res = await api.chat("general", messages, {
    ...(run.model ? { model: run.model } : {}),
    ...(run.provider ? { provider: run.provider } : {}),
  });
  return res.text;
}

const TOOL_RESULT_CAP = 6000;

function summarizeResult(tool: string, result: unknown): string {
  let s: string;
  if (typeof result === "string") s = result;
  else {
    try { s = JSON.stringify(result); } catch { s = String(result); }
  }
  if (s.length > TOOL_RESULT_CAP) s = s.slice(0, TOOL_RESULT_CAP) + "\n…[truncated]";
  return s;
}

async function tickLoop(run: AgentRun): Promise<void> {
  if (run.ticking) return;
  run.ticking = true;
  try {
    while (run.status === "running" && !run.stopFlag) {
      if (run.steps.length >= MAX_STEPS) {
        failRun(run, `Step budget exhausted (${MAX_STEPS} steps). Stopping honestly — the work so far is preserved.`);
        break;
      }
      if (Date.now() - run.startedAtMs > MAX_RUN_MS) {
        failRun(run, "Run time limit (30 minutes) reached.");
        break;
      }
      const paused = await tick(run);
      if (paused) break; // awaiting approval — decide() resumes
    }
    if (run.stopFlag && !isTerminal(run.status)) {
      run.status = "stopped";
      run.finishedAt = new Date().toISOString();
      pushStep(run, { phase: run.phase, thought: "Stopped by the user." });
    }
  } finally {
    run.ticking = false;
  }
}

/** One ReAct step. Returns true when the loop paused for approval. */
async function tick(run: AgentRun): Promise<boolean> {
  let raw: string;
  try {
    raw = await callModel(run);
  } catch (e) {
    failRun(run, e instanceof Error ? e.message : String(e));
    return false;
  }
  run.history.push({ role: "assistant", content: raw.slice(0, 8000) });

  let reply: ModelReply;
  try {
    reply = parseModelReply(raw);
  } catch {
    run.malformedStrikes++;
    if (run.malformedStrikes >= 2) {
      failRun(run, "The model repeatedly replied with invalid JSON. Stopping rather than guessing tool calls.");
      return false;
    }
    run.history.push({ role: "user", content: "Your last reply was not a valid JSON object. Reply with EXACTLY ONE JSON object: {\"thought\": \"...\", \"tool\": \"...\", \"args\": {...}} or phase_done/done." });
    pushStep(run, { phase: run.phase, thought: reply_thought_safe(raw), error: "Invalid JSON reply — asked the model to retry." });
    return false;
  }
  run.malformedStrikes = 0;
  const thought = typeof reply.thought === "string" ? reply.thought.slice(0, 500) : undefined;

  if (reply.done === true) {
    // Guard the required flow: files changed but tests never ran → nudge once.
    const earlyPhases: AgentPhase[] = ["understand", "analyze", "plan", "implement"];
    if (
      earlyPhases.includes(run.phase) &&
      run.changes.length > 0 &&
      !run.report?.tests &&
      !run.testNudgeSent
    ) {
      run.testNudgeSent = true;
      run.history.push({
        role: "user",
        content: "You changed files but have not run the test suite. Call run_tests now, or reply done again with a one-sentence explanation of why tests do not apply.",
      });
      pushStep(run, { phase: run.phase, thought, error: "Nudged to run tests before finishing." });
      return false;
    }
    finishRun(run, typeof reply.summary === "string" ? reply.summary : "Done.");
    return false;
  }

  if (reply.phase_done === true) {
    return advancePhase(run, reply, thought);
  }

  if (typeof reply.tool === "string") {
    return executeToolStep(run, reply.tool, reply.args, thought);
  }

  run.history.push({ role: "user", content: "Your reply matched no action (need \"tool\", \"phase_done\", or \"done\"). Try again with a valid JSON action." });
  pushStep(run, { phase: run.phase, thought, error: "Reply matched no action." });
  return false;
}

function reply_thought_safe(raw: string): string {
  return raw.slice(0, 200);
}

/** Returns true when the loop paused for approval. */
function advancePhase(run: AgentRun, reply: ModelReply, thought?: string): boolean {
  const order: AgentPhase[] = ["understand", "analyze", "plan", "implement", "test", "fix", "review", "report"];
  const idx = order.indexOf(run.phase);
  pushStep(run, { phase: run.phase, thought: thought || `Phase ${run.phase} complete.` });

  if (run.phase === "plan") {
    // Plan approval gate: show the plan, wait for the user.
    const plan = Array.isArray(reply.plan) ? reply.plan.map(String).slice(0, 30) : [];
    const files = Array.isArray(reply.files) ? reply.files.map(String).slice(0, 50) : [];
    const ap: AgentApproval = {
      id: randomUUID(),
      kind: "plan",
      detail: `Plan for "${run.goal.slice(0, 120)}":\n` + plan.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      args: { plan, files },
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    run.approvals.push(ap);
    run.status = "awaiting-approval";
    pushStep(run, { phase: run.phase, thought: "Plan proposed — waiting for user approval.", approvalId: ap.id });
    run.history.push({ role: "user", content: "Plan submitted for approval. Wait for the user's decision." });
    // Snapshot the planned files eagerly so nothing is lost even before edits.
    try {
      const r = snapshotFiles(run.repoRoot, run.id, files);
      run.checkpointed = r.snapshotted.length > 0 || files.length > 0;
    } catch { /* checkpoint is best-effort; lazy snapshot covers the rest */ }
    return true;
  }

  if (run.phase === "test") {
    // test → review (tests were run via the run_tests tool inside this phase)
    run.phase = "review";
    run.history.push({ role: "user", content: "Testing phase done. Now REVIEW: re-read the files you changed and check for mistakes, then reply done with your final summary." });
    return false;
  }

  if (run.phase === "review" || run.phase === "report") {
    finishRun(run, thought || "Review complete.");
    return false;
  }

  const next: AgentPhase = order[Math.min(idx + 1, order.length - 1)] as AgentPhase;
  run.phase = next;
  const hints: Record<AgentPhase, string> = {
    understand: "",
    analyze: "Analyze the code relevant to the goal. Use read_file, list_files, search_text.",
    plan: "",
    implement: "Implement the approved plan with small incremental edits (write_file/apply_patch). A checkpoint was taken before you started.",
    test: "Run the test suite now with the run_tests tool.",
    fix: "Fix the test failures, then call run_tests again.",
    review: "Re-read your changed files and check for mistakes.",
    report: "",
  };
  run.history.push({ role: "user", content: `Phase advanced to ${next}. ${hints[next]}` });
  return false;
}

/** Minimal run factory for tests (not a real run — no LLM, no workspace). */
export function makeTestRun(overrides?: Partial<AgentRun>): AgentRun {
  return {
    id: "test-run",
    goal: "test goal",
    repo: "test-repo",
    workspace: "/tmp",
    repoRoot: "/tmp/test-repo",
    status: "running",
    phase: "implement",
    steps: [],
    approvals: [],
    createdAt: new Date().toISOString(),
    autoApproveEdits: false,
    approvedFiles: new Set<string>(),
    stopFlag: false,
    ticking: false,
    startedAtMs: Date.now(),
    checkpointed: false,
    testRounds: 0,
    planRejections: 0,
    changes: [],
    history: [],
    malformedStrikes: 0,
    testNudgeSent: false,
    ...overrides,
  };
}

/** Pure approval-gating decision, exported for tests. */
export function toolNeedsApproval(run: AgentRun, tool: string, args: Record<string, unknown>): boolean {
  const def = TOOL_DEFS.find((t) => t.name === tool);
  if (!def) return true; // unknown tools are never executed
  return (
    def.approval === "always" ||
    (def.approval === "per-file" && !run.autoApproveEdits &&
      !run.approvedFiles.has(String((args as Record<string, unknown>).path || "")))
  );
}

/** Returns true when the loop paused for approval. */
async function executeToolStep(
  run: AgentRun, tool: string, rawArgs: unknown, thought?: string,
): Promise<boolean> {
  const def = TOOL_DEFS.find((t) => t.name === tool);
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  if (!def) {
    const msg = `Unknown tool "${tool}". Available: ${TOOL_DEFS.map((t) => t.name).join(", ")}.`;
    run.history.push({ role: "user", content: msg });
    pushStep(run, { phase: run.phase, thought, tool, args, error: msg });
    return false;
  }
  // Phase discipline: read-only tools in understand/analyze; no edits before implement.
  if ((run.phase === "understand" || run.phase === "analyze") && def.approval !== "none") {
    const msg = `Tool "${tool}" is not allowed in the ${run.phase} phase yet — finish analysis and propose a plan first.`;
    run.history.push({ role: "user", content: msg });
    pushStep(run, { phase: run.phase, thought, tool, args, error: msg });
    return false;
  }

  if (toolNeedsApproval(run, tool, args)) {
    const ap: AgentApproval = {
      id: randomUUID(),
      kind: "tool",
      tool,
      args,
      detail: describeToolCall(tool, args),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    run.approvals.push(ap);
    run.status = "awaiting-approval";
    pushStep(run, { phase: run.phase, thought, tool, args, approvalId: ap.id });
    run.history.push({ role: "user", content: `Approval requested for: ${ap.detail}. Wait for the user's decision.` });
    return true;
  }
  if (def.approval === "per-file" && typeof args.path === "string") run.approvedFiles.add(args.path);

  try {
    const result = await runTool(run, tool, args);
    const summary = summarizeResult(tool, result);
    run.history.push({ role: "user", content: `Result of ${tool}:\n${summary}` });
    pushStep(run, { phase: run.phase, thought, tool, args, resultSummary: summary });
    afterTool(run, tool, args, result);
  } catch (e) {
    const msg = e instanceof ToolError ? `[${e.code}] ${e.message}` : (e instanceof Error ? e.message : String(e));
    run.history.push({ role: "user", content: `Tool ${tool} failed: ${msg}` });
    pushStep(run, { phase: run.phase, thought, tool, args, error: msg.slice(0, 1000) });
  }
  return false;
}

function describeToolCall(tool: string, args: Record<string, unknown>): string {
  const p = typeof args.path === "string" ? args.path : "";
  switch (tool) {
    case "write_file": return `Write file ${p}`;
    case "apply_patch": return `Apply patch to ${p}`;
    case "delete_file": return `Delete file ${p}`;
    case "run_command": return `Run command: ${String(args.cmd || "").slice(0, 200)}`;
    case "run_tests": return "Run the repository test suite";
    default: return `${tool}`;
  }
}

async function runTool(run: AgentRun, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const root = run.repoRoot;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (tool) {
    case "read_file": return readFile(root, str(args.path));
    case "list_files": return listFiles(root, typeof args.glob === "string" ? args.glob : "**/*");
    case "search_text": return searchText(root, str(args.query), typeof args.dir === "string" ? args.dir : ".");
    case "write_file": return writeFile(root, str(args.path), str(args.content));
    case "apply_patch": return applyPatch(root, str(args.path), str(args.diff));
    case "delete_file": return deleteFile(root, str(args.path));
    case "run_command": {
      const p = runCommand(root, str(args.cmd), typeof args.cwd === "string" ? args.cwd : ".", {
        onChild: (c) => { run.activeChild = c; },
      });
      // Clear the handle when the command settles so Stop only kills live ones.
      return p.finally(() => { run.activeChild = undefined; });
    }
    case "run_tests": return runTests(root);
    case "read_skill": return readSkill(str(args.name));
    default: throw new ToolError("UNKNOWN_TOOL", `Unknown tool: ${tool}`);
  }
}

/** Post-tool bookkeeping: diffs, change list, test-phase transitions. */
function afterTool(run: AgentRun, tool: string, args: Record<string, unknown>, result: unknown): void {
  const path = typeof args.path === "string" ? args.path : "";
  if (tool === "write_file" || tool === "apply_patch") {
    // Lazy checkpoint: snapshot the original before the first mutation.
    if (!run.checkpointed) {
      try { snapshotFiles(run.repoRoot, run.id, [path]); } catch { /* best-effort */ }
      run.checkpointed = true;
    } else {
      try {
        const existing = new Set(checkpointFiles(run.repoRoot, run.id));
        if (!existing.has(path)) snapshotFiles(run.repoRoot, run.id, [path]);
      } catch { /* best-effort */ }
    }
    recordChange(run, path, result, tool);
  } else if (tool === "delete_file") {
    run.changes.push({ path, kind: "deleted" });
  } else if (tool === "run_tests") {
    const r = result as CommandResult & { detected: { kind: string } | null };
    const tail = (r.stdout + "\n" + r.stderr).slice(-2000);
    run.report = {
      ...(run.report as AgentReport),
      summary: run.report?.summary || "",
      filesChanged: run.changes,
      tests: { detected: r.detected ? r.detected.kind : null, exitCode: r.exitCode, tail },
      checkpointId: checkpointExists(run.repoRoot, run.id) ? run.id : null,
      checkpointFiles: checkpointFiles(run.repoRoot, run.id),
      stepsUsed: run.steps.length,
      honestNotes: run.report?.honestNotes || [],
    };
    if (r.detected && r.exitCode !== 0 && run.testRounds < MAX_FIX_ROUNDS) {
      run.testRounds++;
      run.phase = "fix";
      run.history.push({
        role: "user",
        content: `Tests FAILED (exit ${r.exitCode}). Fix round ${run.testRounds}/${MAX_FIX_ROUNDS}. Failure output:\n${tail}\nFix the failures with small edits, then run run_tests again.`,
      });
      pushStep(run, { phase: "test", thought: `Tests failed — entering fix round ${run.testRounds}.` });
    } else if (r.detected && r.exitCode === 0) {
      run.history.push({ role: "user", content: "Tests passed. Move to review: re-read your changed files and check for mistakes." });
    } else if (!r.detected) {
      run.history.push({ role: "user", content: "No test command was detected in this repo. Note that honestly in your final summary and continue to review." });
    }
  }
}

function recordChange(run: AgentRun, path: string, result: unknown, tool: string): void {
  // Build a compact diff: compare current file content against the
  // checkpoint snapshot (the pre-edit original).
  let oldText = "";
  try {
    const files = listCheckpoint(run.repoRoot, run.id);
    const entry = files.find((f) => f.path === path);
    if (entry?.existed) {
      const bak = join(run.repoRoot, ".agent", "checkpoints", run.id, path + ".bak");
      if (existsSync(bak)) oldText = readFileSync(bak, "utf8");
    }
  } catch { /* diff is best-effort */ }
  let newText = "";
  try { newText = readFile(run.repoRoot, path).content; } catch { /* deleted or unreadable */ }
  const existedBefore = oldText.length > 0;
  const diff = compactDiff(oldText, newText, 60);
  const existing = run.changes.find((c) => c.path === path);
  const change: FileChange = {
    path,
    kind: !existedBefore ? "created" : "modified",
    diff,
  };
  if (existing) Object.assign(existing, change);
  else run.changes.push(change);
  void result; void tool;
}

/** Compact line diff via common prefix/suffix trimming. Honest and small. */
export function compactDiff(oldText: string, newText: string, maxLines: number): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const removed = a.slice(pre, a.length - suf);
  const added = b.slice(pre, b.length - suf);
  if (!removed.length && !added.length) return "(no changes)";
  const out: string[] = [];
  let omitted = 0;
  for (const l of removed) {
    if (out.length >= maxLines) { omitted += removed.length + added.length - out.length; break; }
    out.push("- " + l);
  }
  for (const l of added) {
    if (out.length >= maxLines) { omitted += added.length - (out.length - Math.min(removed.length, maxLines)); break; }
    out.push("+ " + l);
  }
  if (omitted > 0) out.push(`… (+${omitted} more lines)`);
  return out.join("\n");
}

function finishRun(run: AgentRun, summary: string): void {
  run.status = "completed";
  run.finishedAt = new Date().toISOString();
  const honestNotes = [...(run.report?.honestNotes || [])];
  if (run.changes.length > 0 && !run.report?.tests) {
    honestNotes.push("Tests were not run during this run.");
  }
  if (run.testRounds >= MAX_FIX_ROUNDS && run.report?.tests && run.report.tests.exitCode !== 0) {
    honestNotes.push(`Test failures persisted after ${MAX_FIX_ROUNDS} fix rounds.`);
  }
  run.report = {
    summary: summary.slice(0, 4000),
    filesChanged: run.changes,
    tests: run.report?.tests,
    checkpointId: checkpointExists(run.repoRoot, run.id) ? run.id : null,
    checkpointFiles: checkpointFiles(run.repoRoot, run.id),
    stepsUsed: run.steps.length,
    honestNotes,
  };
  pushStep(run, { phase: "report", thought: "Run completed." });
}

/* ------------------------------------------------------------------ */
/* Checkpoint restore endpoint helper                                  */
/* ------------------------------------------------------------------ */

export function restoreRunCheckpoint(
  runId: string,
  workspace: string,
): { restored: string[]; deleted: string[]; preRestoreId: string; preRestoreLabel: string } {
  const mgr = getAgentManager(workspace);
  const run = mgr.get(runId);
  if (run.status !== "completed" && run.status !== "failed" && run.status !== "stopped") {
    throw new AgentHttpError(409, "Checkpoint can only be restored after the run ends.");
  }
  // Safe restore: a pre-restore snapshot is taken first, so the agent's
  // work is never silently destroyed by the restore itself.
  const res = safeRestoreCheckpoint(run.repoRoot, runId);
  pushStep(run, { phase: run.phase, thought: `Checkpoint restored (${res.restored.length} files, ${res.deleted.length} created files removed). Pre-restore snapshot: ${res.preRestoreId}.` });
  return res;
}
