import type { Agent, AgentContext, AgentResult, AgentRole, ReviewResult } from "./agent";
import type { Task, Issue } from "../scheduler/task";
import type { TaskKind } from "../types";
import { getContextForTask } from "../context/context";
import { buildPromptForTask } from "../prompts";
import type { ApiSystem } from "../api/api-manager";
import { writeSystemFile } from "../files/workspace";

export interface BaseAgentOptions {
  id: string;
  role: AgentRole;
  label: string;
  promptsKey: keyof typeof import("../prompts").PROMPTS;
}

export abstract class BaseAgent implements Agent {
  readonly id: string;
  readonly role: AgentRole;
  readonly label: string;
  protected promptsKey: keyof typeof import("../prompts").PROMPTS;

  constructor(opts: BaseAgentOptions) {
    this.id = opts.id;
    this.role = opts.role;
    this.label = opts.label;
    this.promptsKey = opts.promptsKey;
  }

  protected abstract executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult>;

  canHandle(task: Task): boolean {
    return task.agent === this.id || task.agent === this.label;
  }

  async execute(task: Task, ctx: AgentContext): Promise<AgentResult> {
    ctx.log(`[${this.label}] executing ${task.id}`);
    return this.executeInternal(task, ctx);
  }

  protected async runLlm(task: Task, ctx: AgentContext, extraInstructions?: string): Promise<string> {
    const context = await getContextForTask(task, ctx.root);
    const prompt = buildPromptForTask(task, this.promptsKey, context, extraInstructions);
    const messages = [
      { role: "system" as const, content: this.systemPrompt(ctx) },
      { role: "user" as const, content: prompt },
    ];
    const kind = roleToKind(this.role);
    const res = await ctx.api.chat(kind, messages, {
      temperature: 0.2,
    });
    return res.text;
  }

  protected systemPrompt(ctx: AgentContext): string {
    return `You are the ${this.label} agent in a multi-agent software engineering platform called NEUTRON (Autonomous Software Maintenance Intelligence).
You operate inside a project repository. Your job: complete the assigned task precisely, follow design.md where relevant, guard against over-engineering, and never touch unrelated files.
Never fabricate test results. Never reveal API keys. Only run commands through the provided run() tool.`;
  }

  protected async runLlmWithTask(task: Task, ctx: AgentContext, opts?: { temperature?: number }): Promise<string> {
    return this.runLlm(task, ctx);
  }

  review(_result: AgentResult, _ctx: AgentContext): Promise<ReviewResult> {
    return Promise.resolve({ passed: true, score: 100, issues: [], notes: [] });
  }
}

export function okResult(summary: string, opts?: Partial<AgentResult>): AgentResult {
  return {
    status: "success",
    summary,
    filesChanged: [],
    commandsRun: [],
    testsRun: [],
    issues: [],
    nextActions: [],
    ...opts,
  };
}

export function roleToKind(role: AgentRole): TaskKind {
  const map: Record<AgentRole, TaskKind> = {
    manager: "architecture",
    requirements: "requirements",
    design: "design",
    frontend: "frontend",
    backend: "backend",
    database: "database",
    security: "security",
    devops: "devops",
    qa: "testing",
    reviewer: "review",
  };
  return map[role];
}

export function failResult(summary: string, issues: Issue[] = [], opts?: Partial<AgentResult>): AgentResult {
  return {
    status: "failed",
    summary,
    filesChanged: [],
    commandsRun: [],
    testsRun: [],
    issues,
    nextActions: [],
    ...opts,
  };
}

export { writeSystemFile };