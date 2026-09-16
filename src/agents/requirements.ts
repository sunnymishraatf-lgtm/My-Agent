import { BaseAgent } from "./base";
import type { AgentContext, AgentResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { writeProjectFile } from "../files/project-files";

export class RequirementsAgent extends BaseAgent {
  constructor() {
    super({ id: "requirements", role: "requirements", label: "Requirements", promptsKey: "requirements" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const out = await this.runLlm(task, ctx);
    const requirements = out.trim();
    const file = ".agent/requirements.md";
    const metadata = readAgentMetadata(ctx);
    const ok = writeProjectFile(ctx.root, file, `# Requirements\n\n${requirements}\n`);

    const issues: Issue[] = [];
    if (!/ACCEPTANCE CRITERIA/i.test(requirements)) {
      issues.push({
        severity: "medium",
        category: "requirements",
        title: "Acceptance criteria not clearly listed",
        detail: "The requirements output did not include an explicit ACCEPTANCE CRITERIA section.",
      });
    }
    if (metadata?.requirementsFileVersion && metadata.requirementsFileVersion === 1) {
      issues.push({
        severity: "info",
        category: "requirements",
        title: "requirements.md has previous content",
      });
    }

    return {
      status: issues.some((i) => i.severity === "medium") ? "success" : "success",
      summary: `Wrote ${requirements.length} chars to ${file}`,
      filesChanged: ok ? [file] : [],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: [],
    };
  }
}

function readAgentMetadata(ctx: AgentContext) {
  const raw = ctx.readFile(".agent/project.json");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as { requirementsFileVersion?: number };
  } catch {
    return undefined;
  }
}