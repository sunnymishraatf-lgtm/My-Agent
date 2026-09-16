import { BaseAgent } from "./base";
import type { AgentContext, AgentResult, ReviewResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { writeProjectFile } from "../files/project-files";
import { Terminal } from "../terminal/terminal";

export interface TestRunReport {
  pass: number;
  fail: number;
  buildOk: boolean;
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
      issues.push({ severity: "critical", category: "build", title: "Build failed" });
    }

    return {
      status: tests.fail === 0 && tests.buildOk !== false ? "success" : "failed",
      summary: `Tests: ${tests.pass} passed, ${tests.fail} failed; build ${tests.buildOk ? "OK" : "FAILED"}`,
      filesChanged: [file],
      commandsRun: tests.commands,
      testsRun: tests.commands.filter((c) => c.includes("test") || c.includes("build")),
      issues,
      nextActions: tests.fail > 0 ? ["Fix failing tests (see issues)."] : [],
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
    stdout: string;
    commands: string[];
  }> {
    const files = ctx.listDir();
    const hasPkg = files.some((f) => f === "package.json");
    const commands: string[] = [];
    let pass = 0;
    let fail = 0;
    let stdout = "";

    if (hasPkg) {
      commands.push("npm run build", "npm test -- --run");
    }

    const term = new Terminal({ cwd: ctx.root, logger: undefined });
    let buildOk = true;
    for (const cmd of commands) {
      const r = await term.run(cmd, { timeoutMs: 180_000 });
      stdout += `$ ${cmd}\n${r.stdout}\n${r.stderr}\n`;
      if (r.status !== "ok") buildOk = false;
      const counts = parseTestOutput(r.stdout);
      pass += counts.pass;
      fail += counts.fail;
    }

    const counts = parseTestOutput(stdout);
    return { pass: counts.pass || pass, fail: counts.fail || fail, buildOk, stdout, commands };
  }
}

function buildTestReport(t: { pass: number; fail: number; buildOk: boolean; stdout: string }): string {
  return [
    "# Test Results",
    "",
    `Passed: ${t.pass}`,
    `Failed: ${t.fail}`,
    `Build: ${t.buildOk ? "OK" : "FAILED"}`,
    "",
    "## Output",
    "",
    "```",
    t.stdout.slice(-4000),
    "```",
  ].join("\n");
}