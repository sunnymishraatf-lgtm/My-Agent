import { BaseAgent } from "./base";
import type { AgentContext, AgentResult, ReviewResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { writeProjectFile } from "../files/project-files";
import { Terminal } from "../terminal/terminal";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateBuild, suggestedTestCommand, type BuildFailureReason } from "../neutron/test-runner";

export interface TestRunReport {
  pass: number;
  fail: number;
  buildOk: boolean;
  /** Why the build is not OK — "missing node_modules" vs "build failed" are distinct. */
  buildReason?: BuildFailureReason;
  /** The build command that was evaluated, if the project has any build setup. */
  buildCommand?: string;
  /** Set when the test run could not start at all (must be reported, not omitted). */
  blocked?: string;
  stdout: string;
}

export function parseTestOutput(stdout: string): { pass: number; fail: number } {
  const lines = stdout.split(/\r?\n/);
  const testLines = lines.filter((l) => /^\s*(tests?|✓|✗)\b/i.test(l) || /tests?\s*:/i.test(l));
  const scope = testLines.length > 0 ? testLines.join("\n") : stdout;
  const passed = [...scope.matchAll(/(\d+)\s+passed/g)].map((m) => Number(m[1]));
  const failed = [...scope.matchAll(/(\d+)\s+failed/g)].map((m) => Number(m[1]));
  return {
    pass: passed.length > 0 ? passed[passed.length - 1]! : 0,
    fail: failed.length > 0 ? failed[failed.length - 1]! : 0,
  };
}

export class QAAgent extends BaseAgent {
  constructor() {
    super({ id: "qa", role: "qa", label: "QA", promptsKey: "qa" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const tests = await this.detectAndRunTests(ctx);
    const file = ".agent/test-results.md";
    const report = buildTestReport(tests);
    writeProjectFile(ctx.root, file, report);

    const issues: Issue[] = [];
    if (tests.fail > 0) {
      issues.push({
        severity: "high",
        category: "testing",
        title: `${tests.fail} test(s) failed`,
        detail: tests.stdout.slice(-2000),
      });
    }
    if (tests.buildOk === false) {
      // "missing node_modules" and "build failed" are separate failure reasons.
      if (tests.buildReason === "missing-node-modules") {
        issues.push({
          severity: "high",
          category: "build",
          title: "Build blocked: node_modules not found",
          detail: `The configured build (${tests.buildCommand ?? "npm run build"}) could not run because dependencies are not installed. Run 'npm install' first.`,
          fixRecommendation: "npm install",
        });
      } else {
        issues.push({
          severity: "critical",
          category: "build",
          title: "Build failed",
          detail: tests.stdout.slice(-2000),
        });
      }
    }
    if (tests.blocked) {
      // A run that couldn't start is reported explicitly, never silently omitted.
      issues.push({
        severity: "medium",
        category: "testing",
        title: "Test run blocked",
        detail: tests.blocked,
      });
    }

    const failed = tests.fail > 0 || tests.buildOk === false;
    return {
      status: failed ? "failed" : tests.blocked ? "blocked" : "success",
      summary: `Tests: ${tests.pass} passed, ${tests.fail} failed${tests.blocked ? " (BLOCKED)" : ""}; build ${buildStatusLabel(tests)}`,
      filesChanged: [file],
      commandsRun: tests.commands,
      testsRun: tests.commands.filter((c) => c.includes("test") || c.includes("build")),
      issues,
      nextActions: tests.fail > 0 ? ["Fix failing tests (see issues)."] : tests.blocked ? ["Resolve the blocked test run (see issues)."] : [],
    };
  }

  async review(result: AgentResult, ctx: AgentContext): Promise<ReviewResult> {
    const issues: Issue[] = result.issues ?? [];
    const fail = issues.filter((i) => i.category === "testing" && i.severity === "high").length > 0;
    const build = issues.some((i) => i.category === "build" && i.severity === "critical");
    return {
      passed: !fail && !build,
      score: fail || build ? 40 : 100,
      issues,
      notes: [`Tests passed=${result.testsRun.length > 0} buildOk=${!build}`],
    };
  }

  private async detectAndRunTests(ctx: AgentContext): Promise<{
    pass: number;
    fail: number;
    buildOk: boolean;
    buildReason?: BuildFailureReason;
    buildCommand?: string;
    blocked?: string;
    stdout: string;
    commands: string[];
  }> {
    const files = ctx.listDir();
    const hasPkg = files.some((f) => f === "package.json");
    const commands: string[] = [];
    let pass = 0;
    let fail = 0;
    let stdout = "";
    let blocked: string | undefined;

    const term = new Terminal({ cwd: ctx.root, logger: undefined });
    const runCmd = async (cmd: string): Promise<{ ok: boolean; stdout: string }> => {
      commands.push(cmd);
      const r = await term.run(cmd, { timeoutMs: 180_000 });
      const out = `$ ${cmd}\n${r.stdout}\n${r.stderr}\n`;
      stdout += out;
      const counts = parseTestOutput(r.stdout);
      pass += counts.pass;
      fail += counts.fail;
      return { ok: r.status === "ok", stdout: out };
    };

    // Build validity: configured build script when one exists, else tsc --noEmit
    // for TypeScript projects; projects with no build setup at all count as valid.
    const build = await validateBuild(ctx.root, runCmd);

    if (hasPkg) {
      if (existsSync(join(ctx.root, "node_modules"))) {
        // Use the repo-aware suggested command (e.g. `npx vitest run ...` for
        // vitest projects), falling back to `npm test -- --run` when nothing is suggested.
        const suggested = suggestedTestCommand(ctx.root, []);
        const testCmd = suggested || "npm test -- --run";
        await runCmd(testCmd);
      } else {
        blocked = "node_modules not found — the test run could not start. Run 'npm install' first.";
        stdout += `$ npm test -- --run\n[BLOCKED] ${blocked}\n`;
      }
    } else {
      blocked = "no package.json found — no test command is configured; the test run could not start.";
      stdout += `[BLOCKED] ${blocked}\n`;
    }

    const counts = parseTestOutput(stdout);
    return {
      pass: counts.pass || pass,
      fail: counts.fail || fail,
      buildOk: build.ok,
      buildReason: build.reason,
      buildCommand: build.command,
      blocked,
      stdout,
      commands,
    };
  }
}

export function buildStatusLabel(t: { buildOk: boolean; buildReason?: BuildFailureReason; buildCommand?: string }): string {
  if (t.buildOk) return t.buildCommand ? `OK (${t.buildCommand})` : "OK (no build configured)";
  if (t.buildReason === "missing-node-modules") return "BLOCKED (node_modules not found)";
  return `FAILED${t.buildCommand ? ` (${t.buildCommand})` : ""}`;
}

export function buildTestReport(t: { pass: number; fail: number; buildOk: boolean; buildReason?: BuildFailureReason; buildCommand?: string; blocked?: string; stdout: string }): string {
  return [
    "# Test Results",
    "",
    `Passed: ${t.pass}`,
    `Failed: ${t.fail}`,
    `Build: ${buildStatusLabel(t)}`,
    ...(t.blocked ? [`Tests: BLOCKED — ${t.blocked}`] : []),
    "",
    "## Output",
    "",
    "```",
    t.stdout.slice(-4000),
    "```",
  ].join("\n");
}