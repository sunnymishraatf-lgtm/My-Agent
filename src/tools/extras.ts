import { fail, ok, stringArg, type Tool, type ToolResult } from "./types";
import type { TodoStore } from "./todos";
import { findSkill, loadSkills } from "../chat/skills";
import { diagnoseFile } from "../lsp/client";

const MAX_FETCH_BYTES = 500_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webfetchTool: Tool = {
  name: "webfetch",
  description: "Fetch a URL and return its text content (HTML is converted to plain text).",
  parameters: {
    url: { type: "string", description: "Absolute http(s) URL to fetch", required: true },
    maxBytes: { type: "number", description: "Maximum bytes to read (default 500000)" },
  },
  async execute(args): Promise<ToolResult> {
    const url = stringArg(args, "url");
    if (!url) return fail("Missing required argument: url");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail("Only http(s) URLs are supported");
    }
    const maxBytes = Math.min(5_000_000, Math.max(1000, Math.floor(Number(args.maxBytes) || MAX_FETCH_BYTES)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(parsed, {
        signal: controller.signal,
        headers: { "user-agent": "sunny-agent/0.1" },
      });
      const raw = (await res.text()).slice(0, maxBytes);
      const contentType = res.headers.get("content-type") ?? "";
      const text = /html/i.test(contentType) ? stripHtml(raw) : raw;
      return ok(`HTTP ${res.status} ${parsed.href}\n\n${text.slice(0, 100_000)}`);
    } catch (err) {
      return fail(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  },
};

export const skillTool: Tool = {
  name: "skill",
  description: "Load a named skill's instructions from .sunny/skills (or .claude/skills).",
  parameters: {
    name: { type: "string", description: "Skill name, or 'list' to see available skills", required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const name = stringArg(args, "name");
    if (!name) return fail("Missing required argument: name");
    if (name === "list") {
      const skills = loadSkills(ctx.root);
      if (skills.length === 0) return ok("No skills found. Add SKILL.md files under .sunny/skills/.");
      return ok(skills.map((s) => `- ${s.name}: ${s.description}`).join("\n"));
    }
    const skill = findSkill(ctx.root, name);
    if (!skill) return fail(`Unknown skill: ${name}. Use the skill tool with name="list".`);
    return ok(`# Skill: ${skill.name}\n\n${skill.body}`);
  },
};

export const lspTool: Tool = {
  name: "lsp",
  description: "Run the configured language server for a file and return its diagnostics (errors and warnings).",
  parameters: {
    path: { type: "string", description: "File path relative to the workspace root", required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const path = stringArg(args, "path");
    if (!path) return fail("Missing required argument: path");
    try {
      const { diagnostics, server } = await diagnoseFile(ctx.root, path);
      if (diagnostics.length === 0) return ok(`No diagnostics for ${path} (server: ${server}).`);
      const lines = diagnostics.map(
        (d) => `${d.file}:${d.line}:${d.character} ${d.severity}: ${d.message}${d.source ? ` (${d.source})` : ""}`,
      );
      return ok(`${diagnostics.length} diagnostic(s) for ${path} (server: ${server}):\n${lines.join("\n")}`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

export interface TaskRequest {
  description: string;
  prompt: string;
  subagent_type?: string;
}

export type TaskSpawner = (request: TaskRequest) => Promise<{ ok: boolean; output: string }>;

export function createTaskTool(spawn: TaskSpawner, agentNames: string[]): Tool {
  return {
    name: "task",
    description:
      "Delegate a self-contained task to a subagent and return its result. Use for broad codebase exploration or research.",
    parameters: {
      description: { type: "string", description: "Short 3-5 word description of the task", required: true },
      prompt: { type: "string", description: "Full instructions for the subagent", required: true },
      subagent_type: {
        type: "string",
        description: `Subagent to use: ${agentNames.join(", ") || "general"}`,
      },
    },
    async execute(args): Promise<ToolResult> {
      const prompt = stringArg(args, "prompt");
      if (!prompt) return fail("Missing required argument: prompt");
      const description = stringArg(args, "description") ?? prompt.slice(0, 40);
      const subagent_type = stringArg(args, "subagent_type");
      const result = await spawn({
        description,
        prompt,
        ...(subagent_type ? { subagent_type } : {}),
      });
      return result.ok ? ok(result.output) : fail(result.output);
    },
  };
}

export function createTodoTools(store: TodoStore): Tool[] {
  const todowrite: Tool = {
    name: "todowrite",
    description: "Create or update the task list for the current session.",
    parameters: {
      todos: { type: "string", description: "JSON array of {content, status, priority} objects", required: true },
    },
    async execute(args): Promise<ToolResult> {
      let parsed: unknown = args.todos;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return fail("todos must be a JSON array");
        }
      }
      store.write(parsed);
      return ok(store.format());
    },
  };
  const todoread: Tool = {
    name: "todoread",
    description: "Read the current task list.",
    parameters: {},
    async execute(): Promise<ToolResult> {
      return ok(store.format());
    },
  };
  return [todowrite, todoread];
}
