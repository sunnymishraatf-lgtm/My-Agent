import { BaseAgent } from "./base";
import type { AgentContext, AgentResult } from "./agent";
import type { Task } from "../scheduler/task";
import { applyFileOps } from "./apply";

export class DatabaseAgent extends BaseAgent {
  constructor() {
    super({ id: "database", role: "database", label: "Database", promptsKey: "database" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const out = await this.runLlm(task, ctx);
    const { files, failed, noFiles, commandsRun, issues } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "Database agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."],
      };
    }
    return {
      status: failed === 0 ? "success" : "failed",
      summary: `Database changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: [],
    };
  }
}