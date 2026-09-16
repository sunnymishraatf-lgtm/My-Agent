import { BaseAgent } from "./base";
import type { AgentContext, AgentResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { applyFileOps } from "./apply";

export class FrontendAgent extends BaseAgent {
  constructor() {
    super({ id: "frontend", role: "frontend", label: "Frontend", promptsKey: "frontend" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.design) {
      return {
        status: "blocked",
        summary: "Frontend requires design.md before implementation.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [{ severity: "high", category: "design", title: "Frontend task blocked: no design.md" }],
        nextActions: ["Create design.md first."],
      };
    }

    const out = await this.runLlm(task, ctx);
    const { files, failed, noFiles, commandsRun, issues } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "Frontend agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."],
      };
    }

    return {
      status: failed === 0 ? "success" : "failed",
      summary: `Frontend changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: [],
    };
  }
}