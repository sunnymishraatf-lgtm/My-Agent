import { BaseAgent } from "./base";
import type { AgentContext, AgentResult, ReviewResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { writeProjectFile } from "../files/project-files";
import { parseDesignSystem, toDesignSystemJson, designSystemToCssTokens } from "../design/parser";

export class DesignAgent extends BaseAgent {
  constructor() {
    super({ id: "design", role: "design", label: "Design", promptsKey: "design" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const design = ctx.design;
    if (!design) {
      return {
        status: "failed",
        summary: "No design.md found; Design Agent requires design.md.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [{ severity: "high", category: "design", title: "design.md missing" }],
        nextActions: ["Ask the user to create design.md."],
      };
    }

    const dsj = toDesignSystemJson(design);
    const ok = writeProjectFile(ctx.root, "design-system.json", JSON.stringify(dsj, null, 2));

    const tokens = designSystemToCssTokens(dsj);
    const tokOk = writeProjectFile(ctx.root, ".agent/design-tokens.css", tokens);

    const issues: Issue[] = design.warnings.map((w) => ({
      severity: "medium",
      category: "design",
      title: w,
    }));

    return {
      status: "success",
      summary: `Parsed design.md into design-system.json${issues.length ? ` (${issues.length} warnings)` : ""}`,
      filesChanged: [...(ok ? ["design-system.json"] : []), ...(tokOk ? [".agent/design-tokens.css"] : [])],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: [],
    };
  }

  async review(result: AgentResult, ctx: AgentContext): Promise<ReviewResult> {
    const design = ctx.design;
    if (!design) return { passed: false, score: 0, issues: [], notes: ["design.md missing"] };
    let score = 100;
    const notes: string[] = [];
    const issues: Issue[] = [];
    if (!design.colors.primary && !design.colors.background) {
      issues.push({ severity: "medium", category: "design", title: "design.md lacks colors" });
      score -= 30;
    }
    if (!design.responsive.mobile && !design.responsive.tablet) {
      issues.push({ severity: "medium", category: "design", title: "design.md lacks responsive definitions" });
      score -= 20;
    }
    if (!design.typography.font) {
      issues.push({ severity: "low", category: "design", title: "design.md lacks typography" });
      score -= 10;
    }
    notes.push(`Design system parsed with ${design.features.length} features, ${design.pages.length} pages.`);
    if (issues.length > 0) notes.push(`${issues.length} design gaps reported.`);
    return { passed: score >= 60, score, issues, notes };
  }
}