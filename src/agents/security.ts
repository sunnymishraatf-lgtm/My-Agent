import { BaseAgent } from "./base";
import type { AgentContext, AgentResult, ReviewResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import { writeProjectFile } from "../files/project-files";
import { redact } from "../config";

const SECURITY_AREAS = [
  "Authentication",
  "Authorization",
  "Secrets & environment variables",
  "API security",
  "Input validation",
  "SQL injection",
  "XSS",
  "CSRF",
  "Dependency vulnerabilities",
  "Insecure configuration",
  "Exposed credentials",
  "File permissions",
  "Command execution",
];

export class SecurityAgent extends BaseAgent {
  constructor() {
    super({ id: "security", role: "security", label: "Security", promptsKey: "security" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const out = await this.runLlm(task, ctx, SECURITY_AREAS.map((a) => `- ${a}`).join("\n"));
    const report = redact(out);
    const file = ".agent/security-report.md";
    const ok = writeProjectFile(ctx.root, file, `# Security Report\n\n${report}\n`);

    const issues: Issue[] = [];
    const criticalCount = (report.match(/^\s*(?:[-*]\s*)?\[?critical\]?\s*:/im) ?? []).length;
    const highCount = (report.match(/^\s*(?:[-*]\s*)?\[?high\]?\s*:/im) ?? []).length;
    if (criticalCount > 0) {
      issues.push({
        severity: "critical",
        category: "security",
        title: "Critical security findings present",
        detail: report.slice(0, 1000),
      });
    } else if (highCount > 0) {
      issues.push({ severity: "high", category: "security", title: "High-severity security findings present" });
    }

    return {
      status: ok ? (issues.some((i) => i.severity === "critical") ? "blocked" : "success") : "failed",
      summary: `Security audit wrote ${report.length} chars to ${file}`,
      filesChanged: ok ? [file] : [],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: issues.some((i) => i.severity === "critical")
        ? ["Fix critical security findings before completion."]
        : [],
    };
  }

  async review(result: AgentResult, ctx: AgentContext): Promise<ReviewResult> {
    const issues: Issue[] = result.issues ?? [];
    const critical = issues.filter((i) => i.severity === "critical").length;
    const high = issues.filter((i) => i.severity === "high").length;
    const score = Math.max(0, 100 - critical * 40 - high * 15);
    return {
      passed: critical === 0,
      score,
      issues,
      notes: [`Critical: ${critical}, High: ${high}`],
    };
  }
}