import { BaseAgent } from "./base";
import type { AgentContext, AgentResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { applyFileOps } from "./apply";

export class BackendAgent extends BaseAgent {
  constructor() {
    super({ id: "backend", role: "backend", label: "Backend", promptsKey: "backend" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const out = await this.runLlm(task, ctx);
    const issues: Issue[] = [];
    const { files, commandsRun, failed, noFiles } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "Backend agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."],
      };
    }
    return {
      status: failed === 0 ? "success" : "failed",
      summary: `Backend changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: [],
    };
  }
}