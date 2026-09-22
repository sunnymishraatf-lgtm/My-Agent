import type { Task, Issue } from "../scheduler/task";
import type { DesignSystem, DesignSystemJson } from "../design/design";
import type { ApiSystem } from "../api/api-manager";

export type AgentRole =
  | "manager"
  | "requirements"
  | "design"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "devops"
  | "qa"
  | "reviewer";

export interface AgentContext {
  root: string;
  design?: DesignSystem;
  designJson?: DesignSystemJson;
  api: ApiSystem;
  log: (msg: string) => void;
  run: (cmd: string) => Promise<{ status: "ok" | "error"; stdout: string; stderr: string; exitCode: number }>;
  readFile: (path: string) => string | undefined;
  writeFile: (path: string, content: string) => boolean;
  listDir: (dir?: string) => string[];
  getApproval: (req: {
    message: string;
    command?: string;
    reason: "dangerous-command" | "destructive" | "outside-workspace" | "contains-secret" | "large-delete" | "public-exposure" | "package-install";
  }) => Promise<boolean>;
}

export interface AgentResult {
  status: "success" | "failed" | "blocked";
  summary: string;
  filesChanged: string[];
  commandsRun: string[];
  testsRun: string[];
  issues: Issue[];
  nextActions: string[];
}

export interface ReviewResult {
  passed: boolean;
  score: number;
  issues: Issue[];
  notes: string[];
}

export interface Agent {
  readonly id: string;
  readonly role: AgentRole;
  readonly label: string;
  canHandle(task: Task): boolean;
  execute(task: Task, ctx: AgentContext): Promise<AgentResult>;
  review(result: AgentResult, ctx: AgentContext): Promise<ReviewResult>;
}