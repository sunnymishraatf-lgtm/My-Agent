import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createAgentRegistry } from "../agents/registry";
import { parseDesignSystem, toDesignSystemJson } from "../design/parser";
import { loadConfig, registerSecrets } from "../config";
import { ApiSystem } from "../api/api-manager";
import type { Agent } from "../agents/agent";
import { writeProjectFile } from "../files/project-files";
import { parseTestOutput } from "../agents/qa";
import { Terminal } from "../terminal/terminal";
import { watchCommand } from "./utility-commands";

export async function reviewCommand(root: string): Promise<void> {
  const designText = readFileSafe(join(root, "design.md"));
  const design = designText ? parseDesignSystem(designText) : undefined;
  const designJson = design ? toDesignSystemJson(design) : undefined;
  const config = loadConfig();
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));
  const api = new ApiSystem({ config, logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
  const agent = createAgentRegistry().find((a) => a.role === "reviewer") as Agent | undefined;

  if (!agent) {
    console.log("Reviewer agent not found.");
    process.exitCode = 1;
    return;
  }

  const task = {
    id: "REV-MANUAL",
    agent: "reviewer",
    description: "Review the complete project; produce review.md",
    dependencies: [] as string[],
    priority: "high" as const,
    status: "running" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const term = new Terminal({ cwd: root });

  try {
    const result = await agent.execute(task, {
      root,
      design,
      designJson,
      api,
      log: (m) => console.log(m),
      run: async (cmd) => {
        const r = await term.run(cmd);
        return { status: r.status, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
      },
      readFile: (p) => readFileSafe(join(root, p)),
      writeFile: (p, c) => writeProjectFile(root, p, c),
      listDir: () => {
        try {
          return readdirSync(root);
        } catch {
          return [];
        }
      },
      getApproval: async () => true,
    });

    console.log(result.summary);
    for (const issue of result.issues) {
      console.log(`  [${issue.severity}] ${issue.title}`);
    }
    if (result.status !== "success") {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Review failed: ${message}`);
    console.log("Check your provider configuration with `neutron doctor`.");
    process.exitCode = 1;
  }
}

export interface TestCommandOptions {
  watch?: boolean;
}

export interface TestCommandDeps {
  /** Testable seam: defaults to the real file-watching implementation. */
  watchImpl?: (root: string, command: string[]) => void;
}

export async function testCommand(
  root: string,
  options: TestCommandOptions = {},
  deps: TestCommandDeps = {},
): Promise<void> {
  if (options.watch) {
    const watchImpl = deps.watchImpl ?? watchCommand;
    watchImpl(root, ["npm", "test", "--", "--run"]);
    return;
  }
  if (!existsSync(join(root, "package.json"))) {
    console.log("No package.json found — nothing to build or test.");
    return;
  }
  const term = new Terminal({ cwd: root });
  const r1 = await term.run("npm run build", { timeoutMs: 180_000 });
  console.log(`\n=== BUILD (exit ${r1.exitCode}) ===\n${r1.stdout}\n${r1.stderr}`.slice(-3000));
  const r2 = await term.run("npm test -- --run", { timeoutMs: 180_000 });
  console.log(`\n=== TESTS (exit ${r2.exitCode}) ===\n${r2.stdout}\n${r2.stderr}`.slice(-3000));
  const counts = parseTestOutput(r2.stdout);
  console.log(`\nBuild: ${r1.status === "ok" ? "OK" : "FAILED"}`);
  console.log(`Tests: ${counts.pass} passed, ${counts.fail} failed`);
  if (r1.status !== "ok" || r2.status !== "ok") process.exitCode = 1;
}

function readFileSafe(p: string): string | undefined {
  try {
    if (existsSync(p)) {
      return readFileSync(p, "utf8");
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function logsCommand(root: string, agent?: string, live?: boolean): void {
  const dir = join(root, ".agent", "logs");
  if (!existsSync(dir)) {
    console.log("No logs yet.");
    return;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".log"));
  const target = agent ? files.filter((f) => f.includes(agent)) : files;
  if (target.length === 0) {
    console.log(agent ? `No logs for agent "${agent}".` : "No logs yet.");
    return;
  }
  for (const f of target) {
    console.log(`\n--- ${f} ---`);
    console.log(readFileSync(join(dir, f), "utf8").slice(-3000));
  }
  if (live) {
    console.log("(live tail is not supported yet; showing the tail of each log)");
  }
}