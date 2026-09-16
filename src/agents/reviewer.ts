import { BaseAgent } from "./base";
import type { AgentContext, AgentResult, ReviewResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { writeProjectFile } from "../files/project-files";

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super({ id: "reviewer", role: "reviewer", label: "Reviewer", promptsKey: "reviewer" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const out = await this.runLlm(task, ctx);
    const file = ".agent/review.md";
    writeProjectFile(ctx.root, file, `# Code Review\n\n${out}\n`);

    const issues = extractIssues(out);

    return {
      status: issues.some((i) => i.severity === "high" || i.severity === "critical") ? "failed" : "success",
      summary: `Review wrote ${out.length} chars to ${file}; ${issues.length} issues found`,
      filesChanged: [file],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: issues.length ? ["Assign fix tasks for review issues."] : [],
    };
  }

  async review(result: AgentResult, ctx: AgentContext): Promise<ReviewResult> {
    const issues: Issue[] = result.issues ?? [];
    const high = issues.filter((i) => i.severity === "high" || i.severity === "critical").length;
    const low = issues.length - high;
    const score = Math.max(0, 100 - high * 20 - low * 5);
    return {
      passed: high === 0,
      score,
      issues,
      notes: [`Reviewer found ${high} high-severity issues, ${low} lower-severity issues.`],
    };
  }
}

export function extractIssues(text: string): Issue[] {
  const issues: Issue[] = [];
  const lines = text.split("\n");
  const severityMap: Record<string, Issue["severity"]> = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
  };
  let current: Partial<Issue> | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) continue;
    const match = line.match(/^(?:[-*]\s*)?(?:\[(critical|high|medium|low)\]|(critical|high|medium|low)\s*:)\s*(.+)$/i);
    if (match) {
      if (current?.title) issues.push(current as Issue);
      const sev = (match[1] ?? match[2])!.toLowerCase();
      current = {
        severity: severityMap[sev] ?? "medium",
        category: "review",
        title: match[3]!.trim(),
      };
      continue;
    }
    if (current && line) {
      current.detail = (current.detail ? current.detail + "\n" : "") + line;
    }
  }
  if (current?.title) issues.push(current as Issue);
  return issues;
}