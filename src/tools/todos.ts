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
    if (!Array.isArray(todos)) throw new Error("todos must be an array of {content, status?, priority?} objects");
    this.items = todos.map((raw, i) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`todos[${i}] must be an object with a content string`);
      }
      const t = raw as Record<string, unknown>;
      if (typeof t.content !== "string" || t.content.trim() === "") {
        throw new Error(`todos[${i}].content must be a non-empty string`);
      }
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
