export type TaskStatus = "pending" | "ready" | "queued" | "running" | "completed" | "failed" | "blocked" | "skipped" | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Task {
  id: string;
  agent: string;
  description: string;
  dependencies: string[];
  priority: TaskPriority;
  status: TaskStatus;
  retries?: number;
  assignedTo?: string;
  result?: {
    status: "success" | "failed" | "blocked" | "skipped";
    summary: string;
    filesChanged: string[];
    commandsRun: string[];
    testsRun: string[];
    issues: Issue[];
    nextActions: string[];
  };
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface Issue {
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: string;
  title: string;
  detail?: string;
  file?: string;
  fixRecommendation?: string;
}

export function taskId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function isTaskFinished(status: TaskStatus): boolean {
  return ["completed", "failed", "blocked", "skipped", "cancelled"].includes(status);
}

export function isTaskBlockingFailure(task: Task): boolean {
  return task.status === "failed" || task.status === "blocked";
}

export function freshTask(partial: Partial<Task> & { id: string; agent: string; description: string }): Task {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    agent: partial.agent,
    description: partial.description,
    dependencies: partial.dependencies ?? [],
    priority: partial.priority ?? "medium",
    status: partial.status ?? "pending",
    retries: 0,
    createdAt: now,
    updatedAt: now,
    metadata: partial.metadata ?? {},
  };
}