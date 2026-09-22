import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoAnalysis, TestResult, TestSelection } from "./model";
import { analyzeRepository } from "./analyzer";
import { Terminal } from "../terminal/terminal";

export interface TestRunInput {
  root: string;
  touchedPaths: string[];
  analysis: RepoAnalysis;
  previousResult?: { pass: number; fail: number } | undefined;
  before?: { total: number; passed: number; failed: number } | undefined;
}

class TestHangError extends Error {}

function npmBinAvailable(root: string, name: string): boolean {
  const local = join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
  if (existsSync(local)) return true;
  const pkg = join(root, "node_modules", name);
  if (existsSync(pkg)) return true;
  return false;
}

function stripExt(p: string): string {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

export type BuildFailureReason = "missing-node-modules" | "build-failed";

export interface BuildValidity {
  /** Whether the project builds. Projects with no build setup at all count as valid. */
  ok: boolean;
  /**
   * Why the build is not OK — kept distinct so QA reporting can tell
   * "missing node_modules" apart from "build failed".
   */
  reason?: BuildFailureReason;
  /** The build command that was evaluated, if the project has any build setup. */
  command?: string;
  stdout: string;
}

export type BuildCommandRunner = (cmd: string) => Promise<{ ok: boolean; stdout: string }>;

function readPackageScripts(root: string): Record<string, string> | undefined {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    return data.scripts;
  } catch {
    return undefined;
  }
}

function defaultBuildRunner(root: string): BuildCommandRunner {
  const term = new Terminal({ cwd: root });
  return async (cmd: string) => {
    const r = await term.run(cmd, { timeoutMs: 240_000, cwd: root });
    return { ok: r.status === "ok", stdout: `$ ${cmd}\n${r.stdout}\n${r.stderr}\n` };
  };
}

/**
 * Validate that the project builds.
 *
 * - When package.json configures a `build` script, that command is run
 *   (dependencies must be installed first).
 * - When there is no configured build but the project is TypeScript
 *   (tsconfig.json present), fall back to `tsc --noEmit`.
 * - Projects with no build setup at all are treated as valid, not failed.
 *
 * Pass a stub `run` in tests to avoid executing real commands.
 */
export async function validateBuild(root: string, run?: BuildCommandRunner): Promise<BuildValidity> {
  const runCmd = run ?? defaultBuildRunner(root);
  const buildScript = readPackageScripts(root)?.["build"];
  if (buildScript) {
    if (!existsSync(join(root, "node_modules"))) {
      return {
        ok: false,
        reason: "missing-node-modules",
        command: "npm run build",
        stdout: "$ npm run build\n[SKIPPED] node_modules not found. Run 'npm install' first.\n",
      };
    }
    const r = await runCmd("npm run build");
    return r.ok
      ? { ok: true, command: "npm run build", stdout: r.stdout }
      : { ok: false, reason: "build-failed", command: "npm run build", stdout: r.stdout };
  }
  if (existsSync(join(root, "tsconfig.json"))) {
    const r = await runCmd("npx tsc --noEmit");
    return r.ok
      ? { ok: true, command: "npx tsc --noEmit", stdout: r.stdout }
      : { ok: false, reason: "build-failed", command: "npx tsc --noEmit", stdout: r.stdout };
  }
  return { ok: true, stdout: "" };
}

export function selectTests(root: string, analysis: RepoAnalysis, touchedPaths: string[]): TestSelection[] {
  const touched = touchedPaths.map((t) => normalizeSep(t));
  const selections: TestSelection[] = [];
  const implByKey = new Map<string, string>();
  for (const n of analysis.nodes) {
    if (n.category === "tests") continue;
    implByKey.set(stripExt(n.id), n.id);
  }

  for (const t of touched) {
    const key = stripExt(t);
    const implPath = implByKey.get(key);
    const implNode = analysis.nodes.find((n) => n.id === (implPath ?? t));
    const tests = implNode?.tests ?? [];
    const testNodes = analysis.nodes.filter((n) => n.category === "tests" && (n.usedIn.includes(t) || n.path.includes(key)));
    const selected = [...new Set([...tests, ...testNodes.map((n) => normalizeSep(n.path))])];
    if (selected.length === 0) continue;
    selections.push({
      node: t,
      reason: tests.length > 0 ? `Directly exercised by ${tests.length} test file(s).` : `Test modules reference '${t}'.`,
      selected,
    });
  }
  return selections;
}

function normalizeSep(p: string): string {
  return p.replace(/\\/g, "/");
}

export function suggestedTestCommand(root: string, selections: TestSelection[], analysis?: RepoAnalysis): string {
  if (existsSync(join(root, "vitest.config.ts")) || existsSync(join(root, "vitest.config.js")) || existsSync(join(root, "vite.config.ts"))) {
    if (!analysis) analysis = analyzeRepository(root);
    const testFiles = [...new Set(selections.flatMap((s) => s.selected))];
    let cmd = "npx vitest run --concurrency 1";
    if (testFiles.length > 0) cmd = `npx vitest run ${testFiles.map((t) => `"${t.replace(/\\/g, "/")}"`).join(" ")} --concurrency 1`;
    return cmd;
  }
  if (existsSync(join(root, "package.json"))) {
    return "npm test -- --run";
  }
  return "";
}

function parsePassFail(stdout: string): { pass: number; fail: number; tests: string[] } {
  const failed: string[] = [];
  const lines = stdout.split(/\r?\n/);
  const scope = lines.filter((l) => /^\s*(tests?|✓|✗)\b/i.test(l) || /tests?\s*:/i.test(l)).join("\n") || stdout;
  const passed = [...scope.matchAll(/(\d+)\s+passed/g)].map((m) => Number(m[1]));
  const failedCount = [...scope.matchAll(/(\d+)\s+failed/g)].map((m) => Number(m[1]));
  // collect FAIL lines
  for (const l of lines) {
    if (/^\s*(FAIL|✗)\s/.test(l) || l.startsWith("FAIL ") || l.startsWith("✗ ")) {
      const parts = l.split(/\s+/);
      const candidate = parts.filter((p) => p.includes("/") || p.endsWith(".ts") || p.endsWith(".js")).pop();
      if (candidate) failed.push(candidate);
    }
  }
  return {
    pass: passed.length > 0 ? passed[passed.length - 1]! : 0,
    fail: failedCount.length > 0 ? failedCount[failedCount.length - 1]! : 0,
    tests: [...new Set(failed)].slice(0, 10),
  };
}

export async function runSelectedTests(input: TestRunInput): Promise<TestResult> {
  const selections = selectTests(input.root, input.analysis, input.touchedPaths);
  const command = suggestedTestCommand(input.root, selections, input.analysis);
  const term = new Terminal({ cwd: input.root, allowList: [...DEFAULT_ALLOW, "npx vitest"] });

  let after: { total: number; passed: number; failed: number } | undefined;
  let stdout = "";
  let failedTests: string[] = [];
  let exitError: string | undefined;

  if (command) {
    if (command.startsWith("npx vitest run") && !npmBinAvailable(input.root, "vitest")) {
      exitError = "vitest is not installed in this repository (node_modules missing). Returning an honest 'not executed' result. Run `npm install` first.";
    } else if (existsSync(join(input.root, "package.json")) && !existsSync(join(input.root, "node_modules")) && command.startsWith("npm test")) {
      exitError = "node_modules are not installed. Returning an honest 'not executed' result. Run `npm install` first.";
    } else {
      try {
        const r = await term.run(command, { timeoutMs: 240_000, cwd: input.root });
        stdout = r.stdout;
        if (r.status !== "ok") exitError = r.stderr.slice(-400);
        const parsed = parsePassFail(stdout);
        const total = parsed.pass + parsed.fail;
        after = { total: total > 0 ? total : parsed.pass, passed: parsed.pass, failed: parsed.fail };
        failedTests = parsed.tests;
        if (r.status !== "ok" && parsed.pass === 0 && parsed.fail === 0) {
          after = { total: 0, passed: 0, failed: 0 };
        }
      } catch (err) {
        if (err instanceof TestHangError) {
          exitError = err.message;
        } else {
          exitError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  const before = input.before;
  const regression =
    !!after &&
    !!before &&
    (after.failed > before.failed || (after.failed === 0 && after.total < before.total));

  const truncStdout = (stdout || exitError || "").slice(-6000);

  return {
    selection: selections,
    command,
    before,
    after,
    executedAt: new Date().toISOString(),
    truncatedStdout: truncStdout,
    regression: regression ?? false,
    failedTests,
  };
}

const DEFAULT_ALLOW = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git add",
  "git commit",
  "git worktree",
  "git checkout",
  "git rev-parse",
  "npm test",
  "npm run",
  "npm ls",
  "node -v",
  "npm -v",
  "tsc --noEmit",
  "vitest run",
  "npx vitest",
  "npm audit",
];

export function formatTestResult(result: TestResult): string {
  const lines: string[] = [];
  lines.push("TEST SELECTION");
  lines.push("--------------");
  for (const sel of result.selection) {
    lines.push(`${sel.node}`);
    lines.push(`  Reason: ${sel.reason}`);
    for (const s of sel.selected) lines.push(`  ✓ ${s}`);
  }
  lines.push("");
  if (result.command) lines.push(`Command: ${result.command}`);
  lines.push("");
  lines.push("RESULTS");
  lines.push("-------");
  if (result.before) lines.push(`Before: ${result.before.total} tests, ${result.before.passed} passed, ${result.before.failed} failed`);
  if (result.after) lines.push(`After:  ${result.after.total} tests, ${result.after.passed} passed, ${result.after.failed} failed`);
  if (result.regression) {
    lines.push("");
    lines.push("REGRESSION DETECTED");
    lines.push(`Failed: ${result.failedTests.join(", ") || "unknown"}`);
  } else if (result.after && result.after.failed > 0) {
    lines.push("RELEASE BLOCKED: failing test(s) present.");
  }
  if (!result.after) {
    // The run never started (no test command, missing node_modules, ...).
    // Report it as blocked instead of silently omitting it.
    lines.push("");
    lines.push("BLOCKED: the test run could not start.");
    const why = (result.truncatedStdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    if (why) lines.push(why);
  }
  if (result.truncatedStdout && result.after && result.after.total === 0) {
    lines.push("Output:");
    lines.push(result.truncatedStdout.slice(-1200));
  }
  return lines.join("\n");
}