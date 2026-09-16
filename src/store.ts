import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./scheduler/task";

export interface ProjectStateMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}

export const AGENT_DIR = ".agent";

export class StateStore {
  private dir: string;

  constructor(root: string) {
    this.dir = join(root, AGENT_DIR);
  }

  getDir(): string {
    return this.dir;
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  private path(file: string): string {
    return join(this.dir, file);
  }

  private read<T>(file: string, fallback: T): T {
    this.ensure();
    const p = this.path(file);
    if (!existsSync(p)) return fallback;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private write(file: string, data: unknown): void {
    this.ensure();
    writeFileSync(this.path(file), JSON.stringify(data, null, 2), "utf8");
  }

  getMeta(): ProjectStateMeta {
    return this.read<ProjectStateMeta>("project.json", {
      name: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "new",
    });
  }

  setMeta(meta: Partial<ProjectStateMeta>): void {
    const cur = this.getMeta();
    this.write("project.json", {
      ...cur,
      ...meta,
      updatedAt: new Date().toISOString(),
    });
  }

  getTasks(): Task[] {
    return this.read<Task[]>("tasks.json", []);
  }

  setTasks(tasks: Task[]): void {
    this.write("tasks.json", tasks);
  }

  getReview(): string {
    this.ensure();
    const p = this.path("review.md");
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }

  setReview(content: string): void {
    this.ensure();
    writeFileSync(this.path("review.md"), content, "utf8");
  }

  getTestResults(): string {
    this.ensure();
    const p = this.path("test-results.md");
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }

  setTestResults(content: string): void {
    this.ensure();
    writeFileSync(this.path("test-results.md"), content, "utf8");
  }

  appendLog(channel: string, line: string): void {
    this.ensure();
    const dir = join(this.dir, "logs");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `${channel}.log`);
    writeFileSync(f, `${new Date().toISOString()} ${line}\n`, { flag: "a", encoding: "utf8" });
  }

  listLogs(): string[] {
    this.ensure();
    const dir = join(this.dir, "logs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f: string) => f.endsWith(".log"));
  }

  readLog(channel: string): string {
    this.ensure();
    const f = this.path("logs") + `/${channel}.log`;
    if (!existsSync(f)) return "";
    return readFileSync(f, "utf8");
  }
}