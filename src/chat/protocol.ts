import type { Tool } from "../tools/types";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedAssistant {
  text: string;
  calls: ToolCall[];
}

const TOOL_BLOCK = /```[ \t]*tool[ \t]*\r?\n([\s\S]*?)```/gi;

export function parseToolCalls(text: string): ParsedAssistant {
  const calls: ToolCall[] = [];
  let cleaned = text;
  for (const match of text.matchAll(TOOL_BLOCK)) {
    const body = match[1]?.trim() ?? "";
    calls.push(...parseToolPayload(body));
    cleaned = cleaned.replace(match[0], "");
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, calls };
}

function parseToolPayload(body: string): ToolCall[] {
  const jsonText = extractJson(body);
  if (!jsonText) return [];
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  return normalizeCalls(data);
}

function normalizeCalls(data: unknown): ToolCall[] {
  if (Array.isArray(data)) return data.flatMap(normalizeCalls);
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const rawName = obj.tool ?? obj.name ?? obj.tool_name;
  const name = typeof rawName === "string" ? rawName : undefined;

  if (!name) {
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const key = keys[0]!;
      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return [{ name: key, args: value as Record<string, unknown> }];
      }
    }
    return [];
  }

  const maybeArgs = obj.args ?? obj.arguments ?? obj.parameters;
  if (maybeArgs && typeof maybeArgs === "object" && !Array.isArray(maybeArgs)) {
    return [{ name, args: maybeArgs as Record<string, unknown> }];
  }

  const { tool: _tool, name: _name, tool_name: _toolName, args: _args, arguments: _arguments, parameters: _parameters, ...rest } = obj;
  return [{ name, args: rest }];
}

function extractJson(s: string): string | undefined {
  const start = s.search(/[[{]/);
  if (start < 0) return undefined;
  const open = s[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return undefined;
}

export function buildToolInstructions(tools: Tool[]): string {
  const lines: string[] = [];
  lines.push("You can use the following tools to inspect and change the workspace:");
  for (const tool of tools) {
    const params = Object.entries(tool.parameters)
      .map(([key, p]) => `${key}${p.required ? "" : "?"}: ${p.type}`)
      .join(", ");
    lines.push(`- ${tool.name}(${params}) — ${tool.description}`);
  }
  lines.push("");
  lines.push("To call a tool, reply with a fenced block exactly like this and nothing else:");
  lines.push("```tool");
  lines.push('{"tool":"read","args":{"path":"src/index.ts"}}');
  lines.push("```");
  lines.push(
    "You may include several tool blocks in one reply. After the tool results are returned, keep going. When the task is complete, reply with plain text and no tool block.",
  );
  return lines.join("\n");
}
