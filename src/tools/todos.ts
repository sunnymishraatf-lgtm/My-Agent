export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: "high" | "medium" | "low";
}

export class TodoStore {
  private items: TodoItem[] = [];
  private counter = 0;

  write(todos: unknown): TodoItem[] {
    if (!Array.isArray(todos)) return this.items;
    this.items = todos.map((raw) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      const status = t.status;
      const priority = t.priority;
      return {
        id: typeof t.id === "string" && t.id ? t.id : `todo-${++this.counter}`,
        content: String(t.content ?? ""),
        status:
          status === "in_progress" || status === "completed" || status === "cancelled" ? status : "pending",
        priority: priority === "high" || priority === "low" ? priority : "medium",
      };
    });
    return this.items;
  }

  read(): TodoItem[] {
    return this.items;
  }

  format(): string {
    if (this.items.length === 0) return "(no todos)";
    const mark = (s: TodoStatus) =>
      s === "completed" ? "[x]" : s === "in_progress" ? "[~]" : s === "cancelled" ? "[-]" : "[ ]";
    return this.items.map((t) => `${mark(t.status)} ${t.content} (${t.priority})`).join("\n");
  }
}
