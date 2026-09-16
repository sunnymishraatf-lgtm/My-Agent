import { BaseAgent } from "./base";
import type { AgentContext, AgentResult } from "./agent";
import { freshTask, type Task } from "../scheduler/task";
import { parseDesignSystem } from "../design/parser";

export class ManagerAgent extends BaseAgent {
  constructor() {
    super({ id: "manager", role: "manager", label: "Manager", promptsKey: "manager" });
  }

  protected async executeInternal(task: Task, ctx: AgentContext): Promise<AgentResult> {
    const out = await this.runLlm(task, ctx);
    return {
      status: "success",
      summary: `Manager produced plan of ${out.length} chars`,
      filesChanged: [],
      commandsRun: [],
      testsRun: [],
      issues: [],
      nextActions: [],
    };
  }

  async buildTaskGraph(ctx: AgentContext): Promise<Task[]> {
    const designText = ctx.readFile("design.md");
    const design = designText ? parseDesignSystem(designText) : undefined;
    const frontend = design && (design.pages.length > 0 || design.features.length > 0);
    const backend = design ? design.backend.framework !== undefined || design.authentication !== undefined : false;
    const db = design ? design.database.database !== undefined : false;

    const tasks: Task[] = [];
    let n = 1;
    const PREFIX: Record<string, string> = {
      requirements: "REQ",
      design: "DSN",
      frontend: "FE",
      backend: "BE",
      database: "DB",
      security: "SEC",
      devops: "DEV",
      qa: "QA",
      reviewer: "REV",
      manager: "MGR",
    };

    const add = (agent: string, description: string, deps: string[], priority: Task["priority"]) => {
      const id = `${PREFIX[agent] ?? agent.toUpperCase().slice(0, 3)}-${String(n++).padStart(3, "0")}`;
      tasks.push(
        freshTask({
          id,
          agent,
          description,
          dependencies: deps,
          priority,
          status: "pending",
        }),
      );
      return id;
    };

    const rid = add("requirements", "Convert requirements into requirements.md with acceptance criteria", [], "high");
    const did = add("design", "Parse design.md into design-system.json and validate", [rid], "high");

    let dbid: string | null = null;
    let backendId: string | null = null;
    let frontendId: string | null = null;

    if (db || backend) {
      if (db) {
        dbid = add("database", "Design and create database schema/migrations", [rid], "high");
      }
      if (backend) {
        backendId = add("backend", "Implement backend APIs, auth and business logic", [rid, ...(dbid ? [dbid] : [])], "high");
      }
    }

    if (frontend) {
      frontendId = add("frontend", "Implement frontend following design.md exactly", [did, ...(backendId ? [backendId] : [])], "high");
    }

    const secId = add("security", "Audit security and produce security-report.md", [rid, ...(backendId ? [backendId] : []), ...(frontendId ? [frontendId] : [])], "high");
    const devId = add("devops", "Add deployment, env and build configuration", [rid], "medium");
    const qaDeps = [backendId ?? rid, frontendId ?? did, dbid ?? rid];
    const qaId = add("qa", "Run tests and build; produce test-results.md", [...new Set(qaDeps)], "high");
    const revId = add("reviewer", "Review complete project; produce review.md", [qaId, secId], "high");

    return tasks;
  }
}